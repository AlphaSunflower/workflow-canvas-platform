import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  RETRYABLE_ERROR_CODES,
} from "@newworkflow/backend-shared";
import type { ExecutionError } from "@newworkflow/backend-shared";

function isRetryableCode(code: ExecutionError["code"]): boolean {
  return (RETRYABLE_ERROR_CODES as readonly string[]).includes(code);
}

export function createRunningHubValidationError(
  message: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.validationError,
    message,
    category: ERROR_CATEGORIES.common,
    retryable: false,
    provider: "runninghub",
    details,
  };
}

export function createRunningHubTimeoutError(
  timeoutMs: number,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.timeout,
    message: `RunningHub 请求超时（${timeoutMs}ms）。`,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.timeout),
    provider: "runninghub",
    details,
  };
}

export function createRunningHubNetworkError(
  message: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.networkError,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.networkError),
    provider: "runninghub",
    details,
  };
}

export function createRunningHubProviderError(
  message: string,
  providerCode?: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.providerError,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.providerError),
    provider: "runninghub",
    providerCode,
    details,
  };
}

export function createRunningHubBackpressureError(
  message: string,
  providerCode = "task_queue_maxed",
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.providerError,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: true,
    provider: "runninghub",
    providerCode,
    details: {
      ...details,
      backpressure: true,
    },
  };
}

export function createRunningHubInvalidResponseError(
  message: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.invalidResponse,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.invalidResponse),
    provider: "runninghub",
    details,
  };
}
