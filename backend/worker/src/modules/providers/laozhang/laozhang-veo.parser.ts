import {
  AI_VIDEO_GEN_PROVIDER,
  ERROR_CATEGORIES,
  ERROR_CODES,
  RETRYABLE_ERROR_CODES,
} from "@newworkflow/backend-shared";
import type { ExecutionError } from "@newworkflow/backend-shared";
import type {
  LaozhangVeoContentResult,
  LaozhangVeoCreateVideoResult,
  LaozhangVeoTaskStatusResult,
  LaozhangVeoVideoStatus,
} from "./laozhang-veo.types.ts";

function isRetryableCode(code: ExecutionError["code"]): boolean {
  return (RETRYABLE_ERROR_CODES as readonly string[]).includes(code);
}

function createInvalidResponseError(
  message: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.invalidResponse,
    message,
    category: ERROR_CATEGORIES.providerRetryable,
    retryable: isRetryableCode(ERROR_CODES.invalidResponse),
    provider: AI_VIDEO_GEN_PROVIDER,
    details,
  };
}

function createProviderTerminalError(
  message: string,
  providerCode?: string,
  details?: Record<string, unknown>,
): ExecutionError {
  return {
    code: ERROR_CODES.providerError,
    message,
    category: ERROR_CATEGORIES.provider,
    retryable: false,
    provider: AI_VIDEO_GEN_PROVIDER,
    providerCode,
    details,
  };
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCreated(root: Record<string, unknown>): number | null {
  return readNumber(root.created) ?? readNumber(root.created_at);
}

function readCreatedAt(root: Record<string, unknown>): number | null {
  return readNumber(root.created_at) ?? readNumber(root.created);
}

function parseRoot(input: {
  responseText: string;
  snapshotPath: string;
}): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input.responseText) as unknown;
  } catch {
    throw createInvalidResponseError("Laozhang Veo response is not valid JSON.", {
      snapshotPath: input.snapshotPath,
    });
  }

  const root = readObject(parsed);

  if (!root) {
    throw createInvalidResponseError("Laozhang Veo response root is invalid.", {
      snapshotPath: input.snapshotPath,
    });
  }

  return root;
}

function readProviderError(root: Record<string, unknown>): {
  code: string | null;
  message: string | null;
  type: string | null;
} {
  const error = readObject(root.error);

  return {
    code: readString(error?.code) ?? readString(root.errorCode),
    message: readString(error?.message) ?? readString(root.errorMessage) ?? readString(root.message),
    type: readString(error?.type) ?? readString(root.errorType),
  };
}

function assertNoProviderError(
  root: Record<string, unknown>,
  snapshotPath: string,
): void {
  const error = readProviderError(root);

  if (!error.code && !error.message && !error.type) {
    return;
  }

  throw createProviderTerminalError(
    error.message ?? "Laozhang Veo returned a provider error.",
    error.code ?? error.type ?? "LAOZHANG_VEO_ERROR",
    {
      snapshotPath,
      error,
      rawResponse: root,
    },
  );
}

function readVideoId(
  root: Record<string, unknown>,
  snapshotPath: string,
): string {
  const id = readString(root.id);

  if (!id) {
    throw createInvalidResponseError("Laozhang Veo response is missing id.", {
      snapshotPath,
      rawResponse: root,
    });
  }

  return id;
}

function readStatus(root: Record<string, unknown>): LaozhangVeoVideoStatus {
  return readString(root.status) ?? "unknown";
}

function readVideoUrl(root: Record<string, unknown>): string | null {
  return readString(root.video_url) ?? readString(root.videoUrl) ?? readString(root.url);
}

export function parseLaozhangVeoCreateResponse(input: {
  responseText: string;
  snapshotPath: string;
}): LaozhangVeoCreateVideoResult {
  const root = parseRoot(input);
  assertNoProviderError(root, input.snapshotPath);

  return {
    id: readVideoId(root, input.snapshotPath),
    object: readString(root.object),
    created: readCreated(root),
    createdAt: readCreatedAt(root),
    status: readStatus(root),
    progress: readNumber(root.progress),
    model: readString(root.model),
    rawResponse: root,
    responseText: input.responseText,
    snapshotPath: input.snapshotPath,
  };
}

export function parseLaozhangVeoStatusResponse(input: {
  responseText: string;
  snapshotPath: string;
}): LaozhangVeoTaskStatusResult {
  const root = parseRoot(input);
  assertNoProviderError(root, input.snapshotPath);
  const error = readProviderError(root);

  return {
    id: readVideoId(root, input.snapshotPath),
    object: readString(root.object),
    created: readCreated(root),
    createdAt: readCreatedAt(root),
    completedAt: readNumber(root.completed_at),
    status: readStatus(root),
    progress: readNumber(root.progress),
    model: readString(root.model),
    prompt: readString(root.prompt),
    videoUrl: readVideoUrl(root),
    errorCode: error.code,
    errorMessage: error.message,
    rawResponse: root,
    responseText: input.responseText,
    snapshotPath: input.snapshotPath,
  };
}

export function parseLaozhangVeoContentResponse(input: {
  responseText: string;
  snapshotPath: string;
}): LaozhangVeoContentResult {
  const root = parseRoot(input);
  assertNoProviderError(root, input.snapshotPath);
  const url = readVideoUrl(root);

  if (!url) {
    throw createInvalidResponseError("Laozhang Veo content response is missing url.", {
      snapshotPath: input.snapshotPath,
      rawResponse: root,
    });
  }

  return {
    id: readVideoId(root, input.snapshotPath),
    object: readString(root.object),
    created: readCreated(root),
    createdAt: readCreatedAt(root),
    completedAt: readNumber(root.completed_at),
    status: readStatus(root),
    progress: readNumber(root.progress),
    model: readString(root.model),
    prompt: readString(root.prompt),
    url,
    videoUrl: url,
    duration: readNumber(root.duration),
    resolution: readString(root.resolution),
    rawResponse: root,
    responseText: input.responseText,
    snapshotPath: input.snapshotPath,
  };
}
