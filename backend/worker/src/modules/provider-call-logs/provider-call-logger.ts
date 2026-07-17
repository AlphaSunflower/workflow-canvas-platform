import type { ExecutionError } from "@newworkflow/backend-shared";
import type {
  ProviderCallLogInput,
  ProviderCallLogRepository,
} from "./provider-call-log.repository.ts";

export interface ProviderCallLoggerInput<T> {
  taskId: string;
  stepType: string;
  provider: string;
  model: string;
  requestSummary?: Record<string, unknown> | null;
  call(): Promise<T>;
  summarizeSuccess(result: T): {
    responseSummary?: Record<string, unknown> | null;
    httpStatus?: number | null;
    success?: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
  };
}

function isExecutionError(error: unknown): error is ExecutionError {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && "message" in error
    && "retryable" in error,
  );
}

function getErrorCode(error: unknown): string {
  if (isExecutionError(error)) {
    return error.providerCode ?? error.code;
  }

  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

function getErrorMessage(error: unknown): string {
  if (isExecutionError(error)) {
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

function getErrorDetails(error: unknown): Record<string, unknown> {
  if (isExecutionError(error)) {
    return error.details ?? {};
  }

  return {};
}

function getHttpStatus(details: Record<string, unknown>): number | null {
  return typeof details.httpStatus === "number" ? details.httpStatus : null;
}

function getSnapshotPath(details: Record<string, unknown>): string | null {
  return typeof details.snapshotPath === "string" ? details.snapshotPath : null;
}

async function insertQuietly(
  repository: ProviderCallLogRepository,
  input: ProviderCallLogInput,
): Promise<void> {
  try {
    await repository.insert(input);
  } catch {
    // Provider logging must not change task execution outcome.
  }
}

export async function withProviderCallLog<T>(
  repository: ProviderCallLogRepository,
  input: ProviderCallLoggerInput<T>,
): Promise<T> {
  const startedAt = new Date().toISOString();

  try {
    const result = await input.call();
    const completedAt = new Date().toISOString();
    const successSummary = input.summarizeSuccess(result);

    await insertQuietly(repository, {
      taskId: input.taskId,
      stepType: input.stepType,
      provider: input.provider,
      model: input.model,
      requestSummary: input.requestSummary ?? {},
      responseSummary: successSummary.responseSummary ?? {},
      httpStatus: successSummary.httpStatus ?? null,
      success: successSummary.success ?? true,
      errorCode: successSummary.success === false ? successSummary.errorCode ?? null : null,
      errorMessage: successSummary.success === false ? successSummary.errorMessage ?? null : null,
      startedAt,
      completedAt,
    });

    return result;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const details = getErrorDetails(error);
    const snapshotPath = getSnapshotPath(details);

    await insertQuietly(repository, {
      taskId: input.taskId,
      stepType: input.stepType,
      provider: input.provider,
      model: input.model,
      requestSummary: input.requestSummary ?? {},
      responseSummary: {
        ...(snapshotPath ? { snapshotPath } : {}),
      },
      httpStatus: getHttpStatus(details),
      success: false,
      errorCode: getErrorCode(error),
      errorMessage: getErrorMessage(error),
      startedAt,
      completedAt,
    });

    throw error;
  }
}
