import {
  AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
  AI_VIDEO_GEN_EXECUTION_MODE,
  AI_VIDEO_GEN_MAX_REFERENCE_COUNT,
  AI_VIDEO_GEN_MIN_REFERENCE_COUNT,
  AI_VIDEO_GEN_MODEL,
  AI_VIDEO_GEN_NODE_TYPE,
  AI_VIDEO_GEN_PROVIDER,
  AI_VIDEO_GEN_TASK_TYPE,
  EXECUTION_MODES,
  NODE_TASK_TYPES,
  normalizeAIVideoGenDuration,
  normalizeAIVideoGenParameters,
  normalizeAIVideoGenModel,
} from "@newworkflow/backend-shared";
import type {
  AIVideoGenCreateExecutionRequest,
  AIVideoGenExecutionGroup,
} from "@newworkflow/backend-shared/api";
import type {
  CreateExecutionStoreInput,
} from "../executions.repository.ts";
import type {
  CreateExecutionErrorMapping,
  ExecutionNodeDefinition,
} from "../execution-node.types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRequiredString(value: unknown, error: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(error);
  }

  return normalized;
}

function isAIVideoGenNodeType(
  value: unknown,
): value is AIVideoGenCreateExecutionRequest["nodeType"] {
  return value === AI_VIDEO_GEN_NODE_TYPE || value === "aiStoryboard";
}

function normalizeReferenceFileIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("INVALID_REFERENCE_FILE_IDS");
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function validateGroup(group: AIVideoGenExecutionGroup, index: number): void {
  if (!group.groupId?.trim()) {
    throw new Error(`INVALID_GROUP_ID:${index}`);
  }

  const referenceFileIds = normalizeReferenceFileIds(group.referenceFileIds);

  if (referenceFileIds.length < AI_VIDEO_GEN_MIN_REFERENCE_COUNT) {
    throw new Error(`INVALID_REFERENCE_FILE_COUNT:${index}`);
  }

  if (referenceFileIds.length > AI_VIDEO_GEN_MAX_REFERENCE_COUNT) {
    throw new Error(`INVALID_REFERENCE_FILE_COUNT:${index}`);
  }
}

function mapAIVideoGenValidationError(error: string): CreateExecutionErrorMapping | null {
  if (error === "INVALID_PROMPT") {
    return { code: 40041, message: "AI 视频节点必须提供非空 prompt。" };
  }

  if (error === "INVALID_MODEL") {
    return { code: 40045, message: "model 不在支持范围内。" };
  }

  if (error === "INVALID_DURATION") {
    return { code: 40046, message: "duration 当前仅支持 8 秒。" };
  }

  if (error === "INVALID_VIDEO_PARAMETERS") {
    return { code: 40048, message: "aspectRatio/resolution combination is invalid." };
  }

  if (error.startsWith("INVALID_GROUP_ID:")) {
    return { code: 40031, message: "groupId 不能为空。" };
  }

  if (error.startsWith("INVALID_REFERENCE_FILE_COUNT:")) {
    return { code: 40047, message: "每个 group 必须提供 1 到 4 个 referenceFileIds。" };
  }

  return null;
}

export const aiVideoGenExecutionNode:
ExecutionNodeDefinition<AIVideoGenCreateExecutionRequest> = {
  nodeType: AI_VIDEO_GEN_NODE_TYPE,
  validateRequest(input: unknown): AIVideoGenCreateExecutionRequest {
    if (!isRecord(input)) {
      throw new Error("INVALID_BODY");
    }

    const request = input as unknown as AIVideoGenCreateExecutionRequest;

    if (!isAIVideoGenNodeType(request.nodeType)) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (request.taskType !== AI_VIDEO_GEN_TASK_TYPE) {
      throw new Error("INVALID_TASK_TYPE");
    }

    if (
      request.taskType !== NODE_TASK_TYPES.aiVideoGen
      || request.executionMode !== AI_VIDEO_GEN_EXECUTION_MODE
      || request.executionMode !== EXECUTION_MODES.legacyGroupedTask
    ) {
      throw new Error(
        request.executionMode !== AI_VIDEO_GEN_EXECUTION_MODE
          ? "INVALID_EXECUTION_MODE"
          : "INVALID_TASK_TYPE",
      );
    }

    const prompt = normalizeOptionalString(request.prompt);
    if (!prompt) {
      throw new Error("INVALID_PROMPT");
    }

    const model = normalizeAIVideoGenModel(request.model);
    if (!model) {
      throw new Error("INVALID_MODEL");
    }

    const duration = normalizeAIVideoGenDuration(request.duration);
    if (duration === null) {
      throw new Error("INVALID_DURATION");
    }

    const videoParameters = normalizeAIVideoGenParameters({
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      duration,
    });
    if (!videoParameters) {
      throw new Error("INVALID_VIDEO_PARAMETERS");
    }

    if (!Array.isArray(request.groups) || request.groups.length === 0) {
      throw new Error("INVALID_GROUPS");
    }

    request.groups.forEach((group, index) => validateGroup(group, index));

    return {
      workflowId: normalizeRequiredString(request.workflowId, "INVALID_WORKFLOW_ID"),
      nodeType: request.nodeType,
      taskType: request.taskType,
      executionMode: request.executionMode,
      nodeId: normalizeOptionalString(request.nodeId),
      nodeTitle: normalizeOptionalString(request.nodeTitle),
      prompt,
      model,
      duration,
      aspectRatio: videoParameters.aspectRatio,
      resolution: videoParameters.resolution,
      size: videoParameters.size,
      groups: request.groups.map((group) => ({
        groupId: group.groupId.trim(),
        referenceFileIds: normalizeReferenceFileIds(group.referenceFileIds),
      })),
    };
  },
  collectFileIds(input) {
    return input.groups.flatMap((group) => group.referenceFileIds);
  },
  buildCreateExecutionStoreInput(input): CreateExecutionStoreInput {
    return {
      run: {
        userId: input.userId ?? null,
        workflowId: input.workflowId ?? null,
        projectId: null,
        nodeType: input.nodeType,
        taskType: input.taskType,
        executionMode: input.executionMode,
        nodeId: input.nodeId ?? null,
        nodeTitle: input.nodeTitle ?? null,
        provider: AI_VIDEO_GEN_PROVIDER,
        requestPayload: input,
      },
      tasks: input.groups.map((group, index) => ({
        workflowId: input.workflowId ?? null,
        projectId: null,
        nodeType: input.nodeType,
        nodeId: input.nodeId ?? null,
        nodeTitle: input.nodeTitle ?? null,
        taskType: input.taskType,
        groupId: group.groupId,
        groupOrder: index + 1,
        provider: AI_VIDEO_GEN_PROVIDER,
        model: input.model ?? AI_VIDEO_GEN_MODEL,
        input: {
          prompt: input.prompt,
          model: input.model ?? AI_VIDEO_GEN_MODEL,
          duration: input.duration ?? AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
          aspectRatio: input.aspectRatio,
          resolution: input.resolution,
          size: input.size,
          referenceFileIds: group.referenceFileIds,
        },
      })),
    };
  },
  mapValidationError: mapAIVideoGenValidationError,
};
