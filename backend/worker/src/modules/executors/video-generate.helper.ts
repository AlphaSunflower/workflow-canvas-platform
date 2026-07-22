import {
  AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
  AI_VIDEO_GEN_DEFAULT_TIMEOUT_MS,
  AI_VIDEO_GEN_PROVIDER,
  EXECUTION_PHASES,
  EXECUTION_STATUSES,
  ERROR_CATEGORIES,
  ERROR_CODES,
} from "@newworkflow/backend-shared";
import type {
  AIVideoGenSupportedAspectRatio,
  AIVideoGenSupportedModel,
  AIVideoGenSupportedResolution,
  AIVideoGenSupportedSize,
  ExecutionError,
} from "@newworkflow/backend-shared";
import type { ExecutionsRepository } from "../../../../api/src/modules/executions/executions.repository.types.ts";
import type { FilesRepository } from "../../../../api/src/modules/files/files.repository.types.ts";
import { WorkerFileAssetService } from "../files/worker-file-asset.service.ts";
import type { ProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { NoopProviderCallLogRepository } from "../provider-call-logs/provider-call-log.repository.ts";
import { withProviderCallLog } from "../provider-call-logs/provider-call-logger.ts";
import { StorageService } from "../storage/storage.service.ts";
import type { StorageWriteResult } from "../storage/storage.types.ts";

const VIDEO_CONTENT_READY_RETRY_DELAYS_MS = [10_000, 20_000, 30_000] as const;

interface VideoProviderClientLike {
  createVideoTask(input: {
    prompt: string;
    model: AIVideoGenSupportedModel;
    duration: number;
    aspectRatio: AIVideoGenSupportedAspectRatio;
    resolution: AIVideoGenSupportedResolution;
    size: AIVideoGenSupportedSize;
    metadata?: string;
    inputReferences?: Array<{
      fileName: string;
      mimeType: string;
      buffer: Buffer;
    }>;
    timeoutMs?: number;
    snapshotLabel?: string;
  }): Promise<{
    id: string;
    status: string;
    snapshotPath: string;
  }>;
  getVideoTask(input: {
    videoId: string;
    timeoutMs?: number;
    snapshotLabel?: string;
  }): Promise<{
    id: string;
    status: string;
    progress?: number | null;
    videoUrl: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    snapshotPath: string;
  }>;
  getVideoContent(input: {
    videoId: string;
    timeoutMs?: number;
    snapshotLabel?: string;
  }): Promise<{
    id: string;
    status: string;
    url: string | null;
    videoUrl?: string | null;
    duration: number | null;
    resolution: string | null;
    snapshotPath: string;
    video?: {
      buffer: Buffer;
      mimeType: string;
      size: number;
      snapshotPath: string;
    };
  }>;
  downloadVideo(input: {
    url: string;
    timeoutMs?: number;
    snapshotLabel?: string;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    size: number;
    snapshotPath: string;
  }>;
}

export interface VideoGenerateHelperInput {
  userId: string;
  taskId: string;
  taskNo: string;
  prompt: string;
  model: AIVideoGenSupportedModel;
  duration: number;
  aspectRatio: AIVideoGenSupportedAspectRatio;
  resolution: AIVideoGenSupportedResolution;
  size: AIVideoGenSupportedSize;
  metadata?: string;
  referenceFileIds: string[];
  outputFileName?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface VideoGenerateHelperResult {
  providerVideoId: string;
  resultFileId: string;
  resultStorageKey: string;
}

function createTerminalProviderError(
  message: string,
  providerCode?: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.providerError,
    message,
    category: ERROR_CATEGORIES.provider,
    retryable: false,
    provider: AI_VIDEO_GEN_PROVIDER,
    providerCode,
    details,
  };
}

function createRetryableProviderError(
  message: string,
  providerCode?: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.providerError,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: true,
    provider: AI_VIDEO_GEN_PROVIDER,
    providerCode,
    details,
  };
}

function isExecutionError(error: unknown): error is ExecutionError {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && "message" in error
    && "retryable" in error,
  );
}

function isContentNotReadyError(error: unknown): boolean {
  if (!isExecutionError(error)) {
    return false;
  }

  const details = error.details ?? {};
  const responseBody = typeof details.responseBody === "string"
    ? details.responseBody.toLowerCase()
    : "";
  const message = error.message.toLowerCase();

  return (
    (message.includes("rejected request parameters") || message.includes("http 400"))
    && responseBody.includes("in_progress")
    && responseBody.includes("not completed")
  );
}

