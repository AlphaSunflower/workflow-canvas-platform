import {
  createLaozhangInvalidResponseError,
} from "./laozhang.errors.ts";
import type {
  LaozhangOpenAIImageParsedResult,
  LaozhangSuccessResult,
} from "./laozhang.types.ts";

interface ParsedInlineData {
  data: string;
  mimeType: string;
}

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

function readInlineData(part: unknown): ParsedInlineData | null {
  const partObject = readObject(part);

  if (!partObject) {
    return null;
  }

  const inlineData =
    readObject(partObject.inlineData) ?? readObject(partObject.inline_data);

  if (!inlineData) {
    return null;
  }

  const data = readString(inlineData.data);
  const mimeType =
    readString(inlineData.mimeType) ?? readString(inlineData.mime_type) ?? "image/png";

  if (!data) {
    return null;
  }

  return {
    data,
    mimeType,
  };
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

export function parseLaozhangImageResponse(input: {
  responseText: string;
  snapshotPath: string;
}): LaozhangSuccessResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input.responseText) as unknown;
  } catch {
    throw createLaozhangInvalidResponseError("Laozhang Gemini image response is not valid JSON.", {
      snapshotPath: input.snapshotPath,
    });
  }

  const root = readObject(parsed);

  if (!root) {
    throw createLaozhangInvalidResponseError("Laozhang Gemini image response root object is invalid.", {
      snapshotPath: input.snapshotPath,
    });
  }

  const candidates = readArray(root.candidates);

  for (const candidate of candidates) {
    const content = readObject(readObject(candidate)?.content);
    const parts = readArray(content?.parts);

    for (const part of parts) {
      const inlineData = readInlineData(part);

      if (!inlineData) {
        continue;
      }

      return {
        imageBase64: inlineData.data,
        mimeType: inlineData.mimeType,
        rawResponse: parsed,
        responseText: input.responseText,
        snapshotPath: input.snapshotPath,
      };
    }
  }

  throw createLaozhangInvalidResponseError("Laozhang Gemini image response does not contain inline image data.", {
    snapshotPath: input.snapshotPath,
  });
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
