import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRetryableError,
  createRetryDecision,
  runWithRetry,
  sleepWithAbort,
  withTimeout,
} from './retry-policy';

test('createRetryDecision bounds retries by policy and failure kind', () => {
  const policy = {
    maxAttempts: 3,
    delaysMs: [10, 20],
  } as const;

  assert.deepEqual(
    createRetryDecision({
      policy,
      attemptNo: 1,
      failureKind: 'timeout',
    }),
    {
      retry: true,
      failureKind: 'timeout',
      attemptNo: 1,
      nextAttemptNo: 2,
      delayMs: 10,
      exhausted: false,
    },
  );

  assert.equal(createRetryDecision({
    policy,
    attemptNo: 2,
    failureKind: 'fatal',
  }).retry, false);
  assert.equal(createRetryDecision({
    policy,
    attemptNo: 2,
    failureKind: 'abort',
  }).retry, false);
  assert.equal(createRetryDecision({
    policy,
    attemptNo: 3,
    failureKind: 'recoverable',
  }).exhausted, true);
});

test('classifyRetryableError distinguishes timeout, abort, recoverable and fatal failures', () => {
  const timeoutError = new Error('request timed out');
  const abortError = new DOMException('The operation was aborted.', 'AbortError');

  assert.equal(classifyRetryableError(timeoutError), 'timeout');
  assert.equal(classifyRetryableError(abortError), 'abort');
  assert.equal(classifyRetryableError({ retryable: true }), 'recoverable');
  assert.equal(classifyRetryableError(new Error('validation failed')), 'fatal');
});

test('sleepWithAbort rejects when aborted before delay completes', async () => {
  const controller = new AbortController();
  const promise = sleepWithAbort(50, controller.signal);
  controller.abort();

  await assert.rejects(promise, (error: unknown) => (
    error instanceof DOMException && error.name === 'AbortError'
  ));
});

test('withTimeout aborts the inner operation when deadline is exceeded', async () => {
  await assert.rejects(
    () => withTimeout(
      async (signal) => {
        await new Promise<void>((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(signal.reason);
          }, { once: true });
        });
        return 'never';
      },
      10,
    ),
    (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError',
  );
});

test('runWithRetry retries timeout-like soft failures and eventually succeeds', async () => {
  const attempts: number[] = [];

  const result = await runWithRetry({
    policy: {
      maxAttempts: 3,
      delaysMs: [0, 0],
    },
    run: async ({ attemptNo }) => {
      attempts.push(attemptNo);
      if (attemptNo < 3) {
        throw new Error('request timed out');
      }
      return 'ok';
    },
  });

  assert.equal(result, 'ok');
  assert.deepEqual(attempts, [1, 2, 3]);
});

test('runWithRetry stops on abort and fatal failures', async () => {
  await assert.rejects(
    () => runWithRetry({
      policy: {
        maxAttempts: 3,
        delaysMs: [0, 0],
      },
      run: async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      },
    }),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );

  let attempts = 0;
  await assert.rejects(
    () => runWithRetry({
      policy: {
        maxAttempts: 3,
        delaysMs: [0, 0],
      },
      run: async () => {
        attempts += 1;
        throw new Error('hard validation failure');
      },
    }),
    /hard validation failure/,
  );
  assert.equal(attempts, 1);
});
