import type {
  FileRegisterRequest,
  FileUploadRequest,
} from "@newworkflow/backend-shared/api";

export function validateFileRegisterRequest(
  input: unknown,
): FileRegisterRequest {
  if (!input || typeof input !== "object") {
    throw new Error("INVALID_BODY");
  }

  const request = input as FileRegisterRequest;

  if (!request.sha256 || !/^[a-fA-F0-9]{64}$/.test(request.sha256)) {
    throw new Error("INVALID_SHA256");
  }

  if (!Number.isFinite(request.size) || request.size <= 0) {
    throw new Error("INVALID_FILE_SIZE");
  }

  if (!request.mimeType) {
    throw new Error("INVALID_MIME_TYPE");
  }

  if (!request.originalName) {
    throw new Error("INVALID_ORIGINAL_NAME");
  }

  const normalizeOptionalPositiveNumber = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return value;
  };

  return {
    ...(request.userId ? { userId: request.userId } : {}),
    sha256: request.sha256.toLowerCase(),
    size: request.size,
    mimeType: request.mimeType.trim(),
    originalName: request.originalName.trim(),
    displayName: request.displayName?.trim() || request.originalName.trim(),
    fileType: request.fileType ?? "image",
    sourceType: request.sourceType ?? "input",
    ...(typeof normalizeOptionalPositiveNumber(request.width) === "number"
      ? { width: normalizeOptionalPositiveNumber(request.width) }
      : {}),
    ...(typeof normalizeOptionalPositiveNumber(request.height) === "number"
      ? { height: normalizeOptionalPositiveNumber(request.height) }
      : {}),
    ...(typeof normalizeOptionalPositiveNumber(request.duration) === "number"
      ? { duration: normalizeOptionalPositiveNumber(request.duration) }
      : {}),
  };
}

export function validateFileUploadRequest(
  input: unknown,
): FileUploadRequest {
  if (!input || typeof input !== "object") {
    throw new Error("INVALID_BODY");
  }

  const request = input as FileUploadRequest;

  if (!request.uploadId) {
    throw new Error("INVALID_UPLOAD_ID");
  }

  if (!request.contentBase64) {
    throw new Error("INVALID_CONTENT_BASE64");
  }

  return {
    uploadId: request.uploadId,
    contentBase64: request.contentBase64,
  };
}
