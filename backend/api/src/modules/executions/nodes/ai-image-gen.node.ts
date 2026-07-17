import {
  AI_IMAGE_GEN_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_GEN_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_GEN_DEFAULT_MODEL,
  AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY,
  AI_IMAGE_GEN_EXECUTION_MODE,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_LEGACY_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_GEN_MAX_REFERENCE_COUNT,
  AI_IMAGE_GEN_MIN_REFERENCE_COUNT,
  AI_IMAGE_GEN_MODEL,
  AI_IMAGE_GEN_NODE_TYPE,
  AI_IMAGE_GEN_PROVIDER,
  AI_IMAGE_GEN_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_GEN_SUPPORTED_IMAGE_SIZES,
  AI_IMAGE_GEN_SUPPORTED_MODELS,
  AI_IMAGE_GEN_TASK_TYPE,
  EXECUTION_MODES,
  LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE,
  NODE_TASK_TYPES,
  isAIImageGenOfficialQuality,
  isAIImageGenParameterlessModel,
  resolveAIImageGenOutputSize,
  type AIImageGenOfficialQuality,
  type AIImageGenSupportedModel,
} from "@newworkflow/backend-shared";
import type {
  AIImageGenCreateExecutionRequest,
  AIImageGenExecutionGroup,
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
    && (AI_IMAGE_GEN_SUPPORTED_IMAGE_SIZES as readonly string[]).includes(value);
}

function isSupportedAspectRatio(value: unknown): value is SharedSupportedAspectRatio {
  return typeof value === "string"
    && (AI_IMAGE_GEN_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value);
}

function isSupportedModel(value: unknown): value is AIImageGenSupportedModel {
  return typeof value === "string"
    && (AI_IMAGE_GEN_SUPPORTED_MODELS as readonly string[]).includes(value);
}

function isSupportedGptImage2VipAspectRatio(value: unknown): boolean {
  return typeof value === "string"
    && (AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value);
}

