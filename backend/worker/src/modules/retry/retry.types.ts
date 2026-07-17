import type {
  ErrorCode,
  ExecutionError,
  ExecutionStepType,
} from "@newworkflow/backend-shared";

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  nextAttemptNo: number;
  finalFailure: boolean;
}

export interface RetryEvaluateInput {
  attemptNo: number;
  maxAttempts: number;
  error: ExecutionError;
}

export interface NormalizedExecutionError extends ExecutionError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface RetryProgressContext {
  attemptNo: number;
  stepType: ExecutionStepType | null;
  progress: number;
  error: NormalizedExecutionError;
}

