import type { AppError } from '@/types';

export type RefreshFailureDisposition = 'hard' | 'soft';
export type RefreshFailureReason = 'session_invalid' | 'temporary_failure';

export interface RefreshFailureRecord {
  disposition: RefreshFailureDisposition;
  reason: RefreshFailureReason;
  occurredAt: number;
  errorCode: string;
  statusCode: number | null;
}

const HARD_ERROR_CODES = new Set([
  'AUTH_ACCOUNT_DISABLED',
  'AUTH_USER_NOT_FOUND',
]);

const HARD_ERROR_PREFIXES = [
  'TOKEN_',
  'SESSION_',
];

const SOFT_ERROR_CODES = new Set([
  'NETWORK_ERROR',
  'TIMEOUT_ERROR',
  'UNKNOWN_ERROR',
]);

function getStatusCode(error: AppError): number | null {
  const value = error.context?.status;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getErrorCode(error: AppError): string {
  const backendError = error.context?.backendError;
  if (typeof backendError === 'string' && backendError.trim().length > 0) {
    return backendError.trim();
  }

  return typeof error.code === 'string' && error.code.trim().length > 0
    ? error.code.trim()
    : 'UNKNOWN_ERROR';
}

export function analyzeRefreshFailure(
  error: AppError,
  occurredAt = Date.now(),
): RefreshFailureRecord {
  const errorCode = getErrorCode(error);
  const statusCode = getStatusCode(error);

  if (
    HARD_ERROR_CODES.has(errorCode)
    || HARD_ERROR_PREFIXES.some((prefix) => errorCode.startsWith(prefix))
  ) {
    return {
      disposition: 'hard',
      reason: 'session_invalid',
      occurredAt,
      errorCode,
      statusCode,
    };
  }

  if (
    SOFT_ERROR_CODES.has(errorCode)
    || (typeof statusCode === 'number' && statusCode >= 500)
  ) {
    return {
      disposition: 'soft',
      reason: 'temporary_failure',
      occurredAt,
      errorCode,
      statusCode,
    };
  }

  return {
    disposition: 'hard',
    reason: 'session_invalid',
    occurredAt,
    errorCode,
    statusCode,
  };
}

export function annotateRefreshFailure(
  error: AppError,
  analysis: RefreshFailureRecord,
): AppError {
  return {
    ...error,
    context: {
      ...error.context,
      refreshFailureDisposition: analysis.disposition,
      refreshFailureReason: analysis.reason,
      refreshFailureAt: analysis.occurredAt,
      refreshFailureCode: analysis.errorCode,
      refreshFailureStatus: analysis.statusCode,
      refreshFailureHandled: true,
    },
  };
}

export function isRefreshFailureHandled(error: AppError): boolean {
  return error.context?.refreshFailureHandled === true;
}
