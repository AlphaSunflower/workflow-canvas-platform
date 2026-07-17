import {
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_MAX_REFERENCE_COUNT,
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_MIN_REFERENCE_COUNT,
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_NODE_TYPE,
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_PROMPT_VERSION,
} from "./prompt-optimize.constants.ts";

export interface PromptOptimizeRequest {
  workflowId: string;
  nodeId: string;
  nodeType: typeof AI_IMAGE_GEN_PROMPT_OPTIMIZE_NODE_TYPE;
  prompt: string;
  referenceFileIds: string[];
}

export interface PromptOptimizeResponseData {
  optimizedPrompt: string;
  model: string;
  referenceCount: number;
  promptVersion: typeof AI_IMAGE_GEN_PROMPT_OPTIMIZE_PROMPT_VERSION;
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

function normalizeReferenceFileIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("INVALID_REFERENCE_FILE_IDS");
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (
    normalized.length < AI_IMAGE_GEN_PROMPT_OPTIMIZE_MIN_REFERENCE_COUNT
    || normalized.length > AI_IMAGE_GEN_PROMPT_OPTIMIZE_MAX_REFERENCE_COUNT
  ) {
    throw new Error("INVALID_REFERENCE_FILE_COUNT");
  }

  return normalized;
}

export function validatePromptOptimizeRequest(input: unknown): PromptOptimizeRequest {
  const body = assertBody(input);
  const nodeType = readRequiredString(body, "nodeType", "INVALID_NODE_TYPE");

  if (nodeType !== AI_IMAGE_GEN_PROMPT_OPTIMIZE_NODE_TYPE) {
    throw new Error("INVALID_NODE_TYPE");
  }

  return {
    workflowId: readRequiredString(body, "workflowId", "INVALID_WORKFLOW_ID"),
    nodeId: readRequiredString(body, "nodeId", "INVALID_NODE_ID"),
    nodeType: AI_IMAGE_GEN_PROMPT_OPTIMIZE_NODE_TYPE,
    prompt: readRequiredString(body, "prompt", "INVALID_PROMPT"),
    referenceFileIds: normalizeReferenceFileIds(body.referenceFileIds),
  };
}
