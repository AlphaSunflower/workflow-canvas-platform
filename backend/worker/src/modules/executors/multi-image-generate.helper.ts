import {
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
  EXECUTION_PHASES,
  EXECUTION_STATUSES,
  LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE,
  type AIImageGenOfficialQuality,
} from "@newworkflow/backend-shared";
import type {
  LaozhangGenerateImageInput,
  LaozhangImageInput,
} from "../providers/laozhang/laozhang.types.ts";
import type { ExecutionsRepository } from "../../../../api/src/modules/executions/executions.repository.types.ts";
import type { FilesRepository } from "../../../../api/src/modules/files/files.repository.types.ts";
import { WorkerFileAssetService } from "../files/worker-file-asset.service.ts";
import type { ProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { NoopProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { withProviderCallLog } from "../provider-call-logs/provider-call-logger.ts";
import { StorageService } from "../storage/storage.service.ts";
import type { StorageWriteResult } from "../storage/storage.types.ts";

interface ProviderClientLike {
  generateImage(input: LaozhangGenerateImageInput): Promise<{
    imageBase64: string;
    mimeType: string;
    snapshotPath?: string;
  }>;
}

type MultiImageGenerateHelperSharedInput = {
  userId: string;
  taskId: string;
  taskNo: string;
  prompt: string;
  referenceFileIds: string[];
  outputFileName?: string;
  outputProgress?: {
    started?: number;
    completed?: number;
  };
};

export type MultiImageGenerateHelperInput =
  | (MultiImageGenerateHelperSharedInput & {
    model: typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
  })
  | (MultiImageGenerateHelperSharedInput & {
    model: "gpt-image-2-vip";
    resolvedSize: string;
    imageSize: "1K" | "2K" | "4K";
    aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9" | "3:2" | "2:3" | "5:4" | "4:5";
  })
  | (MultiImageGenerateHelperSharedInput & {
    model: typeof AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL;
    providerRoute: typeof LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE;
    providerModel: typeof AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL;
    resolvedSize: string;
    quality: AIImageGenOfficialQuality;
    referenceFileIds: [];
    imageSize: "1K" | "2K" | "4K";
    aspectRatio: "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9" | "3:2" | "2:3" | "5:4" | "4:5";
  })
  | (MultiImageGenerateHelperSharedInput & {
    model?: Exclude<LaozhangGenerateImageInput["model"], typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL | "gpt-image-2-vip" | "gpt-image-2-official">;
    imageSize?: "1K" | "2K" | "4K";
    aspectRatio?: LaozhangGenerateImageInput["aspectRatio"];
  });

export interface MultiImageGenerateHelperResult {
  resultFileId: string;
  resultStorageKey: string;
}

export class MultiImageGenerateHelper {
  private readonly executionsRepository: ExecutionsRepository;
  private readonly filesRepository: FilesRepository;
  private readonly fileAssetService: WorkerFileAssetService;
  private readonly providerClient: ProviderClientLike;
  private readonly providerCallLogRepository: ProviderCallLogRepository;
  private readonly storageService: StorageService;

  constructor(
    executionsRepository: ExecutionsRepository,
    filesRepository: FilesRepository,
    providerClient: ProviderClientLike,
    storageService: StorageService,
    providerCallLogRepository: ProviderCallLogRepository = new NoopProviderCallLogRepository(),
  ) {
    this.executionsRepository = executionsRepository;
    this.filesRepository = filesRepository;
    this.fileAssetService = new WorkerFileAssetService(filesRepository);
    this.providerClient = providerClient;
    this.providerCallLogRepository = providerCallLogRepository;
    this.storageService = storageService;
  }

  async execute(input: MultiImageGenerateHelperInput): Promise<MultiImageGenerateHelperResult> {
    const referenceFiles = await Promise.all(
      input.referenceFileIds.map(async (fileId) => this.readFileOrThrow(fileId, "REFERENCE_FILE_NOT_FOUND")),
    );

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "step_final_started",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: input.outputProgress?.started ?? 70,
      message: "多图生成开始。",
      payload: this.buildStartPayload(input),
    });

    const providerInput = this.buildProviderInput(input, referenceFiles.map((file) => ({
        mimeType: file.mimeType,
        dataBase64: file.buffer.toString("base64"),
      })));
    const response = await this.generateImageWithLog({
      taskId: input.taskId,
      providerInput,
    });

    const outputFileName = input.outputFileName ?? `${input.taskNo}-ai-image-gen.png`;
    const savedResult = await this.storageService.saveBase64({
      sourceType: "output",
      fileType: "image",
      originalName: outputFileName,
      mimeType: response.mimeType,
      contentBase64: response.imageBase64,
    });

    const resultFileId = await this.registerStoredAsset({
      userId: input.userId,
      stored: savedResult,
      contentBase64: response.imageBase64,
    });

    await this.executionsRepository.updateTaskResultFile(input.taskId, resultFileId);
    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "step_final_completed",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: input.outputProgress?.completed ?? 95,
      message: "多图生成完成。",
      payload: {
        resultFileId,
        storageKey: savedResult.storageKey,
      },
    });

    return {
      resultFileId,
      resultStorageKey: savedResult.storageKey,
    };
  }

  private buildProviderInput(
    input: MultiImageGenerateHelperInput,
    images: LaozhangImageInput[],
  ): LaozhangGenerateImageInput {
    const sharedInput = {
      prompt: input.prompt,
      images,
      snapshotLabel: `${input.taskNo}-multi-image`,
    };

    if (input.model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL) {
      return {
        ...sharedInput,
        model: input.model,
      };
    }

    if (input.model === "gpt-image-2-vip") {
      return {
        ...sharedInput,
        model: input.model,
        size: input.resolvedSize,
      };
    }

    if (input.model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL) {
      return {
        ...sharedInput,
        images: [],
        model: input.model,
        providerModel: input.providerModel,
        size: input.resolvedSize,
        quality: input.quality,
      };
    }

    return {
      ...sharedInput,
      model: input.model,
      imageSize: input.imageSize,
      aspectRatio: input.aspectRatio,
    };
  }

  private buildStartPayload(input: MultiImageGenerateHelperInput): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      referenceFileIds: input.referenceFileIds,
      model: input.model ?? null,
      imageSize: "imageSize" in input ? input.imageSize ?? null : null,
      aspectRatio: "aspectRatio" in input ? input.aspectRatio ?? null : null,
      resolvedSize: null,
    };

    if (input.model === "gpt-image-2-vip") {
      payload.resolvedSize = input.resolvedSize;
    }

    if (input.model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL) {
      payload.quality = input.quality;
      payload.providerRoute = input.providerRoute;
      payload.providerModel = input.providerModel;
      payload.resolvedSize = input.resolvedSize;
    }

    return payload;
  }

  private async generateImageWithLog(input: {
    taskId: string;
    providerInput: LaozhangGenerateImageInput;
  }): ReturnType<ProviderClientLike["generateImage"]> {
    return withProviderCallLog(this.providerCallLogRepository, {
      taskId: input.taskId,
      stepType: "final",
      provider: this.resolveProviderName(input.providerInput.model),
      model: input.providerInput.model ?? "gemini-3-pro-image-preview",
      requestSummary: {
        snapshotLabel: input.providerInput.snapshotLabel,
        imageCount: input.providerInput.images.length,
        imageSize: input.providerInput.imageSize ?? null,
        aspectRatio: input.providerInput.aspectRatio ?? null,
        size: input.providerInput.size ?? null,
        providerModel: "providerModel" in input.providerInput
          ? input.providerInput.providerModel ?? null
          : null,
        quality: "quality" in input.providerInput ? input.providerInput.quality : null,
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
    return model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL
      ? "laozhang-sora2official"
      : "laozhang";
  }

  private async registerStoredAsset(input: {
    userId: string;
    stored: StorageWriteResult;
    contentBase64: string;
  }): Promise<string> {
    return this.fileAssetService.registerStoredAsset({
      userId: input.userId,
      stored: input.stored,
      content: input.contentBase64,
      fileType: "image",
      sourceType: "output",
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
