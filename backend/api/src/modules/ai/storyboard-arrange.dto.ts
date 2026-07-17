import {
  AI_STORYBOARD_ARRANGE_NODE_TYPE,
  AI_STORYBOARD_ARRANGE_PROMPT_VERSION,
} from "./storyboard-arrange.constants.ts";

export interface StoryboardArrangeShotRequest {
  shotId: string;
  order: number;
  imageFileId: string;
}

export interface StoryboardArrangeRequest {
  workflowId: string;
  nodeId: string;
  nodeType: typeof AI_STORYBOARD_ARRANGE_NODE_TYPE;
  shots: StoryboardArrangeShotRequest[];
}

export interface StoryboardArrangeShotResult {
  shotId: string;
  order: number;
  prompt: string;
}

export interface StoryboardArrangeResponseData {
  shots: StoryboardArrangeShotResult[];
  model: string;
  referenceCount: number;
  promptVersion: typeof AI_STORYBOARD_ARRANGE_PROMPT_VERSION;
}

function assertBody(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("INVALID_BODY");
  }

  return input as Record<string, unknown>;
}

function readRequiredString(
  input: Record<string, unknown>,
  field: string,
  error: string,
): string {
  const value = input[field];

  if (typeof value !== "string") {
    throw new Error(error);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(error);
  }

  return normalized;
}

function readPositiveOrder(
  input: Record<string, unknown>,
  field: string,
  error: string,
): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(error);
  }

  const normalized = Math.trunc(value);
  if (normalized < 1) {
    throw new Error(error);
  }

  return normalized;
}

function normalizeShots(value: unknown): StoryboardArrangeShotRequest[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("INVALID_SHOTS");
  }

  const shots = value.map((item) => {
    const shot = assertBody(item);
    return {
      shotId: readRequiredString(shot, "shotId", "INVALID_SHOT_ID"),
      order: readPositiveOrder(shot, "order", "INVALID_SHOT_ORDER"),
      imageFileId: readRequiredString(shot, "imageFileId", "INVALID_IMAGE_FILE_ID"),
    } satisfies StoryboardArrangeShotRequest;
  });

  const seenShotIds = new Set<string>();
  shots.forEach((shot) => {
    if (seenShotIds.has(shot.shotId)) {
      throw new Error("DUPLICATE_SHOT_ID");
    }

    seenShotIds.add(shot.shotId);
  });

  return shots;
}

export function validateStoryboardArrangeRequest(input: unknown): StoryboardArrangeRequest {
  const body = assertBody(input);
  const nodeType = readRequiredString(body, "nodeType", "INVALID_NODE_TYPE");

  if (nodeType !== AI_STORYBOARD_ARRANGE_NODE_TYPE) {
    throw new Error("INVALID_NODE_TYPE");
  }

  return {
    workflowId: readRequiredString(body, "workflowId", "INVALID_WORKFLOW_ID"),
    nodeId: readRequiredString(body, "nodeId", "INVALID_NODE_ID"),
    nodeType: AI_STORYBOARD_ARRANGE_NODE_TYPE,
    shots: normalizeShots(body.shots),
  };
}
