import { AI_TASK_DEFAULTS } from '@/constants/ai.constants';
import {
  classifyRetryableError,
  createRetryDecision,
} from '@/utils/common/retry-policy';

export function calculateRetryDelay(
  retryCount: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 60000,
): number {
  const delay = baseDelayMs * Math.pow(2, retryCount);
  return Math.min(delay, maxDelayMs);
}

export function shouldRetry(
  error: { retryable?: boolean } | unknown,
  retryCount: number,
  maxRetries: number = AI_TASK_DEFAULTS.maxRetries,
): boolean {
  const failureKind = (
    typeof error === 'object'
    && error !== null
    && 'retryable' in error
    && (error as { retryable?: unknown }).retryable === true
  )
    ? 'recoverable'
    : classifyRetryableError(error);

  return createRetryDecision({
    policy: {
      maxAttempts: Math.max(1, maxRetries + 1),
      delaysMs: Array.from({ length: maxRetries }, () => 0),
    },
    attemptNo: retryCount + 1,
    failureKind,
  }).retry;
}
