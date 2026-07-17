import type { AppError } from '@/types';
import { createError, isAuthError } from '@/utils';
import type { AuthContextValue } from './auth-context';

interface RequireAuthActionOptions {
  actionLabel: string;
}

interface AuthenticationErrorFeedback {
  title: string;
  message: string;
}

export function createAuthenticationRequiredError(actionLabel: string): AppError {
  return createError('AUTH_ERROR', `请先登录后再${actionLabel}`, {
    module: 'auth',
    operation: 'requireAuthAction',
    timestamp: Date.now(),
    context: {
      actionLabel,
    },
  });
}

export function requireAuthenticatedAction(
  auth: Pick<AuthContextValue, 'isAuthenticated' | 'status'>,
  options: RequireAuthActionOptions,
): AppError | null {
  if (auth.isAuthenticated) {
    return null;
  }

  return createAuthenticationRequiredError(options.actionLabel);
}

export function getAuthenticationErrorFeedback(
  error: unknown,
  actionLabel: string,
): AuthenticationErrorFeedback | null {
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) {
    return null;
  }

  const appError = error as AppError;
  if (!isAuthError(appError)) {
    return null;
  }

  if (appError.code === 'PERMISSION_ERROR') {
    return {
      title: '无权限访问',
      message: appError.message || `当前账户无权${actionLabel}`,
    };
  }

  return {
    title: '需要登录',
    message: appError.message || `请先登录后再${actionLabel}`,
  };
}
