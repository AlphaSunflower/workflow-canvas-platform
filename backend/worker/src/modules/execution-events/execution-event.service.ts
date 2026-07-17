import {
  EXECUTION_PHASES,
  EXECUTION_STATUSES,
} from "@newworkflow/backend-shared";
import type {
  ExecutionPhase,
  ExecutionStatus,
  ExecutionStepType,
  TaskEventType,
} from "@newworkflow/backend-shared";
import type { ExecutionsRepository } from "../../../../api/src/modules/executions/executions.repository.types.ts";
import type { NormalizedExecutionError } from "../retry/retry.types.ts";

const ERROR_DIAGNOSTIC_KEYS = [
  "apiUrl",
  "url",
  "downloadUrl",
  "timeoutMs",
  "elapsedMs",
  "phase",
  "method",
  "aborted",
  "timeoutBudgetExceeded",
  "httpStatus",
  "responseBodyBytes",
  "snapshotPath",
  "errorName",
  "errorMessage",
  "errorCode",
  "cause",
  "causeName",
  "causeMessage",
  "causeCode",
  "causeErrno",
  "causeSyscall",
  "backpressure",
] as const;

function isSafeDiagnosticValue(value: unknown): value is string | number | boolean | null {
  return (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  );
}

function truncateDiagnosticString(value: string): string {
  return value.length <= 500 ? value : `${value.slice(0, 500)}...`;
}

function buildErrorPayload(error: NormalizedExecutionError): Record<string, unknown> {
  const diagnostics: Record<string, string | number | boolean | null> = {};

  for (const key of ERROR_DIAGNOSTIC_KEYS) {
    const value = error.details?.[key];
    if (!isSafeDiagnosticValue(value)) {
      continue;
    }

    diagnostics[key] = typeof value === "string"
      ? truncateDiagnosticString(value)
      : value;
  }

  return {
    errorCode: error.code,
    errorMessage: error.message,
    provider: error.provider ?? null,
    providerCode: error.providerCode ?? null,
    retryable: error.retryable,
    ...(Object.keys(diagnostics).length > 0 ? { diagnostics } : {}),
  };
}

export class ExecutionEventService {
  private readonly executionsRepository: ExecutionsRepository;

  constructor(executionsRepository: ExecutionsRepository) {
    this.executionsRepository = executionsRepository;
  }

  async recordProgress(input: {
    taskId: string;
    attemptNo: number;
    eventType: TaskEventType;
    stepType: ExecutionStepType | null;
    progress: number;
    message: string;
    phase?: ExecutionPhase;
    status?: ExecutionStatus;
    payload?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.executionsRepository.appendTaskEvent({
      taskId: input.taskId,
      attemptNo: input.attemptNo,
      eventType: input.eventType,
      status: input.status ?? EXECUTION_STATUSES[1],
      phase: input.phase ?? EXECUTION_PHASES[1],
      stepType: input.stepType,
      progress: input.progress,
      message: input.message,
      payload: input.payload ?? null,
    });
  }

  async recordAttemptStarted(input: {
    taskId: string;
    attemptNo: number;
  }): Promise<void> {
    await this.recordProgress({
      taskId: input.taskId,
      attemptNo: input.attemptNo,
      eventType: input.attemptNo === 1 ? "task_started" : "task_retry_started",
      stepType: null,
      progress: 0,
      message:
        input.attemptNo === 1
          ? "任务开始执行。"
          : `任务开始第 ${input.attemptNo} 次尝试。`,
      phase: input.attemptNo === 1 ? EXECUTION_PHASES[1] : EXECUTION_PHASES[2],
    });
  }

  async recordAttemptRetryScheduled(input: {
    taskId: string;
    attemptNo: number;
    nextAttemptNo: number;
    delayMs: number;
    error: NormalizedExecutionError;
    stepType: ExecutionStepType | null;
  }): Promise<void> {
    await this.recordProgress({
      taskId: input.taskId,
      attemptNo: input.attemptNo,
      eventType: "task_retry_scheduled",
      stepType: input.stepType,
      progress: 100,
      message: `第 ${input.attemptNo} 次尝试失败，准备 ${input.delayMs}ms 后进行第 ${input.nextAttemptNo} 次尝试。`,
      phase: EXECUTION_PHASES[2],
      payload: {
        ...buildErrorPayload(input.error),
        nextAttemptNo: input.nextAttemptNo,
        delayMs: input.delayMs,
      },
    });
  }

  async recordProviderBackpressureScheduled(input: {
    taskId: string;
    attemptNo: number;
    delayMs: number;
    error: NormalizedExecutionError;
    stepType: ExecutionStepType | null;
  }): Promise<void> {
    await this.recordProgress({
      taskId: input.taskId,
      attemptNo: input.attemptNo,
      eventType: "task_retry_scheduled",
      stepType: input.stepType,
      progress: 0,
      message: `RunningHub 队列繁忙，${input.delayMs}ms 后由后端重新排队执行。`,
      phase: EXECUTION_PHASES[2],
      status: EXECUTION_STATUSES[1],
      payload: {
        ...buildErrorPayload(input.error),
        delayMs: input.delayMs,
        backpressure: true,
      },
    });
  }

  async recordAttemptFailure(input: {
    taskId: string;
    attemptNo: number;
    stepType: ExecutionStepType | null;
    error: NormalizedExecutionError;
    finalFailure: boolean;
  }): Promise<void> {
    await this.recordProgress({
      taskId: input.taskId,
      attemptNo: input.attemptNo,
      eventType: "task_retry_progress",
      stepType: input.stepType,
      progress: 100,
      message: input.finalFailure
        ? `第 ${input.attemptNo} 次尝试失败，任务不再重试。`
        : `第 ${input.attemptNo} 次尝试失败。`,
      phase: input.finalFailure ? EXECUTION_PHASES[4] : EXECUTION_PHASES[2],
      status: input.finalFailure ? EXECUTION_STATUSES[3] : EXECUTION_STATUSES[1],
      payload: buildErrorPayload(input.error),
    });
  }

  async recordAttemptCompleted(input: {
    taskId: string;
    attemptNo: number;
  }): Promise<void> {
    await this.recordProgress({
      taskId: input.taskId,
      attemptNo: input.attemptNo,
      eventType: "task_progress",
      stepType: "final",
      progress: 100,
      message: `第 ${input.attemptNo} 次尝试完成。`,
      phase: EXECUTION_PHASES[3],
      status: EXECUTION_STATUSES[2],
    });
  }
}
