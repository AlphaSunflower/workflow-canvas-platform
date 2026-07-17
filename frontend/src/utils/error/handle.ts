import type { AppError, Result, ErrorCode } from '@/types';
import { createModuleLogger } from '../logger';

import { createError } from './create';

const log = createModuleLogger('error-handler');

function isAppError(error: unknown): error is AppError {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string'
    && 'message' in error
    && typeof (error as { message?: unknown }).message === 'string'
  );
}

export function handleError(
  error: unknown,
  module: string,
  operation: string,
  defaultMessage = 'An unexpected error occurred'
): AppError {
  const timestamp = Date.now();

  if (isAppError(error)) {
    log.error(operation, error.message, undefined, {
      code: error.code,
      context: error.context,
    });
    return error;
  }

  if (error instanceof Error) {
    const appError = createError(
      'UNKNOWN_ERROR' as ErrorCode,
      error.message || defaultMessage,
      {
        module,
        operation,
        timestamp,
        stack: error.stack,
        cause: error,
      }
    );
    log.error(operation, error.message, error);
    return appError;
  }

  if (typeof error === 'string') {
    const appError = createError(
      'UNKNOWN_ERROR' as ErrorCode,
      error || defaultMessage,
      {
        module,
        operation,
        timestamp,
      }
    );
    log.error(operation, error);
    return appError;
  }

  const appError = createError(
    'UNKNOWN_ERROR' as ErrorCode,
    defaultMessage,
    {
      module,
      operation,
      timestamp,
      input: error,
    }
  );
  log.error(operation, defaultMessage, undefined, { input: error });
  return appError;
}

export function tryCatch<T>(
  fn: () => T,
  module: string,
  operation: string
): Result<T> {
  try {
    const data = fn();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: handleError(error, module, operation) };
  }
}

export async function tryCatchAsync<T>(
  fn: () => Promise<T>,
  module: string,
  operation: string
): Promise<Result<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: handleError(error, module, operation) };
  }
}
