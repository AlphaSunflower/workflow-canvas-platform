export type RetryFailureKind =
  | 'abort'
  | 'timeout'
  | 'recoverable'
  | 'fatal';

export interface RetryPolicy {
  maxAttempts: number;
  delaysMs: readonly number[];
  attemptTimeoutMs?: number;
}

export interface RetryDecision {
  retry: boolean;
  failureKind: RetryFailureKind;
  attemptNo: number;
  nextAttemptNo: number | null;
  delayMs: number | null;
  exhausted: boolean;
}

export interface RetryAttemptContext {
  attemptNo: number;
  maxAttempts: number;
  signal?: AbortSignal;
}

export interface RunWithRetryOptions<TResult> {
  policy: RetryPolicy;
  signal?: AbortSignal;
  classifyError?: (error: unknown) => RetryFailureKind;
  onFailure?: (params: {
    error: unknown;
    decision: RetryDecision;
  }) => void | Promise<void>;
  shouldStopAfterFailure?: (params: {
    error: unknown;
    decision: RetryDecision;
  }) => boolean | Promise<boolean>;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  run: (context: RetryAttemptContext) => Promise<TResult>;
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }

  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

export function isAbortLikeError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || (error instanceof Error && error.name === 'AbortError');
}

export function isTimeoutLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return true;
  }

  const code = typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return code === 'TIMEOUT_ERROR'
    || code === 'TASK_QUERY_FAILED'
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('network')
    || message.includes('fetch failed')
    || message.includes('failed to fetch');
}

export function classifyRetryableError(error: unknown): RetryFailureKind {
  if (isAbortLikeError(error)) {
    return 'abort';
  }

  if (isTimeoutLikeError(error)) {
    return 'timeout';
  }

  const retryable = typeof error === 'object' && error !== null && 'retryable' in error
    ? (error as { retryable?: unknown }).retryable
    : undefined;

  if (retryable === true) {
    return 'recoverable';
  }

  return 'fatal';
}

export function normalizeRetryPolicy(policy: RetryPolicy): RetryPolicy {
  const maxAttempts = Number.isFinite(policy.maxAttempts)
    ? Math.max(1, Math.floor(policy.maxAttempts))
    : 1;
  const delaysMs = policy.delaysMs
    .slice(0, Math.max(0, maxAttempts - 1))
    .map((delayMs) => (
      Number.isFinite(delayMs) ? Math.max(0, Math.floor(delayMs)) : 0
    ));

  return {
    maxAttempts,
    delaysMs,
    attemptTimeoutMs: typeof policy.attemptTimeoutMs === 'number' && Number.isFinite(policy.attemptTimeoutMs)
      ? Math.max(1, Math.floor(policy.attemptTimeoutMs))
      : undefined,
  };
}

export function createRetryDecision(params: {
  policy: RetryPolicy;
  attemptNo: number;
  failureKind: RetryFailureKind;
}): RetryDecision {
  const policy = normalizeRetryPolicy(params.policy);
  const exhausted = params.attemptNo >= policy.maxAttempts;
  const retry = (
    !exhausted
    && params.failureKind !== 'abort'
    && params.failureKind !== 'fatal'
  );

  return {
    retry,
    failureKind: params.failureKind,
    attemptNo: params.attemptNo,
    nextAttemptNo: retry ? params.attemptNo + 1 : null,
    delayMs: retry ? policy.delaysMs[params.attemptNo - 1] ?? 0 : null,
    exhausted,
  };
}

export function sleepWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<void>((resolve, reject) => {
    const handleAbort = (): void => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', handleAbort);
      reject(createAbortError());
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export async function withTimeout<TResult>(
  operation: (signal?: AbortSignal) => Promise<TResult>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<TResult> {
  if (parentSignal?.aborted) {
    throw createAbortError();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
  }, timeoutMs);
  const handleAbort = (): void => {
    controller.abort(createAbortError());
  };

  parentSignal?.addEventListener('abort', handleAbort, { once: true });

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', handleAbort);
  }
}

export async function runWithRetry<TResult>(
  options: RunWithRetryOptions<TResult>,
): Promise<TResult> {
  const policy = normalizeRetryPolicy(options.policy);
  const classifyError = options.classifyError ?? classifyRetryableError;
  const wait = options.wait ?? sleepWithAbort;

  for (let attemptNo = 1; attemptNo <= policy.maxAttempts; attemptNo += 1) {
    try {
      if (policy.attemptTimeoutMs) {
        return await withTimeout(
          (attemptSignal) => options.run({
            attemptNo,
            maxAttempts: policy.maxAttempts,
            signal: attemptSignal,
          }),
          policy.attemptTimeoutMs,
          options.signal,
        );
      }

      return await options.run({
        attemptNo,
        maxAttempts: policy.maxAttempts,
        signal: options.signal,
      });
    } catch (error) {
      const decision = createRetryDecision({
        policy,
        attemptNo,
        failureKind: classifyError(error),
      });

      await options.onFailure?.({ error, decision });

      if (!decision.retry || await options.shouldStopAfterFailure?.({ error, decision })) {
        throw error;
      }

      await wait(decision.delayMs ?? 0, options.signal);
    }
  }

  throw new Error('Retry policy exhausted without a terminal result.');
}
