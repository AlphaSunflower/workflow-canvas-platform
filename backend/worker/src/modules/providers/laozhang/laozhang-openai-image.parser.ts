import { createLaozhangInvalidResponseError } from "./laozhang.errors.ts";
import type { LaozhangOpenAIImageParsedResult } from "./laozhang.types.ts";

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function inferMimeTypeFromUrl(url: string): string {
  const normalizedUrl = url.toLowerCase();

  if (normalizedUrl.includes(".jpg") || normalizedUrl.includes(".jpeg")) {
    return "image/jpeg";
  }

  if (normalizedUrl.includes(".webp")) {
    return "image/webp";
  }

  return "image/png";
}

export function parseLaozhangOpenAIImageResponse(input: {
  responseText: string;
  snapshotPath: string;
}): LaozhangOpenAIImageParsedResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input.responseText) as unknown;
  } catch {
    throw createLaozhangInvalidResponseError("Laozhang OpenAI image response is not valid JSON.", {
      snapshotPath: input.snapshotPath,
    });
  }

  const root = readObject(parsed);

  if (!root) {
    throw createLaozhangInvalidResponseError("Laozhang OpenAI image response root object is invalid.", {
      snapshotPath: input.snapshotPath,
    });
  }

  const firstItem = readObject(readArray(root.data)[0]);

  if (!firstItem) {
    throw createLaozhangInvalidResponseError("Laozhang OpenAI image response does not contain data[0].", {
      snapshotPath: input.snapshotPath,
    });
  }

  const imageBase64 = readString(firstItem.b64_json);
  if (imageBase64) {
    return {
      kind: "base64",
      imageBase64,
      mimeType: "image/png",
      rawResponse: parsed,
      responseText: input.responseText,
      snapshotPath: input.snapshotPath,
    };
  }

  const imageUrl = readString(firstItem.url);
  if (imageUrl) {
    return {
      kind: "url",
      url: imageUrl,
      rawResponse: parsed,
      responseText: input.responseText,
      snapshotPath: input.snapshotPath,
    };
  }

  const mimeType = readString(firstItem.mime_type) ?? readString(firstItem.mimeType);
  const base64 = readString(firstItem.b64);
  if (base64) {
    return {
      kind: "base64",
      imageBase64: base64,
      mimeType: mimeType ?? "image/png",
      rawResponse: parsed,
      responseText: input.responseText,
      snapshotPath: input.snapshotPath,
    };
  }

  throw createLaozhangInvalidResponseError("Laozhang OpenAI image response does not contain b64_json or url.", {
    snapshotPath: input.snapshotPath,
  });
}

export function inferOpenAIImageMimeTypeFromUrl(url: string): string {
  return inferMimeTypeFromUrl(url);
}
