import type { IncomingMessage } from "node:http";

export interface ParsedBinaryUploadRequest {
  uploadId: string;
  buffer: Buffer;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function resolveUploadIdFromRequest(request: IncomingMessage): string | null {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const queryValue = requestUrl.searchParams.get("uploadId")?.trim();

  if (queryValue) {
    return queryValue;
  }

  const headerValue = firstHeaderValue(request.headers["x-upload-id"])?.trim();
  return headerValue || null;
}

export async function parseBinaryUploadRequest(
  request: IncomingMessage,
  maxBytes = 100 * 1024 * 1024,
): Promise<ParsedBinaryUploadRequest> {
  const uploadId = resolveUploadIdFromRequest(request);

  if (!uploadId) {
    throw new Error("INVALID_UPLOAD_ID");
  }

  const chunks: Buffer[] = [];
  let totalLength = 0;

  for await (const chunk of request) {
    const bufferChunk =
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    totalLength += bufferChunk.length;

    if (totalLength > maxBytes) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }

    chunks.push(bufferChunk);
  }

  const buffer = Buffer.concat(chunks);

  if (buffer.length === 0) {
    throw new Error("EMPTY_BINARY_UPLOAD");
  }

  return {
    uploadId,
    buffer,
  };
}
