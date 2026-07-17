import {
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS,
  isAIImageGenParameterlessModel,
  AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
  AI_IMAGE_INPAINT_DEFAULT_MODEL,
  AI_IMAGE_INPAINT_EXECUTION_MODE,
  AI_IMAGE_INPAINT_MAX_GROUP_COUNT,
  AI_IMAGE_INPAINT_MIN_GROUP_COUNT,
  AI_IMAGE_INPAINT_NODE_TYPE,
  AI_IMAGE_INPAINT_PROVIDER,
  AI_IMAGE_INPAINT_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_INPAINT_SUPPORTED_IMAGE_SIZES,
  AI_IMAGE_INPAINT_SUPPORTED_MODELS,
  AI_IMAGE_INPAINT_TASK_TYPE,
  EXECUTION_MODES,
  isAIImageInpaintMaskMode,
  NODE_TASK_TYPES,
  type AIImageInpaintSupportedModel,
} from "@newworkflow/backend-shared";
import type {
  AIImageInpaintCreateExecutionRequest,
  AIImageInpaintExecutionGroup,
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
    && (AI_IMAGE_INPAINT_SUPPORTED_IMAGE_SIZES as readonly string[]).includes(value);
}

function isSupportedAspectRatio(value: unknown): value is SharedSupportedAspectRatio {
  return typeof value === "string"
    && (AI_IMAGE_INPAINT_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value);
}

function isSupportedModel(value: unknown): value is AIImageInpaintSupportedModel {
  return typeof value === "string"
    && (AI_IMAGE_INPAINT_SUPPORTED_MODELS as readonly string[]).includes(value);
}

function isSupportedGptImage2VipAspectRatio(value: unknown): boolean {
  return typeof value === "string"
    && (AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value);
}

function validateGroup(group: AIImageInpaintExecutionGroup, index: number): void {
  if (!group.groupId?.trim()) {
    throw new Error(`INVALID_AI_IMAGE_INPAINT_GROUP_ID:${index}`);
  }

  if (!group.sourceFileId?.trim()) {
    throw new Error(`INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID:${index}`);
  }

  if (!group.maskFileId?.trim()) {
    throw new Error(`INVALID_AI_IMAGE_INPAINT_MASK_FILE_ID:${index}`);
  }
}

function mapAIImageInpaintValidationError(error: string): CreateExecutionErrorMapping | null {
  if (error === "INVALID_AI_IMAGE_INPAINT_PROMPT") {
    return { code: 40041, message: "AI image inpaint requires a non-empty prompt." };
  }

  if (error === "INVALID_AI_IMAGE_INPAINT_GROUP_COUNT") {
    return { code: 40037, message: "AI image inpaint requires exactly one input group." };
  }

  if (error.startsWith("INVALID_AI_IMAGE_INPAINT_GROUP_ID:")) {
    return { code: 40031, message: "groupId is invalid." };
  }

  if (error.startsWith("INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID:")) {
    return { code: 40038, message: "sourceFileId is invalid." };
  }

  if (error.startsWith("INVALID_AI_IMAGE_INPAINT_MASK_FILE_ID:")) {
    return { code: 40038, message: "maskFileId is invalid." };
  }

  if (error === "INVALID_AI_IMAGE_INPAINT_MASK_MODE") {
    return { code: 40046, message: "maskMode is invalid." };
  }

  if (error === "INVALID_AI_IMAGE_INPAINT_MODEL") {
    return { code: 40045, message: "model is invalid." };
  }

  if (error.startsWith("INVALID_AI_IMAGE_INPAINT_IMAGE_SIZE:")) {
    return { code: 40039, message: "imageSize is invalid." };
  }

  if (error.startsWith("INVALID_AI_IMAGE_INPAINT_ASPECT_RATIO:")) {
    return { code: 40040, message: "aspectRatio is invalid." };
  }

  return null;
}