function normalizeOfficialQuality(value: unknown): AIImageGenOfficialQuality {
  if (typeof value === "undefined") {
    return AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY;
  }

  if (!isAIImageGenOfficialQuality(value)) {
    throw new Error("INVALID_QUALITY");
  }

  return value;
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

function isAIImageGenNodeType(value: unknown): value is AIImageGenCreateExecutionRequest["nodeType"] {
  return value === AI_IMAGE_GEN_NODE_TYPE || value === "aiStoryboard";
}

function validateGroup(
  group: AIImageGenExecutionGroup,
  index: number,
  options?: {
    minReferenceCount?: number;
  },
): void {
  if (!group.groupId?.trim()) {
    throw new Error(`INVALID_GROUP_ID:${index}`);
  }

  const referenceFileIds = normalizeReferenceFileIds(group.referenceFileIds);
  const minReferenceCount = options?.minReferenceCount ?? AI_IMAGE_GEN_MIN_REFERENCE_COUNT;

  if (referenceFileIds.length < minReferenceCount) {
    throw new Error(`INVALID_REFERENCE_FILE_COUNT:${index}`);
  }

  if (referenceFileIds.length > AI_IMAGE_GEN_MAX_REFERENCE_COUNT) {
    throw new Error(`INVALID_REFERENCE_FILE_COUNT:${index}`);
  }
}

function getMinReferenceCountForModel(model: AIImageGenSupportedModel): number {
    if (
      model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL
      ||
      model === AI_IMAGE_GEN_GPT_IMAGE_2_LEGACY_MODEL
      || model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL
    || model === AI_IMAGE_GEN_MODEL
  ) {
    return 0;
  }

  return AI_IMAGE_GEN_MIN_REFERENCE_COUNT;
}

function mapAIImageGenValidationError(error: string): CreateExecutionErrorMapping | null {
  if (error === "INVALID_PROMPT") {
    return { code: 40041, message: "AI 生图节点必须提供非空 prompt。" };
  }

  if (error.startsWith("INVALID_GROUP_ID:")) {
    return { code: 40031, message: "groupId 不能为空。" };
  }

  if (error.startsWith("INVALID_REFERENCE_FILE_COUNT:")) {
    return { code: 40042, message: "每个 group 必须提供 1 到 5 个 referenceFileIds。" };
  }

  if (error === "INVALID_MODEL") {
    return { code: 40045, message: "model 不在支持范围内。" };
  }

  if (error.startsWith("INVALID_IMAGE_SIZE:")) {
    return { code: 40039, message: "imageSize 不在支持范围内。" };
  }

  if (error.startsWith("INVALID_ASPECT_RATIO:")) {
    return { code: 40040, message: "aspectRatio 不在支持范围内。" };
  }

  if (error === "INVALID_QUALITY") {
    return { code: 40046, message: "quality 不在支持范围内。" };
  }

  return null;
}

export const aiImageGenExecutionNode:
ExecutionNodeDefinition<AIImageGenCreateExecutionRequest> = {
  nodeType: AI_IMAGE_GEN_NODE_TYPE,
  validateRequest(input: unknown): AIImageGenCreateExecutionRequest {
    if (!isRecord(input)) {
      throw new Error("INVALID_BODY");
    }

    const request = input as unknown as AIImageGenCreateExecutionRequest;

    if (!isAIImageGenNodeType(request.nodeType)) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (request.taskType !== AI_IMAGE_GEN_TASK_TYPE) {
      throw new Error("INVALID_TASK_TYPE");
    }

    if (
      request.taskType !== NODE_TASK_TYPES.aiImageGen
      || request.executionMode !== AI_IMAGE_GEN_EXECUTION_MODE
      || request.executionMode !== EXECUTION_MODES.legacyGroupedTask
    ) {
      throw new Error(
        request.executionMode !== AI_IMAGE_GEN_EXECUTION_MODE
          ? "INVALID_EXECUTION_MODE"
          : "INVALID_TASK_TYPE",
      );
    }

    const prompt = normalizeOptionalString(request.prompt);
    if (!prompt) {
      throw new Error("INVALID_PROMPT");
    }

    const model = typeof request.model === "undefined"
      ? AI_IMAGE_GEN_DEFAULT_MODEL
      : request.model;

    if (!isSupportedModel(model)) {
      throw new Error("INVALID_MODEL");
    }

    if (!Array.isArray(request.groups) || request.groups.length === 0) {
      throw new Error("INVALID_GROUPS");
    }

    if (typeof request.imageSize !== "undefined" && !isSupportedImageSize(request.imageSize)) {
      throw new Error("INVALID_IMAGE_SIZE:request");
    }

    if (typeof request.aspectRatio !== "undefined" && !isSupportedAspectRatio(request.aspectRatio)) {
      throw new Error("INVALID_ASPECT_RATIO:request");
    }

    const imageSize = request.imageSize ?? AI_IMAGE_GEN_DEFAULT_IMAGE_SIZE;
    const aspectRatio = request.aspectRatio ?? AI_IMAGE_GEN_DEFAULT_ASPECT_RATIO;
    const usesParameters = !isAIImageGenParameterlessModel(model);

    if (
      model === AI_IMAGE_GEN_GPT_IMAGE_2_LEGACY_MODEL
      && !isSupportedGptImage2VipAspectRatio(aspectRatio)
    ) {
      throw new Error("INVALID_ASPECT_RATIO:request");
    }

    const quality = model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL
      ? normalizeOfficialQuality(request.quality)
      : undefined;
    const resolvedSize = resolveAIImageGenOutputSize(model, imageSize, aspectRatio);

    if (model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL && !resolvedSize) {
      throw new Error("INVALID_ASPECT_RATIO:request");
    }

    const minReferenceCount = getMinReferenceCountForModel(model);
    request.groups.forEach((group, index) => validateGroup(group, index, { minReferenceCount }));

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
      quality,
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
    const model = input.model ?? AI_IMAGE_GEN_DEFAULT_MODEL;
    const usesParameters = !isAIImageGenParameterlessModel(model);
    const imageSize = usesParameters ? input.imageSize ?? AI_IMAGE_GEN_DEFAULT_IMAGE_SIZE : undefined;
    const aspectRatio = usesParameters ? input.aspectRatio ?? AI_IMAGE_GEN_DEFAULT_ASPECT_RATIO : undefined;
    const isOfficialModel = model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL;
    const quality = isOfficialModel
      ? input.quality ?? AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY
      : undefined;
    const resolvedSize = isOfficialModel
      ? resolveAIImageGenOutputSize(model, imageSize ?? AI_IMAGE_GEN_DEFAULT_IMAGE_SIZE, aspectRatio ?? "auto")
      : null;

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
        provider: AI_IMAGE_GEN_PROVIDER,
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
        provider: AI_IMAGE_GEN_PROVIDER,
        model,
        input: {
          prompt: input.prompt,
          model,
          referenceFileIds: group.referenceFileIds,
          ...(usesParameters ? { imageSize, aspectRatio } : {}),
          ...(isOfficialModel
            ? {
                quality,
                providerRoute: LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE,
                providerModel: AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
                resolvedSize,
              }
            : {}),
        },
      })),
    };
  },
  mapValidationError: mapAIImageGenValidationError,
};