export class VideoGenerateHelper {
  private readonly executionsRepository: ExecutionsRepository;
  private readonly filesRepository: FilesRepository;
  private readonly fileAssetService: WorkerFileAssetService;
  private readonly providerClient: VideoProviderClientLike;
  private readonly providerCallLogRepository: ProviderCallLogRepository;
  private readonly storageService: StorageService;
  private readonly defaultPollIntervalMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(
    executionsRepository: ExecutionsRepository,
    filesRepository: FilesRepository,
    providerClient: VideoProviderClientLike,
    storageService: StorageService,
    options?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
      sleepImpl?: (ms: number) => Promise<void>;
      providerCallLogRepository?: ProviderCallLogRepository;
    },
  ) {
    this.executionsRepository = executionsRepository;
    this.filesRepository = filesRepository;
    this.fileAssetService = new WorkerFileAssetService(filesRepository);
    this.providerClient = providerClient;
    this.providerCallLogRepository =
      options?.providerCallLogRepository ?? new NoopProviderCallLogRepository();
    this.storageService = storageService;
    this.defaultPollIntervalMs = Math.max(250, options?.pollIntervalMs ?? 5_000);
    this.defaultTimeoutMs = Math.max(1_000, options?.timeoutMs ?? AI_VIDEO_GEN_DEFAULT_TIMEOUT_MS);
    this.sleepImpl = options?.sleepImpl ?? (async (ms: number) => {
      await new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    });
  }

  async execute(input: VideoGenerateHelperInput): Promise<VideoGenerateHelperResult> {
    const startedAt = Date.now();
    const timeoutMs = Math.max(1_000, input.timeoutMs ?? this.defaultTimeoutMs);
    const pollIntervalMs = Math.max(250, input.pollIntervalMs ?? this.defaultPollIntervalMs);
    const referenceFiles = await Promise.all(
      input.referenceFileIds.map(async (fileId) =>
        this.readFileOrThrow(fileId, "REFERENCE_FILE_NOT_FOUND")),
    );

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "step_final_started",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 5,
      message: "AI 视频生成开始。",
      payload: {
        prompt: input.prompt,
        model: input.model,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        size: input.size,
        referenceFileIds: input.referenceFileIds,
      },
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 15,
      message: "开始创建 Veo 异步视频任务。",
      payload: {
        model: input.model,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        size: input.size,
        referenceFileCount: referenceFiles.length,
      },
    });

    const createInput = {
      prompt: input.prompt,
      model: input.model,
      duration: input.duration,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      size: input.size,
      metadata: input.metadata,
      inputReferences: referenceFiles.map((file, index) => ({
        fileName: `${input.taskNo}-reference-${index + 1}${this.resolveExtension(file.mimeType)}`,
        mimeType: file.mimeType,
        buffer: file.buffer,
      })),
      timeoutMs,
      snapshotLabel: `${input.taskNo}-veo-create`,
    };
    const createResult = await withProviderCallLog(this.providerCallLogRepository, {
      taskId: input.taskId,
      stepType: "veo_create",
      provider: AI_VIDEO_GEN_PROVIDER,
      model: input.model,
      requestSummary: {
        snapshotLabel: createInput.snapshotLabel,
        promptLength: input.prompt.length,
        referenceCount: createInput.inputReferences.length,
        submittedReferenceCount: Math.min(createInput.inputReferences.length, 1),
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        size: input.size,
      },
      call: async () => this.providerClient.createVideoTask(createInput),
      summarizeSuccess: (result) => ({
        responseSummary: {
          providerVideoId: result.id,
          status: result.status,
          snapshotPath: result.snapshotPath,
        },
        httpStatus: null,
      }),
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 25,
      message: "Veo 异步视频任务已创建。",
      payload: {
        providerVideoId: createResult.id,
        providerStatus: createResult.status,
        snapshotPath: createResult.snapshotPath,
      },
    });

    const finalStatus = await this.pollUntilCompleted({
      internalTaskId: input.taskId,
      taskNo: input.taskNo,
      providerVideoId: createResult.id,
      model: input.model,
      pollIntervalMs,
      timeoutMs,
      startedAt,
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_progress",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 70,
      message: "Veo 任务已完成，开始获取视频内容地址。",
      payload: {
        providerVideoId: createResult.id,
        providerStatus: finalStatus.status,
        snapshotPath: finalStatus.snapshotPath,
      },
    });

    const contentResult = await this.resolveVideoContent({
      taskId: input.taskId,
      taskNo: input.taskNo,
      model: input.model,
      providerVideoId: createResult.id,
      timeoutMs,
      startedAt,
      finalStatus,
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "task_artifact_received",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 78,
      message: "已拿到 Veo 视频内容地址。",
      payload: {
        providerVideoId: contentResult.id,
        providerStatus: contentResult.status,
        resultUrl: contentResult.url,
        resolvedFrom: contentResult.resolvedFrom,
        inlineVideo: Boolean(contentResult.video),
        duration: contentResult.duration,
        resolution: contentResult.resolution,
        snapshotPath: contentResult.snapshotPath,
      },
    });

    const downloadResult = contentResult.video ?? await this.downloadVideoContent({
      contentResult,
      taskId: input.taskId,
      taskNo: input.taskNo,
      model: input.model,
      timeoutMs,
    });

    const outputFileName = input.outputFileName ?? `${input.taskNo}-ai-video-gen.mp4`;
    const savedResult = await this.storageService.saveBuffer({
      sourceType: "output",
      fileType: "video",
      originalName: outputFileName,
      mimeType: downloadResult.mimeType || "video/mp4",
      buffer: downloadResult.buffer,
    });

    const resultFileId = await this.registerStoredAsset({
      userId: input.userId,
      stored: savedResult,
      buffer: downloadResult.buffer,
      duration: contentResult.duration ?? input.duration ?? AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
    });

    await this.executionsRepository.updateTaskResultFile(input.taskId, resultFileId);
    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      eventType: "step_final_completed",
      status: EXECUTION_STATUSES[1],
      phase: EXECUTION_PHASES[1],
      stepType: "final",
      progress: 95,
      message: "AI 视频生成结果已下载并落库。",
      payload: {
        providerVideoId: createResult.id,
        providerStatus: contentResult.status,
        resultFileId,
        resultUrl: contentResult.url,
        storageKey: savedResult.storageKey,
        snapshotPath: downloadResult.snapshotPath,
      },
    });

    return {
      providerVideoId: createResult.id,
      resultFileId,
      resultStorageKey: savedResult.storageKey,
    };
  }

  private async downloadVideoContent(input: {
    contentResult: {
      url: string | null;
    };
    taskId: string;
    taskNo: string;
    model: AIVideoGenSupportedModel;
    timeoutMs: number;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    size: number;
    snapshotPath: string;
  }> {
    if (!input.contentResult.url) {
      throw createTerminalProviderError(
        "Laozhang Veo content response does not include a downloadable video URL.",
        "LAOZHANG_VEO_CONTENT_URL_MISSING",
      );
    }

    const snapshotLabel = `${input.taskNo}-veo-download`;
    return withProviderCallLog(this.providerCallLogRepository, {
      taskId: input.taskId,
      stepType: "veo_download",
      provider: AI_VIDEO_GEN_PROVIDER,
      model: input.model,
      requestSummary: {
        url: input.contentResult.url,
        snapshotLabel,
      },
      call: async () => this.providerClient.downloadVideo({
        url: input.contentResult.url!,
        timeoutMs: input.timeoutMs,
        snapshotLabel,
      }),
      summarizeSuccess: (result) => ({
        responseSummary: {
          mimeType: result.mimeType,
          size: result.size,
          snapshotPath: result.snapshotPath,
        },
        httpStatus: null,
      }),
    });
  }

  private async resolveVideoContent(input: {
    taskId: string;
    taskNo: string;
    model: AIVideoGenSupportedModel;
    providerVideoId: string;
    timeoutMs: number;
    startedAt: number;
    finalStatus: {
      status: string;
      videoUrl: string | null;
      snapshotPath: string;
    };
  }): Promise<{
    id: string;
    status: string;
    url: string | null;
    videoUrl?: string | null;
    duration: number | null;
    resolution: string | null;
    snapshotPath: string;
    video?: {
      buffer: Buffer;
      mimeType: string;
      size: number;
      snapshotPath: string;
    };
    resolvedFrom: "content-bytes" | "content" | "status-fallback";
  }> {
    const attemptDelays = [0, ...VIDEO_CONTENT_READY_RETRY_DELAYS_MS];

    for (let attemptIndex = 0; attemptIndex < attemptDelays.length; attemptIndex += 1) {
      const delayMs = attemptDelays[attemptIndex] ?? 0;
      const attemptNo = attemptIndex + 1;

      if (delayMs > 0) {
        if (Date.now() - input.startedAt + delayMs >= input.timeoutMs) {
          break;
        }

        await this.executionsRepository.appendTaskEvent({
          taskId: input.taskId,
          eventType: "task_progress",
          status: EXECUTION_STATUSES[1],
          phase: EXECUTION_PHASES[1],
          stepType: "final",
          progress: 72,
          message: `Veo 鐘舵€佸凡瀹屾垚锛岀瓑寰呰棰戞枃浠惰惤搴撳悗閲嶈瘯鑾峰彇鍐呭锛岀 ${attemptNo} 娆°€?`,
          payload: {
            providerVideoId: input.providerVideoId,
            delayMs,
            contentAttempt: attemptNo,
          },
        });
        await this.sleepImpl(delayMs);
      }

      try {
        const snapshotLabel = attemptNo === 1
          ? `${input.taskNo}-veo-content`
          : `${input.taskNo}-veo-content-${String(attemptNo).padStart(3, "0")}`;
        const result = await withProviderCallLog(this.providerCallLogRepository, {
          taskId: input.taskId,
          stepType: "veo_content",
          provider: AI_VIDEO_GEN_PROVIDER,
          model: input.model,
          requestSummary: {
            providerVideoId: input.providerVideoId,
            snapshotLabel,
            contentAttempt: attemptNo,
          },
          call: async () => this.providerClient.getVideoContent({
            videoId: input.providerVideoId,
            timeoutMs: input.timeoutMs,
            snapshotLabel,
          }),
          summarizeSuccess: (content) => ({
            responseSummary: {
              providerVideoId: content.id,
              status: content.status,
              url: content.url,
              videoUrl: content.videoUrl,
              inlineVideo: Boolean(content.video),
              snapshotPath: content.snapshotPath,
              contentAttempt: attemptNo,
            },
            httpStatus: null,
          }),
        });

        return {
          ...result,
          resolvedFrom: result.video ? "content-bytes" as const : "content" as const,
        };
      } catch (error) {
        if (isContentNotReadyError(error) && attemptIndex < attemptDelays.length - 1) {
          continue;
        }

        if (input.finalStatus.videoUrl) {
          return {
            id: input.providerVideoId,
            status: input.finalStatus.status,
            url: input.finalStatus.videoUrl,
            videoUrl: input.finalStatus.videoUrl,
            duration: null,
            resolution: null,
            snapshotPath: input.finalStatus.snapshotPath,
            video: undefined,
            resolvedFrom: "status-fallback" as const,
          };
        }

        throw error;
      }
    }

    if (input.finalStatus.videoUrl) {
      return {
        id: input.providerVideoId,
        status: input.finalStatus.status,
        url: input.finalStatus.videoUrl,
        videoUrl: input.finalStatus.videoUrl,
        duration: null,
        resolution: null,
        snapshotPath: input.finalStatus.snapshotPath,
        video: undefined,
        resolvedFrom: "status-fallback" as const,
      };
    }

    throw createTerminalProviderError(
      "Laozhang Veo content endpoint did not become ready after completion.",
      "LAOZHANG_VEO_CONTENT_NOT_READY",
      {
        providerVideoId: input.providerVideoId,
        finalStatus: input.finalStatus.status,
        retryDelaysMs: VIDEO_CONTENT_READY_RETRY_DELAYS_MS,
      },
    );
  }

  private async pollUntilCompleted(input: {
    internalTaskId: string;
    taskNo: string;
    providerVideoId: string;
    model: AIVideoGenSupportedModel;
    pollIntervalMs: number;
    timeoutMs: number;
    startedAt: number;
  }): Promise<{
    status: string;
    videoUrl: string | null;
    snapshotPath: string;
  }> {
    let pollAttempt = 0;

    while (Date.now() - input.startedAt < input.timeoutMs) {
      pollAttempt += 1;

      const snapshotLabel = `${input.taskNo}-veo-status-${String(pollAttempt).padStart(3, "0")}`;
      const statusResult = await withProviderCallLog(this.providerCallLogRepository, {
        taskId: input.internalTaskId,
        stepType: "veo_status",
        provider: AI_VIDEO_GEN_PROVIDER,
        model: input.model,
        requestSummary: {
          providerVideoId: input.providerVideoId,
          pollAttempt,
          snapshotLabel,
        },
        call: async () => this.providerClient.getVideoTask({
          videoId: input.providerVideoId,
          timeoutMs: input.timeoutMs,
          snapshotLabel,
        }),
        summarizeSuccess: (result) => {
          const status = result.status.trim().toLowerCase();
          return {
            responseSummary: {
              providerVideoId: result.id,
              status: result.status,
              videoUrl: result.videoUrl,
              progress: result.progress ?? null,
              snapshotPath: result.snapshotPath,
            },
            httpStatus: null,
            success: status !== "failed",
            errorCode: status === "failed" ? result.errorCode ?? "LAOZHANG_VEO_TASK_FAILED" : null,
            errorMessage: status === "failed" ? result.errorMessage ?? "Laozhang Veo task failed." : null,
          };
        },
      });

      const normalizedStatus = statusResult.status.trim().toLowerCase();

      if (normalizedStatus === "completed") {
        return {
          status: statusResult.status,
          videoUrl: statusResult.videoUrl,
          snapshotPath: statusResult.snapshotPath,
        };
      }

      if (normalizedStatus === "failed") {
        const providerCode = statusResult.errorCode ?? "LAOZHANG_VEO_TASK_FAILED";
        const providerMessage = statusResult.errorMessage ?? "Laozhang Veo task failed.";
        const details = {
          providerVideoId: input.providerVideoId,
          taskStatus: statusResult.status,
          snapshotPath: statusResult.snapshotPath,
        };

        if (!statusResult.errorCode && !statusResult.errorMessage) {
          throw createRetryableProviderError(
            providerMessage,
            providerCode,
            details,
          );
        }

        throw createTerminalProviderError(
          providerMessage,
          providerCode,
          details,
        );
      }

      await this.executionsRepository.appendTaskEvent({
        taskId: input.internalTaskId,
        eventType: "task_progress",
        status: EXECUTION_STATUSES[1],
        phase: EXECUTION_PHASES[1],
        stepType: "final",
        progress: 40,
        message: `Veo 任务处理中，第 ${pollAttempt} 次轮询，当前状态 ${statusResult.status}。`,
        payload: {
          providerVideoId: input.providerVideoId,
          taskStatus: statusResult.status,
          providerVideoUrl: statusResult.videoUrl,
          providerProgress: statusResult.progress ?? null,
          pollAttempt,
          snapshotPath: statusResult.snapshotPath,
        },
      });

      await this.sleepImpl(input.pollIntervalMs);
    }

    const timeoutError: ExecutionError = {
      code: ERROR_CODES.timeout,
      message: "Laozhang Veo polling timed out before completion.",
      category: ERROR_CATEGORIES.providerRetryable,
      retryable: true,
      provider: AI_VIDEO_GEN_PROVIDER,
      details: {
        providerVideoId: input.providerVideoId,
        timeoutMs: input.timeoutMs,
        pollIntervalMs: input.pollIntervalMs,
      },
    };

    throw timeoutError;
  }

  private async registerStoredAsset(input: {
    userId: string;
    stored: StorageWriteResult;
    buffer: Buffer;
    duration: number;
  }): Promise<string> {
    return this.fileAssetService.registerStoredAsset({
      userId: input.userId,
      stored: input.stored,
      content: input.buffer,
      fileType: "video",
      sourceType: "output",
      duration: input.duration,
    });
  }

  private async readFileOrThrow(
    fileId: string,
    errorCode: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const content = await this.filesRepository.readFileContent(fileId);

    if (!content) {
      throw new Error(`${errorCode}: ${fileId}`);
    }

    return content;
  }

  private resolveExtension(mimeType: string): string {
    if (mimeType === "image/jpeg") {
      return ".jpg";
    }

    if (mimeType === "image/webp") {
      return ".webp";
    }

    if (mimeType === "image/heic") {
      return ".heic";
    }

    return ".png";
  }
}
