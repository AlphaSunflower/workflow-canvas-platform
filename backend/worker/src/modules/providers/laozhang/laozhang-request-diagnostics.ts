export type LaozhangRequestPhase =
  | "before-fetch"
  | "fetch"
  | "response-received"
  | "body-read"
  | "snapshot-write"
  | "parse-response"
  | "download-body";

export interface LaozhangRequestDiagnosticsInput {
  apiUrl: string;
  timeoutMs: number;
  startedAtMs: number;
  phase: LaozhangRequestPhase;
  method: "GET" | "POST";
  httpStatus?: number;
  responseBodyBytes?: number;
  snapshotPath?: string;
}

export function getElapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

function readObjectString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || !(key in value)) {
    return undefined;
  }

  const rawValue = (value as Record<string, unknown>)[key];
  return typeof rawValue === "string" && rawValue.trim().length > 0
    ? rawValue.trim()
    : undefined;
}

function readErrorCause(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("cause" in error)) {
    return undefined;
  }

  return (error as { cause?: unknown }).cause;
}

function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

export function buildLaozhangRequestDiagnostics(
  error: unknown,
  input: LaozhangRequestDiagnosticsInput,
): Record<string, unknown> {
  const elapsedMs = getElapsedMs(input.startedAtMs);
  const cause = readErrorCause(error);
  const errorMessage = error instanceof Error
    ? error.message
    : readObjectString(error, "message");
  const causeMessage = cause instanceof Error
    ? cause.message
    : readObjectString(cause, "message");

  return {
    apiUrl: input.apiUrl,
    timeoutMs: input.timeoutMs,
    elapsedMs,
    phase: input.phase,
    method: input.method,
    aborted:
      (error instanceof Error && error.name === "AbortError")
      || readObjectString(error, "name") === "AbortError",
    timeoutBudgetExceeded: elapsedMs >= input.timeoutMs,
    ...(typeof input.httpStatus === "number" ? { httpStatus: input.httpStatus } : {}),
    ...(typeof input.responseBodyBytes === "number"
      ? { responseBodyBytes: input.responseBodyBytes }
      : {}),
    ...(input.snapshotPath ? { snapshotPath: input.snapshotPath } : {}),
    ...(error instanceof Error ? { errorName: error.name } : {}),
    ...(errorMessage ? { errorMessage: truncate(errorMessage, 300) } : {}),
    ...(readObjectString(error, "code") ? { errorCode: readObjectString(error, "code") } : {}),
    ...(cause instanceof Error ? { causeName: cause.name } : {}),
    ...(causeMessage ? { causeMessage: truncate(causeMessage, 300) } : {}),
    ...(readObjectString(cause, "code") ? { causeCode: readObjectString(cause, "code") } : {}),
    ...(readObjectString(cause, "errno") ? { causeErrno: readObjectString(cause, "errno") } : {}),
    ...(readObjectString(cause, "syscall") ? { causeSyscall: readObjectString(cause, "syscall") } : {}),
  };
}
