import {
  AI_MULTI_VIEW_RESTORE_EXECUTION_MODE,
  AI_MULTI_VIEW_RESTORE_NODE_TYPE,
  AI_MULTI_VIEW_RESTORE_OUTPUT_FILE_TYPE,
  AI_MULTI_VIEW_RESTORE_OUTPUT_NODE_ID,
  AI_MULTI_VIEW_RESTORE_PROVIDER,
  AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_NODE_ID,
  AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_FIELD_NAME,
  AI_MULTI_VIEW_RESTORE_TASK_TYPE,
  AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
  AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
  AI_MULTI_VIEW_RESTORE_RENDER_INPUT_NODE_ID,
  AI_MULTI_VIEW_RESTORE_RENDER_INPUT_FIELD_NAME,
  EXECUTION_MODES,
  NODE_TASK_TYPES,
} from "@newworkflow/backend-shared";
import type {
  AIMultiViewRestoreCreateExecutionRequest,
  AIMultiViewRestoreExecutionGroup,
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

function validateGroup(group: AIMultiViewRestoreExecutionGroup, index: number): void {
  if (!group.groupId?.trim()) {
    throw new Error(`INVALID_GROUP_ID:${index}`);
  }

  if (!group.renderFileId?.trim()) {
    throw new Error(`INVALID_RENDER_FILE_ID:${index}`);
  }

  if (!group.referenceFileId?.trim()) {
    throw new Error(`INVALID_REFERENCE_FILE_ID:${index}`);
  }

  if (group.renderFileId.trim() === group.referenceFileId.trim()) {
    throw new Error(`DUPLICATE_GROUP_INPUT_FILE:${index}`);
  }
}

function mapAIMultiViewRestoreValidationError(
  error: string,
): CreateExecutionErrorMapping | null {
  if (error.startsWith("INVALID_GROUP_ID:")) {
    return { code: 40031, message: "groupId 不能为空。" };
  }

  if (error.startsWith("INVALID_RENDER_FILE_ID:")) {
    return { code: 40039, message: "每个 group 必须提供渲染图 fileId。" };
  }

  if (error.startsWith("INVALID_REFERENCE_FILE_ID:")) {
    return { code: 40040, message: "每个 group 必须提供原视角参考图 fileId。" };
  }

  if (error.startsWith("DUPLICATE_GROUP_INPUT_FILE:")) {
    return { code: 40041, message: "同组渲染图与原视角参考图不能为同一文件。" };
  }

  return null;
}

export const aiMultiViewRestoreExecutionNode:
ExecutionNodeDefinition<AIMultiViewRestoreCreateExecutionRequest> = {
  nodeType: AI_MULTI_VIEW_RESTORE_NODE_TYPE,
  validateRequest(input: unknown): AIMultiViewRestoreCreateExecutionRequest {
    if (!isRecord(input)) {
      throw new Error("INVALID_BODY");
    }

    const request = input as unknown as AIMultiViewRestoreCreateExecutionRequest;

    if (request.nodeType !== AI_MULTI_VIEW_RESTORE_NODE_TYPE) {
      throw new Error("INVALID_NODE_TYPE");
    }

    if (request.taskType !== AI_MULTI_VIEW_RESTORE_TASK_TYPE) {
      throw new Error("INVALID_TASK_TYPE");
    }

    if (
      request.taskType !== NODE_TASK_TYPES.aiMultiViewRestore
      || request.executionMode !== AI_MULTI_VIEW_RESTORE_EXECUTION_MODE
      || request.executionMode !== EXECUTION_MODES.legacyGroupedTask
    ) {
      throw new Error(
        request.executionMode !== AI_MULTI_VIEW_RESTORE_EXECUTION_MODE
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
        renderFileId: group.renderFileId.trim(),
        referenceFileId: group.referenceFileId.trim(),
      })),
    };
  },
  collectFileIds(input) {
    return input.groups.flatMap((group) => [
      group.renderFileId,
      group.referenceFileId,
    ]);
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
        provider: AI_MULTI_VIEW_RESTORE_PROVIDER,
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
        provider: AI_MULTI_VIEW_RESTORE_PROVIDER,
        model: null,
        input: {
          renderFileId: group.renderFileId,
          referenceFileId: group.referenceFileId,
          workflowId: AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
          workflowTemplateKey: AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
          renderInputNodeId: AI_MULTI_VIEW_RESTORE_RENDER_INPUT_NODE_ID,
          renderInputFieldName: AI_MULTI_VIEW_RESTORE_RENDER_INPUT_FIELD_NAME,
          referenceInputNodeId: AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_NODE_ID,
          referenceInputFieldName: AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_FIELD_NAME,
          outputNodeId: AI_MULTI_VIEW_RESTORE_OUTPUT_NODE_ID,
          outputFileType: AI_MULTI_VIEW_RESTORE_OUTPUT_FILE_TYPE,
        },
      })),
    };
  },
  mapValidationError: mapAIMultiViewRestoreValidationError,
};
