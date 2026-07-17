import {
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS,
  isAIImageGenParameterlessModel,
  AI_IMAGE_HD_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_HD_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_HD_DEFAULT_MODEL,
  AI_IMAGE_HD_EXECUTION_MODE,
  AI_IMAGE_HD_NODE_TYPE,
  AI_IMAGE_HD_PROVIDER,
  AI_IMAGE_HD_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_HD_SUPPORTED_IMAGE_SIZES,
  AI_IMAGE_HD_SUPPORTED_MODELS,
  AI_IMAGE_HD_TASK_TYPE,
  EXECUTION_MODES,
  NODE_TASK_TYPES,
  type AIImageHdSupportedModel,
} from "@newworkflow/backend-shared";
import type {
  AIImageHdCreateExecutionRequest,
  SourceImageExecutionGroup,
} from "@newworkflow/backend-shared/api";
import type {
  SharedSupportedAspectRatio,
  SharedSupportedImageSize,
} from "@newworkflow/backend-shared/execution";
import type { CreateExecutionStoreInput } from "../executions.repository.ts";
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

function isSupportedImageSize(value: unknown): value is SharedSupportedImageSize {
  return typeof value === "string"
    && (AI_IMAGE_HD_SUPPORTED_IMAGE_SIZES as readonly string[]).includes(value);
}

function isSupportedAspectRatio(value: unknown): value is SharedSupportedAspectRatio {
  return typeof value === "string"
    && (AI_IMAGE_HD_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value);
}

function isSupportedModel(value: unknown): value is AIImageHdSupportedModel {
  return typeof value === "string"
    && (AI_IMAGE_HD_SUPPORTED_MODELS as readonly string[]).includes(value);
}

function isSupportedGptImage2VipAspectRatio(value: unknown): boolean {
  return typeof value === "string"
    && (AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value);
}

function validateGroup(group: SourceImageExecutionGroup, index: number): void {
  if (!group.groupId?.trim()) {
    throw new Error(`INVALID_GROUP_ID:${index}`);
  }

  if (!group.sourceFileId?.trim()) {
    throw new Error(`INVALID_INPUT_FILE_ID:${index}`);
  }

  if (typeof group.imageSize !== "undefined" && !isSupportedImageSize(group.imageSize)) {
    throw new Error(`INVALID_IMAGE_SIZE:${index}`);
  }

  if (typeof group.aspectRatio !== "undefined" && !isSupportedAspectRatio(group.aspectRatio)) {
    throw new Error(`INVALID_ASPECT_RATIO:${index}`);
  }
}

function mapAIImageHdValidationError(error: string): CreateExecutionErrorMapping | null {
  if (error.startsWith("INVALID_GROUP_ID:")) {
    return { code: 40031, message: "groupId is invalid." };
  }

  if (error.startsWith("INVALID_INPUT_FILE_ID:")) {
    return { code: 40038, message: "source file id is invalid." };
  }

  if (error === "INVALID_MODEL") {
    return { code: 40045, message: "model is invalid." };
  }

  if (error.startsWith("INVALID_IMAGE_SIZE:")) {
    return { code: 40039, message: "imageSize is invalid." };
  }

  if (error.startsWith("INVALID_ASPECT_RATIO:")) {
    return { code: 40040, message: "aspectRatio is invalid." };
  }

  return null;
}

export const aiImageHdExecutionNode:
ExecutionNodeDefinition<AIImageHdCreateExecutionRequest> = {
  nodeType: AI_IMAGE_HD_NODE_TYPE,
  validateRequest(input: unknown): AIImageHdCreateExecutionRequest {
    if (!isRecord(input)) {
      throw new Error("INVALID_BODY");
    }

    const request = input as unknown as AIImageHdCreateExecutionRequest;

    if (request.nodeType !== AI_IMAGE_HD_NODE_TYPE) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (request.taskType !== AI_IMAGE_HD_TASK_TYPE) {
      throw new Error("INVALID_TASK_TYPE");
    }

    if (
      request.taskType !== NODE_TASK_TYPES.aiImageHd
      || request.executionMode !== AI_IMAGE_HD_EXECUTION_MODE
      || request.executionMode !== EXECUTION_MODES.legacyGroupedTask
    ) {
      throw new Error(
        request.executionMode !== AI_IMAGE_HD_EXECUTION_MODE
          ? "INVALID_EXECUTION_MODE"
          : "INVALID_TASK_TYPE",
      );
    }

    if (!Array.isArray(request.groups) || request.groups.length === 0) {
      throw new Error("INVALID_GROUPS");
    }

    const model = typeof request.model === "undefined"
      ? AI_IMAGE_HD_DEFAULT_MODEL
      : request.model;

    if (!isSupportedModel(model)) {
      throw new Error("INVALID_MODEL");
    }

    request.groups.forEach((group, index) => validateGroup(group, index));

    const groups = request.groups.map((group, index) => {
      const usesParameters = !isAIImageGenParameterlessModel(model);
      const imageSize = group.imageSize ?? AI_IMAGE_HD_DEFAULT_IMAGE_SIZE;
      const aspectRatio = group.aspectRatio ?? AI_IMAGE_HD_DEFAULT_ASPECT_RATIO;

      if (model === "gpt-image-2-vip" && !isSupportedGptImage2VipAspectRatio(aspectRatio)) {
        throw new Error(`INVALID_ASPECT_RATIO:${index}`);
      }

      return {
        groupId: group.groupId.trim(),
        sourceFileId: group.sourceFileId.trim(),
        ...(usesParameters ? { imageSize, aspectRatio } : {}),
      };
    });

    return {
      workflowId: normalizeRequiredString(request.workflowId, "INVALID_WORKFLOW_ID"),
      nodeType: request.nodeType,
      taskType: request.taskType,
      executionMode: request.executionMode,
      nodeId: normalizeOptionalString(request.nodeId),
      nodeTitle: normalizeOptionalString(request.nodeTitle),
      model,
      groups,
    };
  },
  collectFileIds(input) {
    return input.groups.map((group) => group.sourceFileId);
  },
  buildCreateExecutionStoreInput(input): CreateExecutionStoreInput {
    const model = input.model ?? AI_IMAGE_HD_DEFAULT_MODEL;
    const usesParameters = !isAIImageGenParameterlessModel(model);

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
        provider: AI_IMAGE_HD_PROVIDER,
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
        provider: AI_IMAGE_HD_PROVIDER,
        model,
        input: {
          model,
          inputFileId: group.sourceFileId,
          sourceFileId: group.sourceFileId,
          ...(usesParameters
            ? {
                imageSize: group.imageSize ?? AI_IMAGE_HD_DEFAULT_IMAGE_SIZE,
                aspectRatio: group.aspectRatio ?? AI_IMAGE_HD_DEFAULT_ASPECT_RATIO,
              }
            : {}),
        },
      })),
    };
  },
  mapValidationError: mapAIImageHdValidationError,
};
