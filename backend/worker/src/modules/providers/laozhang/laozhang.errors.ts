import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  RETRYABLE_ERROR_CODES,
} from "@newworkflow/backend-shared";
import type { ExecutionError } from "@newworkflow/backend-shared";

function isRetryableCode(code: ExecutionError["code"]): boolean {
  return (RETRYABLE_ERROR_CODES as readonly string[]).includes(code);
}

export function createLaozhangValidationError(
  message: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.validationError,
    message,
    category: ERROR_CATEGORIES.common,
    retryable: false,
    provider: "laozhang",
    details,
  };
}

export function createLaozhangTimeoutError(
  timeoutMs: number,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.timeout,
    message: `老张 API 请求超时（${timeoutMs}ms）。`,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.timeout),
    provider: "laozhang",
    details,
  };
}

export function createLaozhangNetworkError(
  message: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.networkError,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.networkError),
    provider: "laozhang",
    details,
  };
}

export function createLaozhangProviderError(
  message: string,
  providerCode?: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.providerError,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.providerError),
    provider: "laozhang",
    providerCode,
    details,
  };
}

export function createLaozhangInvalidResponseError(
  message: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.invalidResponse,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.invalidResponse),
    provider: "laozhang",
    details,
  };
}
