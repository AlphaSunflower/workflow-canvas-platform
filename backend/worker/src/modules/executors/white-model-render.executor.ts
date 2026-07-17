import {
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  EXECUTION_PHASES,
  EXECUTION_STATUSES,
  WHITE_MODEL_RENDER_FINAL_INPUT_ORDER,
  WHITE_MODEL_RENDER_PROMPTS,
  resolveAIImageGenOutputSize,
} from "@newworkflow/backend-shared";
import type { ExecutionsRepository } from "../../../../api/src/modules/executions/executions.repository.types.ts";
import type { FilesRepository } from "../../../../api/src/modules/files/files.repository.types.ts";
import { WorkerFileAssetService } from "../files/worker-file-asset.service.ts";
import { IntermediateArtifactService } from "../intermediate/intermediate-artifact.service.ts";
import type {
  IntermediateArtifactReservation,
} from "../intermediate/intermediate-artifact.service.ts";
import type {
  LaozhangAspectRatio,
  LaozhangGenerateImageInput,
  LaozhangImageInput,
} from "../providers/laozhang/laozhang.types.ts";
import type { ProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { NoopProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { withProviderCallLog } from "../provider-call-logs/provider-call-logger.ts";
import { StorageService } from "../storage/storage.service.ts";
import type { StorageWriteResult } from "../storage/storage.types.ts";
import type {
  WhiteModelRenderExecutorInput,
  WhiteModelRenderExecutorResult,
} from "./white-model-render.types.ts";

interface ProviderClientLike {
  generateImage(input: LaozhangGenerateImageInput): Promise<{
    imageBase64: string;
    mimeType: string;
    snapshotPath?: string;
  }>;
}

export class WhiteModelRenderExecutor {
  private readonly executionsRepository: ExecutionsRepository;
  private readonly filesRepository: FilesRepository;
  private readonly fileAssetService: WorkerFileAssetService;
  private readonly intermediateArtifactService: IntermediateArtifactService;
  private readonly providerClient: ProviderClientLike;
  private readonly providerCallLogRepository: ProviderCallLogRepository;
  private readonly storageService: StorageService;

  constructor(
    executionsRepository: ExecutionsRepository,
    filesRepository: FilesRepository,
    intermediateArtifactService: IntermediateArtifactService,
    providerClient: ProviderClientLike,
    storageService: StorageService,
    providerCallLogRepository: ProviderCallLogRepository = new NoopProviderCallLogRepository(),
  ) {
    this.executionsRepository = executionsRepository;
    this.filesRepository = filesRepository;
    this.fileAssetService = new WorkerFileAssetService(filesRepository);
    this.intermediateArtifactService = intermediateArtifactService;
    this.providerClient = providerClient;
    this.providerCallLogRepository = providerCallLogRepository;
    this.storageService = storageService;
  }

  async execute(
    input: WhiteModelRenderExecutorInput,
  ): Promise<WhiteModelRenderExecutorResult> {
    const whiteModelFile = await this.readFileOrThrow(
      input.whiteModelFileId,
      "WHITE_MODEL_FILE_NOT_FOUND",
    );
    const styleReferenceFile = await this.readFileOrThrow(
      input.styleReferenceFileId,
      "STYLE_REFERENCE_FILE_NOT_FOUND",
    );
    const resolvedSize = this.resolveModelSize(input);

    const intermediate = await this.intermediateArtifactService.resolveWhiteModelArtifacts({
      whiteModelFileId: input.whiteModelFileId,
      taskId: input.taskId,
      model: input.model,
      imageSize: input.model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL ? null : input.imageSize,
      aspectRatio: input.model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL ? null : input.aspectRatio,
    });

    let lineartFileId = "";
    let depthFileId = "";

    try {
      const [lineartFileIdResult, depthFileIdResult] = await Promise.all([
        this.ensureIntermediateArtifact({
          runId: input.runId,
          taskId: input.taskId,
          taskNo: input.taskNo,
          reservation: intermediate.lineart!,
          prompt: WHITE_MODEL_RENDER_PROMPTS.lineart,
          sourceFile: whiteModelFile,
          stepType: "lineart",
          model: input.model,
          imageSize: input.imageSize,
          aspectRatio: input.aspectRatio,
          resolvedSize,
        }),
        this.ensureIntermediateArtifact({
          runId: input.runId,
          taskId: input.taskId,
          taskNo: input.taskNo,
          reservation: intermediate.depth!,
          prompt: WHITE_MODEL_RENDER_PROMPTS.depth,
          sourceFile: whiteModelFile,
          stepType: "depth",
          model: input.model,
          imageSize: input.imageSize,
          aspectRatio: input.aspectRatio,
          resolvedSize,
        }),
      ]);

      lineartFileId = lineartFileIdResult;
      depthFileId = depthFileIdResult;

      const lineartFile = await this.readFileOrThrow(lineartFileId, "LINEART_FILE_NOT_FOUND");
      const depthFile = await this.readFileOrThrow(depthFileId, "DEPTH_FILE_NOT_FOUND");

      await this.executionsRepository.appendTaskEvent({
        taskId: input.taskId,
        eventType: "step_final_started",
        status: EXECUTION_STATUSES[1],
        phase: EXECUTION_PHASES[1],
        stepType: "final",
        progress: 75,
        message: "Generating final image",
        payload: {
          model: input.model,
          imageSize: input.imageSize,
          aspectRatio: input.aspectRatio,
          resolvedSize,
          inputOrder: [...WHITE_MODEL_RENDER_FINAL_INPUT_ORDER],
        },
      });

      const finalProviderInput = this.buildProviderInput({
        prompt: WHITE_MODEL_RENDER_PROMPTS.final,
        taskNo: input.taskNo,
        snapshotLabelSuffix: "final",
        model: input.model,
        imageSize: input.imageSize,
        aspectRatio: input.aspectRatio,
        resolvedSize,
        images: [
          {
            mimeType: styleReferenceFile.mimeType,
            dataBase64: styleReferenceFile.buffer.toString("base64"),
          },
          {
            mimeType: lineartFile.mimeType,
            dataBase64: lineartFile.buffer.toString("base64"),
          },
          {
            mimeType: depthFile.mimeType,
            dataBase64: depthFile.buffer.toString("base64"),
          },
          {
            mimeType: whiteModelFile.mimeType,
            dataBase64: whiteModelFile.buffer.toString("base64"),
          },
        ],
      });
      const finalResponse = await this.generateImageWithLog({
        taskId: input.taskId,
        stepType: "final",
        providerInput: finalProviderInput,
      });

      const savedResult = await this.storageService.saveBase64({
        sourceType: "output",
        fileType: "image",
        originalName: `${input.taskNo}-final.png`,
        mimeType: finalResponse.mimeType,
        contentBase64: finalResponse.imageBase64,
      });

      const resultFileId = await this.registerStoredAsset({
        userId: input.userId,
        stored: savedResult,
        contentBase64: finalResponse.imageBase64,
      });

      await this.executionsRepository.updateTaskResultFile(input.taskId, resultFileId);
      await this.executionsRepository.appendTaskEvent({
        taskId: input.taskId,
        eventType: "step_final_completed",
        status: EXECUTION_STATUSES[1],
        phase: EXECUTION_PHASES[1],
        stepType: "final",
        progress: 95,
        message: "Final image generated",
        payload: {
          resultFileId,
          storageKey: savedResult.storageKey,
        },
      });

      return {
        resultFileId,
        resultStorageKey: savedResult.storageKey,
        lineartFileId,
        depthFileId,
        usedCachedLineart: intermediate.lineart?.status === "ready",
        usedCachedDepth: intermediate.depth?.status === "ready",
      };
    } finally {
      await intermediate.lineart?.release();
      await intermediate.depth?.release();
    }
  }

  private async ensureIntermediateArtifact(input: {
    runId: string;
    taskId: string;
    taskNo: string;
    reservation: IntermediateArtifactReservation;
    prompt: string;
    sourceFile: {
      buffer: Buffer;
      mimeType: string;
    };
    stepType: "lineart" | "depth";
    model: WhiteModelRenderExecutorInput["model"];
    imageSize: WhiteModelRenderExecutorInput["imageSize"];
    aspectRatio: WhiteModelRenderExecutorInput["aspectRatio"];
    resolvedSize: string | null;
  }): Promise<string> {
    if (input.reservation.status === "ready" && input.reservation.reusedFileId) {
      await this.executionsRepository.linkTaskFile({
        taskId: input.taskId,
        fileId: input.reservation.reusedFileId,
        role: "intermediate",
        sourceHandle: `intermediate.${input.stepType}`,
      });

      await this.executionsRepository.appendTaskEvent({
        taskId: input.taskId,
        eventType: "step_cache_hit",
        status: EXECUTION_STATUSES[1],
        phase: EXECUTION_PHASES[1],
        stepType: input.stepType,
        progress: input.stepType === "lineart" ? 20 : 45,
        message: `${input.stepType} cache hit`,
        payload: {
          artifactType: input.stepType,
          model: input.model,
          imageSize: input.imageSize,
          aspectRatio: input.aspectRatio,
          resolvedSize: input.resolvedSize,
          fileId: input.reservation.reusedFileId,
        },
      });

      return input.reservation.reusedFileId;
    }

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "step_cache_miss",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: input.stepType,
      progress: input.stepType === "lineart" ? 5 : 30,
      message: `${input.stepType} cache miss`,
      payload: {
        artifactType: input.stepType,
        model: input.model,
        imageSize: input.imageSize,
        aspectRatio: input.aspectRatio,
        resolvedSize: input.resolvedSize,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType:
        input.stepType === "lineart" ? "step_lineart_started" : "step_depth_started",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: input.stepType,
      progress: input.stepType === "lineart" ? 10 : 35,
      message: `${input.stepType} started`,
      payload: {
        model: input.model,
        imageSize: input.imageSize,
        aspectRatio: input.aspectRatio,
        resolvedSize: input.resolvedSize,
      },
    });

    try {
      const providerInput = this.buildProviderInput({
        prompt: input.prompt,
        taskNo: input.taskNo,
        snapshotLabelSuffix: input.stepType,
        model: input.model,
        imageSize: input.imageSize,
        aspectRatio: input.aspectRatio,
        resolvedSize: input.resolvedSize,
        images: [
          {
            mimeType: input.sourceFile.mimeType,
            dataBase64: input.sourceFile.buffer.toString("base64"),
          },
        ],
      });
      const response = await this.generateImageWithLog({
        taskId: input.taskId,
        stepType: input.stepType,
        providerInput,
      });

      const savedIntermediate = await this.storageService.saveBase64({
        sourceType: "intermediate",
        fileType: "image",
        originalName: `${input.taskNo}-${input.stepType}.png`,
        mimeType: response.mimeType,
        contentBase64: response.imageBase64,
      });

      const fileId = await this.registerStoredAsset({
        userId: null,
        stored: savedIntermediate,
        contentBase64: response.imageBase64,
      });

      await this.executionsRepository.linkTaskFile({
        taskId: input.taskId,
        fileId,
        role: "intermediate",
        sourceHandle: `intermediate.${input.stepType}`,
      });

      await this.intermediateArtifactService.markArtifactReady({
        reservation: input.reservation,
        fileId,
        lastTaskId: input.taskId,
      });

      await this.executionsRepository.appendTaskEvent({
        taskId: input.taskId,
        eventType:
          input.stepType === "lineart" ? "step_lineart_completed" : "step_depth_completed",
        status: EXECUTION_STATUSES[1],
        phase: EXECUTION_PHASES[1],
        stepType: input.stepType,
        progress: input.stepType === "lineart" ? 25 : 50,
        message: `${input.stepType} completed`,
        payload: {
          model: input.model,
          imageSize: input.imageSize,
          aspectRatio: input.aspectRatio,
          resolvedSize: input.resolvedSize,
          fileId,
          storageKey: savedIntermediate.storageKey,
        },
      });

      return fileId;
    } catch (error) {
      await this.intermediateArtifactService.markArtifactFailed({
        reservation: input.reservation,
        lastTaskId: input.taskId,
      });
      throw error;
    }
  }

  private resolveModelSize(input: WhiteModelRenderExecutorInput): string | null {
    if (input.model !== "gpt-image-2-vip") {
      return null;
    }

    if (!input.imageSize || !input.aspectRatio) {
      throw new Error("INVALID_WHITE_MODEL_RENDER_TASK_INPUT");
    }

    return resolveAIImageGenOutputSize(input.model, input.imageSize, input.aspectRatio);
  }

  private buildProviderInput(input: {
    prompt: string;
    taskNo: string;
    snapshotLabelSuffix: string;
    model: WhiteModelRenderExecutorInput["model"];
    imageSize: WhiteModelRenderExecutorInput["imageSize"];
    aspectRatio: WhiteModelRenderExecutorInput["aspectRatio"];
    resolvedSize: string | null;
    images: LaozhangImageInput[];
  }): LaozhangGenerateImageInput {
    const sharedInput = {
      prompt: input.prompt,
      images: input.images,
      snapshotLabel: `${input.taskNo}-${input.snapshotLabelSuffix}`,
    };

    if (input.model === "gpt-image-2-vip") {
      if (!input.resolvedSize || !input.aspectRatio || input.aspectRatio === "auto") {
        throw new Error("INVALID_WHITE_MODEL_RENDER_TASK_INPUT");
      }

      return {
        ...sharedInput,
        model: input.model,
        size: input.resolvedSize,
      };
    }

    if (input.model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL) {
      return {
        ...sharedInput,
        model: input.model,
      };
    }

      return {
        ...sharedInput,
        model: input.model,
        ...(input.imageSize ? { imageSize: input.imageSize } : {}),
        aspectRatio: input.aspectRatio === "auto"
          ? undefined
          : input.aspectRatio as LaozhangAspectRatio,
    };
  }

  private async generateImageWithLog(input: {
    taskId: string;
    stepType: "lineart" | "depth" | "final";
    providerInput: LaozhangGenerateImageInput;
  }): ReturnType<ProviderClientLike["generateImage"]> {
    return withProviderCallLog(this.providerCallLogRepository, {
      taskId: input.taskId,
      stepType: input.stepType,
      provider: this.resolveProviderName(input.providerInput.model),
      model: input.providerInput.model ?? "gemini-3-pro-image-preview",
      requestSummary: {
        snapshotLabel: input.providerInput.snapshotLabel,
        imageCount: input.providerInput.images.length,
      },
      call: async () => this.providerClient.generateImage(input.providerInput),
      summarizeSuccess: (result) => ({
        responseSummary: {
          mimeType: result.mimeType,
          snapshotPath: result.snapshotPath ?? null,
        },
        httpStatus: null,
      }),
    });
  }

  private resolveProviderName(model: LaozhangGenerateImageInput["model"]): string {
    return model === "gpt-image-2-official" ? "laozhang-sora2official" : "laozhang";
  }

  private async registerStoredAsset(input: {
    userId: string | null;
    stored: StorageWriteResult;
    contentBase64: string;
  }): Promise<string> {
    return this.fileAssetService.registerStoredAsset({
      userId: input.userId,
      stored: input.stored,
      content: input.contentBase64,
      fileType: "image",
    });
  }

  private async readFileOrThrow(
    fileId: string,
    errorCode: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const content = await this.filesRepository.readFileContent(fileId);

    if (!content) {
      throw new Error(errorCode);
    }

    return content;
  }
}
