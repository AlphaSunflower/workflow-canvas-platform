import { AI_TASK_DEFAULTS } from '@/constants/ai.constants';
import { classifyRetryableError, createRetryDecision, } from '@/utils/common/retry-policy';
export function calculateRetryDelay(retryCount, baseDelayMs, maxDelayMs) {
    if (baseDelayMs === void 0) { baseDelayMs = 1000; }
    if (maxDelayMs === void 0) { maxDelayMs = 60000; }
    var delay = baseDelayMs * Math.pow(2, retryCount);
    return Math.min(delay, maxDelayMs);
}
export function shouldRetry(error, retryCount, maxRetries) {
    if (maxRetries === void 0) { maxRetries = AI_TASK_DEFAULTS.maxRetries; }
    var failureKind = (typeof error === 'object'
        && error !== null
        && 'retryable' in error
        && error.retryable === true)
        ? 'recoverable'
        : classifyRetryableError(error);
    return createRetryDecision({
        policy: {
            maxAttempts: Math.max(1, maxRetries + 1),
            delaysMs: Array.from({ length: maxRetries }, function () { return 0; }),
        },
        attemptNo: retryCount + 1,
        failureKind: failureKind,
    }).retry;
}
