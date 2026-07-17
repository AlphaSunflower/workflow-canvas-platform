import type { AppError } from '@/types';
import { createError } from '@/utils/error/create';

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === 'string' ? candidate.code : null;
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object') {
    return null;
  }

  const candidate = (context as { status?: unknown }).status;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

export function isExecutionOutputAccessDeniedError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === 'AUTH_FORBIDDEN' || code === 'AUTHORIZATION_REQUIRED' || code === 'FILE_ACCESS_FORBIDDEN') {
    return true;
  }

  if (error && typeof error === 'object') {
    const context = (error as { context?: unknown }).context;
    if (context && typeof context === 'object') {
      const accessDenied = (context as { accessDenied?: unknown }).accessDenied;
      const reason = (context as { reason?: unknown }).reason;
      if (accessDenied === true || reason === 'execution-output-file-inaccessible') {
        return true;
      }
    }
  }

  const status = getErrorStatus(error);
  return status === 401 || status === 403;
}

export function createExecutionOutputAccessDeniedError(input: {
  fileId: string;
  operation: string;
  module: string;
  cause?: unknown;
  path?: string;
}): AppError {
  return createError(
    'DOWNLOAD_ERROR',
    '产物文件不可访问，无法读取当前执行结果。',
    {
      module: input.module,
      operation: input.operation,
      timestamp: Date.now(),
      cause: input.cause instanceof Error ? input.cause : undefined,
      context: {
        fileId: input.fileId,
        ...(input.path ? { path: input.path } : {}),
        accessDenied: true,
        reason: 'execution-output-file-inaccessible',
      },
    },
  );
}

export function getExecutionOutputAccessDeniedMessage(fileId?: string): string {
  if (typeof fileId === 'string' && fileId.trim().length > 0) {
    return `产物文件不可访问，无法读取执行结果（文件 ID: ${fileId}）。`;
  }

  return '产物文件不可访问，无法读取当前执行结果。';
}
