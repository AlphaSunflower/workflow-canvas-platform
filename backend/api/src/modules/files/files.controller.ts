import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import {
  readJsonBody,
  sendApiError,
  sendApiSuccess,
} from "@newworkflow/backend-shared";
import {
  requireAuth,
  sendForbidden,
} from "../auth/auth.guard.ts";
import { AuthService } from "../auth/auth.service.ts";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import {
  validateFileRegisterRequest,
  validateFileUploadRequest,
} from "./files.dto.ts";
import { parseBinaryUploadRequest } from "./binary-upload.parser.ts";
import type { FileContentVariant } from "./files.repository.types.ts";
import type { FileResourceResponse } from "./files.service.ts";
import { FilesService } from "./files.service.ts";

function mapValidationError(error: string): { code: number; message: string } {
  switch (error) {
    case "INVALID_SHA256":
      return { code: 40011, message: "sha256 must be a 64-character hex string." };
    case "INVALID_FILE_SIZE":
      return { code: 40012, message: "size must be a positive integer." };
    case "INVALID_MIME_TYPE":
      return { code: 40013, message: "mimeType is required." };
    case "INVALID_ORIGINAL_NAME":
      return { code: 40014, message: "originalName is required." };
    case "INVALID_UPLOAD_ID":
      return { code: 40015, message: "uploadId is required." };
    case "INVALID_CONTENT_BASE64":
      return { code: 40016, message: "contentBase64 is required." };
    case "EMPTY_BINARY_UPLOAD":
      return { code: 40018, message: "Binary upload body is empty." };
    case "REQUEST_BODY_TOO_LARGE":
      return { code: 40019, message: "Request body is too large." };
    case "FILE_HASH_MISMATCH":
      return { code: 40017, message: "Uploaded content does not match registered sha256." };
    case "UPLOAD_NOT_FOUND":
      return { code: 40411, message: "Pending upload not found." };
    case "FILE_NOT_FOUND":
      return { code: 40412, message: "File not found." };
    case "UPLOAD_ACCESS_FORBIDDEN":
    case "FILE_ACCESS_FORBIDDEN":
      return { code: 40311, message: "Current account cannot access this file." };
    default:
      return { code: 50001, message: "Files API internal error." };
  }
}

function splitEtags(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value;
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toWeakComparableEtag(value: string): string {
  return value.startsWith("W/") ? value.slice(2) : value;
}

function matchesIfNoneMatch(
  headerValue: string | string[] | undefined,
  etag: string,
): boolean {
  const requestedEtags = splitEtags(headerValue);
  if (requestedEtags.includes("*")) {
    return true;
  }

  const comparableEtag = toWeakComparableEtag(etag);
  return requestedEtags.some((candidate) => toWeakComparableEtag(candidate) === comparableEtag);
}

function matchesIfModifiedSince(
  headerValue: string | string[] | undefined,
  lastModified: string,
): boolean {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) {
    return false;
  }

  const requestedTimestamp = Date.parse(raw);
  const resourceTimestamp = Date.parse(lastModified);
  if (!Number.isFinite(requestedTimestamp) || !Number.isFinite(resourceTimestamp)) {
    return false;
  }

  return Math.floor(resourceTimestamp / 1000) * 1000 <= requestedTimestamp;
}

function buildResourceHeaders(file: FileResourceResponse): Record<string, string | number> {
  return {
    "Content-Type": file.mimeType,
    "Content-Length": file.byteLength,
    "Cache-Control": file.cacheControl,
    "ETag": file.etag,
    "Last-Modified": new Date(file.lastModifiedAt).toUTCString(),
    "Vary": "Authorization, Origin",
    "Access-Control-Expose-Headers": "ETag,Last-Modified,Content-Length,Content-Type,Cache-Control",
  };
}

export class FilesController {
  private readonly filesService: FilesService;
  private readonly authService: AuthService;

  constructor(
    filesService: FilesService,
    authService: AuthService,
  ) {
    this.filesService = filesService;
    this.authService = authService;
  }

  async register(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateFileRegisterRequest(body);
      const result = await this.getFilesService().registerForActor(authenticated, validated);
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async upload(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const contentType = request.headers["content-type"]?.toLowerCase() ?? "";
      const isJsonUpload = contentType.includes("application/json");

      const result = isJsonUpload
        ? await this.uploadFromJson(authenticated, request)
        : await this.uploadFromBinary(authenticated, request);
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private async uploadFromJson(
    authenticated: AuthenticatedAccount,
    request: IncomingMessage,
  ) {
    const body = await readJsonBody(request);
    const validated = validateFileUploadRequest(body);
    return this.getFilesService().uploadForActor(authenticated, validated);
  }

  private async uploadFromBinary(
    authenticated: AuthenticatedAccount,
    request: IncomingMessage,
  ) {
    const parsed = await parseBinaryUploadRequest(request);
    return this.getFilesService().uploadBinaryForActor(
      authenticated,
      parsed.uploadId,
      parsed.buffer,
    );
  }

  async getFile(
    request: IncomingMessage,
    fileId: string,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const file = await this.getFilesService().getFileForActor(authenticated, fileId);

      if (!file) {
        sendApiError(response, 404, 40412, "FILE_NOT_FOUND", "File not found.");
        return;
      }

      sendApiSuccess(response, file);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async download(
    request: IncomingMessage,
    fileId: string,
    variant: FileContentVariant,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const file = await this.getFilesService().downloadFileForActor(
        authenticated,
        fileId,
        variant,
      );

      if (!file) {
        sendApiError(response, 404, 40412, "FILE_NOT_FOUND", "File not found.");
        return;
      }

      const headers = buildResourceHeaders(file);
      const hasIfNoneMatch = splitEtags(request.headers["if-none-match"]).length > 0;
      const isNotModified = hasIfNoneMatch
        ? matchesIfNoneMatch(request.headers["if-none-match"], file.etag)
        : matchesIfModifiedSince(request.headers["if-modified-since"], String(headers["Last-Modified"]));

      if (isNotModified) {
        response.writeHead(304, {
          "Cache-Control": headers["Cache-Control"],
          "ETag": headers["ETag"],
          "Last-Modified": headers["Last-Modified"],
          "Vary": headers["Vary"],
          "Access-Control-Expose-Headers": headers["Access-Control-Expose-Headers"],
        });
        response.end();
        return;
      }

      response.writeHead(200, headers);
      response.end(file.buffer);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private getFilesService(): FilesService {
    return this.filesService;
  }

  private getAuthService(): AuthService {
    return this.authService;
  }

  private handleError(response: ServerResponse, error: unknown): void {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "FILE_ACCESS_FORBIDDEN" || message === "UPLOAD_ACCESS_FORBIDDEN") {
      sendForbidden(response);
      return;
    }

    const mapped = mapValidationError(message);
    const statusCode = mapped.code >= 50000
      ? 500
      : mapped.code >= 40400
        ? 404
        : mapped.code >= 40300
          ? 403
          : 400;
    const errorCode = message === "UNKNOWN_ERROR" ? "INTERNAL_ERROR" : message;

    sendApiError(response, statusCode, mapped.code, errorCode, mapped.message);
  }
}
