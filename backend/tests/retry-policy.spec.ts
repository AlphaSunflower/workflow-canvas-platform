import assert from "node:assert/strict";

import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";

async function run(): Promise<void> {
  const retryPolicy = new RetryPolicyService({
    retryIntervalsMs: [30, 60],
  });

  const retryableError = retryPolicy.normalizeError({
    code: "PROVIDER_ERROR",
    message: "provider failed",
    category: "provider_retryable",
    retryable: true,
  });

  const firstDecision = retryPolicy.evaluate({
    attemptNo: 1,
    maxAttempts: retryPolicy.getMaxAttempts(),
    error: retryableError,
  });

  assert.equal(firstDecision.shouldRetry, true);
  assert.equal(firstDecision.delayMs, 30);
  assert.equal(firstDecision.nextAttemptNo, 2);
  assert.equal(firstDecision.finalFailure, false);

  const secondDecision = retryPolicy.evaluate({
    attemptNo: 2,
    maxAttempts: retryPolicy.getMaxAttempts(),
    error: retryableError,
  });

  assert.equal(secondDecision.shouldRetry, true);
  assert.equal(secondDecision.delayMs, 60);
  assert.equal(secondDecision.nextAttemptNo, 3);
  assert.equal(secondDecision.finalFailure, false);

  const finalDecision = retryPolicy.evaluate({
    attemptNo: 3,
    maxAttempts: retryPolicy.getMaxAttempts(),
    error: retryableError,
  });

  assert.equal(finalDecision.shouldRetry, false);
  assert.equal(finalDecision.finalFailure, true);

  const nonRetryableError = retryPolicy.normalizeError({
    code: "VALIDATION_ERROR",
    message: "bad input",
    category: "common",
    retryable: false,
  });

  const nonRetryableDecision = retryPolicy.evaluate({
    attemptNo: 1,
    maxAttempts: retryPolicy.getMaxAttempts(),
    error: nonRetryableError,
  });

  assert.equal(nonRetryableDecision.shouldRetry, false);
  assert.equal(nonRetryableDecision.finalFailure, true);

  const normalizedStorageError = retryPolicy.normalizeError(
    new Error("LINEART_FILE_NOT_FOUND"),
  );

  assert.equal(normalizedStorageError.code, "STORAGE_ERROR");
  assert.equal(normalizedStorageError.retryable, true);

  const normalizedUnknownError = retryPolicy.normalizeError(
    new Error("UNEXPECTED_RUNTIME_FAILURE"),
  );

  assert.equal(normalizedUnknownError.code, "UNKNOWN_ERROR");
  assert.equal(normalizedUnknownError.retryable, false);
}

void run();
