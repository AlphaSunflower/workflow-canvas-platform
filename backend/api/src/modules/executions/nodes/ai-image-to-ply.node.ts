import {
  AI_IMAGE_TO_PLY_EXECUTION_MODE,
  AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
  AI_IMAGE_TO_PLY_INPUT_NODE_ID,
  AI_IMAGE_TO_PLY_NODE_TYPE,
  AI_IMAGE_TO_PLY_OUTPUT_FILE_TYPE,
  AI_IMAGE_TO_PLY_PROVIDER,
  AI_IMAGE_TO_PLY_TASK_TYPE,
  AI_IMAGE_TO_PLY_WORKFLOW_ID,
  AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
  EXECUTION_MODES,
  NODE_TASK_TYPES,
} from "@newworkflow/backend-shared";
import type {
  AIImageToPlyCreateExecutionRequest,
  AIImageToPlyExecutionGroup,
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

function validateGroup(group: AIImageToPlyExecutionGroup, index: number): void {
  if (!group.groupId?.trim()) {
    throw new Error(`INVALID_GROUP_ID:${index}`);
  }

  if (!group.sourceFileId?.trim()) {
    throw new Error(`INVALID_INPUT_FILE_ID:${index}`);
  }
}

function mapAIImageToPlyValidationError(
  error: string,
): CreateExecutionErrorMapping | null {
  if (error.startsWith("INVALID_GROUP_ID:")) {
    return { code: 40031, message: "groupId 不能为空。" };
  }

  if (error.startsWith("INVALID_INPUT_FILE_ID:")) {
    return { code: 40038, message: "每个 group 必须提供输入图片 fileId。" };
  }

  return null;
}

export const aiImageToPlyExecutionNode:
ExecutionNodeDefinition<AIImageToPlyCreateExecutionRequest> = {
  nodeType: AI_IMAGE_TO_PLY_NODE_TYPE,
  validateRequest(input: unknown): AIImageToPlyCreateExecutionRequest {
    if (!isRecord(input)) {
      throw new Error("INVALID_BODY");
    }

    const request = input as unknown as AIImageToPlyCreateExecutionRequest;

    if (request.nodeType !== AI_IMAGE_TO_PLY_NODE_TYPE) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (request.taskType !== AI_IMAGE_TO_PLY_TASK_TYPE) {
      throw new Error("INVALID_TASK_TYPE");
    }

    if (
      request.taskType !== NODE_TASK_TYPES.aiImageToPly
      || request.executionMode !== AI_IMAGE_TO_PLY_EXECUTION_MODE
      || request.executionMode !== EXECUTION_MODES.legacyGroupedTask
    ) {
      throw new Error(
        request.executionMode !== AI_IMAGE_TO_PLY_EXECUTION_MODE
          ? "INVALID_EXECUTION_MODE"
          : "INVALID_TASK_TYPE",
      );
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
      groups: request.groups.map((group) => ({
        groupId: group.groupId.trim(),
        sourceFileId: group.sourceFileId.trim(),
      })),
    };
  },
  collectFileIds(input) {
    return input.groups.map((group) => group.sourceFileId);
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
        provider: AI_IMAGE_TO_PLY_PROVIDER,
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
        provider: AI_IMAGE_TO_PLY_PROVIDER,
        model: null,
        input: {
          inputFileId: group.sourceFileId,
          sourceFileId: group.sourceFileId,
          workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
          workflowTemplateKey: AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
          workflowInputNodeId: AI_IMAGE_TO_PLY_INPUT_NODE_ID,
          workflowInputFieldName: AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
          outputFileType: AI_IMAGE_TO_PLY_OUTPUT_FILE_TYPE,
        },
      })),
    };
  },
  mapValidationError: mapAIImageToPlyValidationError,
};
