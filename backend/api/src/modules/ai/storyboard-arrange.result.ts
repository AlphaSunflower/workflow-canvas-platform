import type { StoryboardArrangeShotResult } from "./storyboard-arrange.dto.ts";

function stripCodeFence(value: string): string {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonArrayText(value: string): string {
  const normalized = stripCodeFence(value);
  const arrayStart = normalized.indexOf("[");
  const arrayEnd = normalized.lastIndexOf("]");

  if (arrayStart < 0 || arrayEnd < arrayStart) {
    throw new Error("INVALID_PROVIDER_RESULT_JSON");
  }

  return normalized.slice(arrayStart, arrayEnd + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readShotId(input: Record<string, unknown>): string {
  const value = input.shotId;

  if (typeof value !== "string" || !value.trim()) {
    throw new Error("INVALID_PROVIDER_RESULT_SHOT_ID");
  }

  return value.trim();
}

function readOrder(input: Record<string, unknown>): number {
  const value = input.order;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("INVALID_PROVIDER_RESULT_ORDER");
  }

  const normalized = Math.trunc(value);
  if (normalized < 1) {
    throw new Error("INVALID_PROVIDER_RESULT_ORDER");
  }

  return normalized;
}

function readPrompt(input: Record<string, unknown>): string {
  const value = input.prompt;

  if (typeof value !== "string" || !value.trim()) {
    throw new Error("INVALID_PROVIDER_RESULT_PROMPT");
  }

  return value.trim();
}

export function parseStoryboardArrangeResult(
  responseText: string,
  expectedShotIds: readonly string[],
): StoryboardArrangeShotResult[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJsonArrayText(responseText));
  } catch {
    throw new Error("INVALID_PROVIDER_RESULT_JSON");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("INVALID_PROVIDER_RESULT_ARRAY");
  }

  const expectedShotIdSet = new Set(expectedShotIds);
  const results = parsed.map((item) => {
    if (!isRecord(item)) {
      throw new Error("INVALID_PROVIDER_RESULT_ITEM");
    }

    const shotId = readShotId(item);
    if (!expectedShotIdSet.has(shotId)) {
      throw new Error("UNKNOWN_PROVIDER_RESULT_SHOT_ID");
    }

    return {
      shotId,
      order: readOrder(item),
      prompt: readPrompt(item),
    } satisfies StoryboardArrangeShotResult;
  });

  if (results.length !== expectedShotIds.length) {
    throw new Error("INVALID_PROVIDER_RESULT_LENGTH");
  }

  const seenShotIds = new Set<string>();
  const seenOrders = new Set<number>();

  results.forEach((item) => {
    if (seenShotIds.has(item.shotId)) {
      throw new Error("DUPLICATE_PROVIDER_RESULT_SHOT_ID");
    }

    if (seenOrders.has(item.order)) {
      throw new Error("DUPLICATE_PROVIDER_RESULT_ORDER");
    }

    seenShotIds.add(item.shotId);
    seenOrders.add(item.order);
  });

  const expectedOrderSet = new Set(
    Array.from({ length: expectedShotIds.length }, (_, index) => index + 1),
  );

  results.forEach((item) => {
    if (!expectedOrderSet.has(item.order)) {
      throw new Error("INVALID_PROVIDER_RESULT_ORDER_RANGE");
    }
  });

  return results.sort((left, right) => left.order - right.order);
}