export const aiImageInpaintExecutionNode:
ExecutionNodeDefinition<AIImageInpaintCreateExecutionRequest> = {
  nodeType: AI_IMAGE_INPAINT_NODE_TYPE,
  validateRequest(input: unknown): AIImageInpaintCreateExecutionRequest {
    if (!isRecord(input)) {
      throw new Error("INVALID_BODY");
    }

    const request = input as unknown as AIImageInpaintCreateExecutionRequest;

    if (request.nodeType !== AI_IMAGE_INPAINT_NODE_TYPE) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (request.taskType !== AI_IMAGE_INPAINT_TASK_TYPE) {
      throw new Error("INVALID_TASK_TYPE");
    }

    if (
      request.taskType !== NODE_TASK_TYPES.aiImageInpaint
      || request.executionMode !== AI_IMAGE_INPAINT_EXECUTION_MODE
      || request.executionMode !== EXECUTION_MODES.legacyGroupedTask
    ) {
      throw new Error(
        request.executionMode !== AI_IMAGE_INPAINT_EXECUTION_MODE
          ? "INVALID_EXECUTION_MODE"
          : "INVALID_TASK_TYPE",
      );
    }

    const prompt = normalizeOptionalString(request.prompt);
    if (!prompt) {
      throw new Error("INVALID_AI_IMAGE_INPAINT_PROMPT");
    }

    const model = typeof request.model === "undefined"
      ? AI_IMAGE_INPAINT_DEFAULT_MODEL
      : request.model;

    if (!isSupportedModel(model)) {
      throw new Error("INVALID_AI_IMAGE_INPAINT_MODEL");
    }

    if (!Array.isArray(request.groups) || request.groups.length === 0) {
      throw new Error("INVALID_GROUPS");
    }

    if (
      request.groups.length < AI_IMAGE_INPAINT_MIN_GROUP_COUNT
      || request.groups.length > AI_IMAGE_INPAINT_MAX_GROUP_COUNT
    ) {
      throw new Error("INVALID_AI_IMAGE_INPAINT_GROUP_COUNT");
    }

    const maskMode = typeof request.maskMode === "undefined"
      ? AI_IMAGE_INPAINT_DEFAULT_MASK_MODE
      : request.maskMode;

    if (!isAIImageInpaintMaskMode(maskMode)) {
      throw new Error("INVALID_AI_IMAGE_INPAINT_MASK_MODE");
    }

    if (typeof request.imageSize !== "undefined" && !isSupportedImageSize(request.imageSize)) {
      throw new Error("INVALID_AI_IMAGE_INPAINT_IMAGE_SIZE:request");
    }

    if (typeof request.aspectRatio !== "undefined" && !isSupportedAspectRatio(request.aspectRatio)) {
      throw new Error("INVALID_AI_IMAGE_INPAINT_ASPECT_RATIO:request");
    }

    const imageSize = request.imageSize ?? AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE;
    const aspectRatio = request.aspectRatio ?? AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO;
    const usesParameters = !isAIImageGenParameterlessModel(model);

    if (model === "gpt-image-2-vip" && !isSupportedGptImage2VipAspectRatio(aspectRatio)) {
      throw new Error("INVALID_AI_IMAGE_INPAINT_ASPECT_RATIO:request");
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
      ...(usesParameters ? { imageSize, aspectRatio } : {}),
      maskMode,
      groups: request.groups.map((group) => ({
        groupId: group.groupId.trim(),
        sourceFileId: group.sourceFileId.trim(),
        maskFileId: group.maskFileId.trim(),
      })),
    };
  },
  collectFileIds(input) {
    return input.groups.flatMap((group) => [
      group.sourceFileId,
      group.maskFileId,
    ]);
  },
  buildCreateExecutionStoreInput(input): CreateExecutionStoreInput {
    const model = input.model ?? AI_IMAGE_INPAINT_DEFAULT_MODEL;
    const usesParameters = !isAIImageGenParameterlessModel(model);
    const imageSize = usesParameters ? input.imageSize ?? AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE : undefined;
    const aspectRatio = usesParameters ? input.aspectRatio ?? AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO : undefined;
    const maskMode = input.maskMode ?? AI_IMAGE_INPAINT_DEFAULT_MASK_MODE;

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
        provider: AI_IMAGE_INPAINT_PROVIDER,
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
        provider: AI_IMAGE_INPAINT_PROVIDER,
        model,
        input: {
          prompt: input.prompt,
          model,
          inputFileId: group.sourceFileId,
          sourceFileId: group.sourceFileId,
          maskFileId: group.maskFileId,
          maskMode,
          ...(usesParameters ? { imageSize, aspectRatio } : {}),
        },
      })),
    };
  },
  mapValidationError: mapAIImageInpaintValidationError,
};
