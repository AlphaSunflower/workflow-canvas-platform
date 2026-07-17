import {
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS,
  EXECUTION_MODES,
  isAIImageGenParameterlessModel,
  NODE_TASK_TYPES,
  WHITE_MODEL_RENDER_DEFAULT_ASPECT_RATIO_MODE,
  WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE,
  WHITE_MODEL_RENDER_DEFAULT_MODEL,
  WHITE_MODEL_RENDER_EXECUTION_MODE,
  WHITE_MODEL_RENDER_NODE_TYPE,
  WHITE_MODEL_RENDER_PROVIDER,
  WHITE_MODEL_RENDER_SUPPORTED_ASPECT_RATIOS,
  WHITE_MODEL_RENDER_SUPPORTED_IMAGE_SIZES,
  WHITE_MODEL_RENDER_SUPPORTED_MODELS,
  WHITE_MODEL_RENDER_TASK_TYPE,
  type WhiteModelRenderSupportedModel,
} from "@newworkflow/backend-shared";
import type {
  WhiteModelRenderCreateExecutionRequest,
  WhiteModelRenderExecutionGroup,
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
    && (WHITE_MODEL_RENDER_SUPPORTED_IMAGE_SIZES as readonly string[]).includes(value);
}

function isSupportedAspectRatio(value: unknown): value is SharedSupportedAspectRatio {
  return typeof value === "string"
    && (WHITE_MODEL_RENDER_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value);
}

function isSupportedModel(value: unknown): value is WhiteModelRenderSupportedModel {
  return typeof value === "string"
    && (WHITE_MODEL_RENDER_SUPPORTED_MODELS as readonly string[]).includes(value);
}

function isSupportedGptImage2VipAspectRatio(value: unknown): boolean {
  return typeof value === "string"
    && (AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value);
}

function validateGroup(group: WhiteModelRenderExecutionGroup, index: number): void {
  if (!group.groupId?.trim()) {
    throw new Error(`INVALID_GROUP_ID:${index}`);
  }

  if (!group.whiteModelFileId?.trim()) {
    throw new Error(`INVALID_WHITE_MODEL_FILE_ID:${index}`);
  }

  if (!group.styleReferenceFileId?.trim()) {
    throw new Error(`INVALID_STYLE_REFERENCE_FILE_ID:${index}`);
  }
}

function mapWhiteModelValidationError(error: string): CreateExecutionErrorMapping | null {
  if (error.startsWith("INVALID_GROUP_ID:")) {
    return { code: 40031, message: "groupId is invalid." };
  }

  if (error.startsWith("INVALID_WHITE_MODEL_FILE_ID:")) {
    return { code: 40032, message: "white model file id is invalid." };
  }

  if (error.startsWith("INVALID_STYLE_REFERENCE_FILE_ID:")) {
    return { code: 40033, message: "style reference file id is invalid." };
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

export const whiteModelRenderExecutionNode:
ExecutionNodeDefinition<WhiteModelRenderCreateExecutionRequest> = {
  nodeType: WHITE_MODEL_RENDER_NODE_TYPE,
  validateRequest(input: unknown): WhiteModelRenderCreateExecutionRequest {
    if (!isRecord(input)) {
      throw new Error("INVALID_BODY");
    }

    const request = input as unknown as WhiteModelRenderCreateExecutionRequest;

    if (request.nodeType !== WHITE_MODEL_RENDER_NODE_TYPE) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (request.taskType !== WHITE_MODEL_RENDER_TASK_TYPE) {
      throw new Error("INVALID_TASK_TYPE");
    }

    if (
      request.taskType !== NODE_TASK_TYPES.whiteModelRenderTransfer
      || request.executionMode !== WHITE_MODEL_RENDER_EXECUTION_MODE
      || request.executionMode !== EXECUTION_MODES.legacyGroupedTask
    ) {
      throw new Error(
        request.executionMode !== WHITE_MODEL_RENDER_EXECUTION_MODE
          ? "INVALID_EXECUTION_MODE"
          : "INVALID_TASK_TYPE",
      );
    }

    if (!Array.isArray(request.groups) || request.groups.length === 0) {
      throw new Error("INVALID_GROUPS");
    }

    const model = typeof request.model === "undefined"
      ? WHITE_MODEL_RENDER_DEFAULT_MODEL
      : request.model;

    if (!isSupportedModel(model)) {
      throw new Error("INVALID_MODEL");
    }

    if (typeof request.imageSize !== "undefined" && !isSupportedImageSize(request.imageSize)) {
      throw new Error("INVALID_IMAGE_SIZE:request");
    }

    if (typeof request.aspectRatio !== "undefined" && !isSupportedAspectRatio(request.aspectRatio)) {
      throw new Error("INVALID_ASPECT_RATIO:request");
    }

    const imageSize = request.imageSize ?? WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE;
    const aspectRatio = request.aspectRatio ?? WHITE_MODEL_RENDER_DEFAULT_ASPECT_RATIO_MODE;
    const usesParameters = !isAIImageGenParameterlessModel(model);

    if (model === "gpt-image-2-vip" && !isSupportedGptImage2VipAspectRatio(aspectRatio)) {
      throw new Error("INVALID_ASPECT_RATIO:request");
    }

    request.groups.forEach((group, index) => validateGroup(group, index));

    return {
      workflowId: normalizeRequiredString(request.workflowId, "INVALID_WORKFLOW_ID"),
      nodeType: request.nodeType,
      taskType: request.taskType,
      executionMode: request.executionMode,
      nodeId: normalizeOptionalString(request.nodeId),
      nodeTitle: normalizeOptionalString(request.nodeTitle),
      model,
      ...(usesParameters ? { imageSize, aspectRatio } : {}),
      groups: request.groups.map((group) => ({
        groupId: group.groupId.trim(),
        whiteModelFileId: group.whiteModelFileId.trim(),
        styleReferenceFileId: group.styleReferenceFileId.trim(),
      })),
    };
  },
  collectFileIds(input) {
    return input.groups.flatMap((group) => [
      group.whiteModelFileId,
      group.styleReferenceFileId,
    ]);
  },
  buildCreateExecutionStoreInput(input): CreateExecutionStoreInput {
    const model = input.model ?? WHITE_MODEL_RENDER_DEFAULT_MODEL;
    const usesParameters = !isAIImageGenParameterlessModel(model);
    const imageSize = usesParameters ? input.imageSize ?? WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE : undefined;
    const aspectRatio = usesParameters ? input.aspectRatio ?? WHITE_MODEL_RENDER_DEFAULT_ASPECT_RATIO_MODE : undefined;

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
        provider: WHITE_MODEL_RENDER_PROVIDER,
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
        provider: WHITE_MODEL_RENDER_PROVIDER,
        model,
        input: {
          model,
          ...(usesParameters ? { imageSize, aspectRatio } : {}),
          whiteModelFileId: group.whiteModelFileId,
          styleReferenceFileId: group.styleReferenceFileId,
        },
        whiteModelFileId: group.whiteModelFileId,
        styleReferenceFileId: group.styleReferenceFileId,
      })),
    };
  },
  mapValidationError: mapWhiteModelValidationError,
};
