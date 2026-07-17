export const ERROR_CATEGORIES = {
  common: "common",
  file: "file",
  execution: "execution",
  provider: "provider",
  providerRetryable: "provider_retryable",
  storage: "storage",
  keyPool: "key_pool",
} as const;

export const ERROR_CODES = {
  unknownError: "UNKNOWN_ERROR",
  internalError: "INTERNAL_ERROR",
  validationError: "VALIDATION_ERROR",
  notFound: "NOT_FOUND",
  forbidden: "FORBIDDEN",
  fileRegisterFailed: "FILE_REGISTER_FAILED",
  fileUploadFailed: "FILE_UPLOAD_FAILED",
  fileHashMismatch: "FILE_HASH_MISMATCH",
  filePreviewFailed: "FILE_PREVIEW_FAILED",
  fileDownloadFailed: "FILE_DOWNLOAD_FAILED",
  executionCreateFailed: "EXECUTION_CREATE_FAILED",
  taskCreateFailed: "TASK_CREATE_FAILED",
  taskCancelFailed: "TASK_CANCEL_FAILED",
  timeout: "TIMEOUT",
  networkError: "NETWORK_ERROR",
  providerError: "PROVIDER_ERROR",
  invalidResponse: "INVALID_RESPONSE",
  artifactDecodeFailed: "ARTIFACT_DECODE_FAILED",
  storageError: "STORAGE_ERROR",
  cancelled: "CANCELLED",
  keyNotAvailable: "KEY_NOT_AVAILABLE",
  keyDisabled: "KEY_DISABLED",
  keyCircuitOpen: "KEY_CIRCUIT_OPEN",
  keyLeaseFailed: "KEY_LEASE_FAILED",
  keyReleaseFailed: "KEY_RELEASE_FAILED",
} as const;

export const RETRYABLE_ERROR_CODES = [
  ERROR_CODES.timeout,
  ERROR_CODES.networkError,
  ERROR_CODES.providerError,
  ERROR_CODES.invalidResponse,
  ERROR_CODES.artifactDecodeFailed,
  ERROR_CODES.storageError,
] as const;

export const NON_RETRYABLE_ERROR_CODES = [
  ERROR_CODES.validationError,
  ERROR_CODES.forbidden,
  ERROR_CODES.cancelled,
] as const;

export type ErrorCategory =
  (typeof ERROR_CATEGORIES)[keyof typeof ERROR_CATEGORIES];

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ExecutionError {
  code: ErrorCode;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
  provider?: string;
  providerCode?: string;
  attemptNo?: number;
  details?: Record<string, unknown>;
}
