import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  RETRYABLE_ERROR_CODES,
  RETRY_LIMITS,
} from "@newworkflow/backend-shared";
import type {
  ErrorCode,
  ExecutionError,
} from "@newworkflow/backend-shared";
import type {
  NormalizedExecutionError,
  RetryDecision,
  RetryEvaluateInput,
} from "./retry.types.ts";

export class RetryPolicyService {
  private readonly retryIntervalsMs: number[];
  private readonly providerBackpressureDelayMs: number;

  constructor(options?: {
    retryIntervalsMs?: number[];
    providerBackpressureDelayMs?: number;
  }) {
    this.retryIntervalsMs = options?.retryIntervalsMs ?? [3_000, 10_000];
    this.providerBackpressureDelayMs = options?.providerBackpressureDelayMs ?? 2_000;
  }

  normalizeError(error: unknown): NormalizedExecutionError {
    if (this.isExecutionError(error)) {
      return {
        ...error,
        code: error.code,
        message: error.message,
        retryable:
          typeof error.retryable === "boolean"
            ? error.retryable
            : (RETRYABLE_ERROR_CODES as readonly string[]).includes(error.code),
      };
    }

    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const knownRuntimeError = this.normalizeKnownRuntimeError(message);

    if (knownRuntimeError) {
      return knownRuntimeError;
    }

    return {
      code: ERROR_CODES.unknownError,
      message,
      category: ERROR_CATEGORIES.execution,
      retryable: false,
    };
  }

  evaluate(input: RetryEvaluateInput): RetryDecision {
    const nextAttemptNo = input.attemptNo + 1;
    const exhaustedAttempts = input.attemptNo >= input.maxAttempts;
    const shouldRetry = input.error.retryable && !exhaustedAttempts;

    return {
      shouldRetry,
      delayMs: shouldRetry
        ? this.retryIntervalsMs[input.attemptNo - 1] ?? 0
        : 0,
      nextAttemptNo,
      finalFailure: !shouldRetry,
    };
  }

  getMaxAttempts(): number {
    return RETRY_LIMITS.maxAttempts;
  }

  getRetryCountForAttempt(attemptNo: number): number {
    return Math.max(0, attemptNo - 1);
  }

  isProviderBackpressure(error: NormalizedExecutionError): boolean {
    return Boolean(
      (error.provider === "runninghub" || error.provider === "laozhang-veo")
      && (
        error.providerCode === "task_queue_maxed"
        || error.providerCode === "429"
        || error.details?.backpressure === true
      ),
    );
  }

  getProviderBackpressureDelayMs(): number {
    return this.providerBackpressureDelayMs;
  }

  private isExecutionError(error: unknown): error is ExecutionError {
    return Boolean(
      error
      && typeof error === "object"
      && "code" in error
      && "message" in error
      && typeof (error as { code?: ErrorCode }).code === "string",
    );
  }

  private normalizeKnownRuntimeError(
    message: string,
  ): NormalizedExecutionError | null {
    const runtimeStorageErrors = new Set([
      "WHITE_MODEL_FILE_NOT_FOUND",
      "STYLE_REFERENCE_FILE_NOT_FOUND",
      "LINEART_FILE_NOT_FOUND",
      "DEPTH_FILE_NOT_FOUND",
      "SOURCE_FILE_NOT_FOUND",
      "RENDER_FILE_NOT_FOUND",
      "REFERENCE_FILE_NOT_FOUND",
      "FILE_STORE_LOCK_TIMEOUT",
      "EXECUTION_STORE_LOCK_TIMEOUT",
    ]);

    if (
      runtimeStorageErrors.has(message)
      || message.startsWith("WHITE_MODEL_BLOB_NOT_FOUND:")
    ) {
      return {
        code: ERROR_CODES.storageError,
        message: "执行阶段读取文件或存储数据失败。",
        category: ERROR_CATEGORIES.storage,
        retryable: true,
        details: {
          cause: message,
        },
      };
    }

    if (
      message === "INVALID_WHITE_MODEL_TASK_INPUT"
      || message === "INVALID_AI_IMAGE_GEN_TASK_INPUT"
      || message === "INVALID_AI_IMAGE_INPAINT_TASK_INPUT"
      || message === "INVALID_AI_IMAGE_HD_TASK_INPUT"
      || message === "INVALID_AI_VIDEO_GEN_TASK_INPUT"
      || message === "INVALID_AI_MULTI_VIEW_RESTORE_TASK_INPUT"
      || message === "INVALID_AI_IMAGE_TO_PLY_TASK_INPUT"
      || message === "INVALID_AI_FLOORPLAN_COLORIZE_TASK_INPUT"
      || message === "GPT_IMAGE_2_OFFICIAL_IMAGE_EDIT_NOT_IMPLEMENTED"
      || message.startsWith("UNSUPPORTED_NODE_TYPE:")
    ) {
      return {
        code: ERROR_CODES.validationError,
        message: "任务输入与已注册节点执行器不匹配。",
        category: ERROR_CATEGORIES.execution,
        retryable: false,
        details: {
          cause: message,
        },
      };
    }

    if (message === "RUNNINGHUB_RESULT_FILE_URL_MISSING") {
      return {
        code: ERROR_CODES.invalidResponse,
        message: "RunningHub 返回成功结果，但结果文件 URL 缺失。",
        category: ERROR_CATEGORIES.providerRetryable,
        retryable: true,
        details: {
          cause: message,
        },
      };
    }

    if (message === "RUNNINGHUB_RESULT_FILE_TYPE_INVALID") {
      return {
        code: ERROR_CODES.validationError,
        message: "RunningHub 返回的结果文件类型不是预期的 ply。",
        category: ERROR_CATEGORIES.provider,
        retryable: false,
        details: {
          cause: message,
        },
      };
    }

    if (message === "RUNNINGHUB_RESULT_DOWNLOAD_FAILED") {
      return {
        code: ERROR_CODES.networkError,
        message: "RunningHub 结果文件下载失败。",
        category: ERROR_CATEGORIES.providerRetryable,
        retryable: true,
        details: {
          cause: message,
        },
      };
    }

    return null;
  }
}
