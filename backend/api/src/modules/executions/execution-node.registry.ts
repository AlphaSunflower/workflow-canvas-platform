import type { CreateExecutionRequest } from "@newworkflow/backend-shared/api";
import type { CreateExecutionStoreInput } from "./executions.repository.ts";
import type {
  CreateExecutionErrorMapping,
  ExecutionNodeDefinition,
} from "./execution-node.types.ts";
import { aiFloorplanColorizeExecutionNode } from "./nodes/ai-floorplan-colorize.node.ts";
import { aiImageGenExecutionNode } from "./nodes/ai-image-gen.node.ts";
import { aiImageHdExecutionNode } from "./nodes/ai-image-hd.node.ts";
import { aiImageInpaintExecutionNode } from "./nodes/ai-image-inpaint.node.ts";
import { aiMultiViewRestoreExecutionNode } from "./nodes/ai-multi-view-restore.node.ts";
import { aiImageToPlyExecutionNode } from "./nodes/ai-image-to-ply.node.ts";
import { aiVideoGenExecutionNode } from "./nodes/ai-video-gen.node.ts";
import { whiteModelRenderExecutionNode } from "./nodes/white-model-render.node.ts";

const executionNodeDefinitions: ExecutionNodeDefinition[] = [
  whiteModelRenderExecutionNode,
  aiImageGenExecutionNode,
  aiImageInpaintExecutionNode,
  aiImageHdExecutionNode,
  aiFloorplanColorizeExecutionNode,
  aiMultiViewRestoreExecutionNode,
  aiImageToPlyExecutionNode,
  aiVideoGenExecutionNode,
];

const executionNodeDefinitionMap = new Map(
  executionNodeDefinitions.map((definition) => [definition.nodeType, definition]),
);

executionNodeDefinitionMap.set("aiStoryboard", aiImageGenExecutionNode as ExecutionNodeDefinition);

function getNodeType(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const nodeType = (input as { nodeType?: unknown }).nodeType;
  return typeof nodeType === "string" && nodeType.trim().length > 0
    ? nodeType.trim()
    : null;
}

function getTaskType(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const taskType = (input as { taskType?: unknown }).taskType;
  return typeof taskType === "string" && taskType.trim().length > 0
    ? taskType.trim()
    : null;
}

export function getExecutionNodeDefinition(
  nodeType: string,
  taskType?: string | null,
): ExecutionNodeDefinition | null {
  if (nodeType === "aiStoryboard" && taskType === "video-gen") {
    return aiVideoGenExecutionNode as ExecutionNodeDefinition;
  }

  return executionNodeDefinitionMap.get(
    nodeType as CreateExecutionRequest["nodeType"],
  ) ?? null;
}

export function validateExecutionCreateRequest(
  input: unknown,
): CreateExecutionRequest {
  const nodeType = getNodeType(input);
  const taskType = getTaskType(input);

  if (!nodeType) {
    throw new Error("INVALID_NODE_TYPE");
  }

  const definition = getExecutionNodeDefinition(nodeType, taskType);

  if (!definition) {
    throw new Error("INVALID_NODE_TYPE");
  }

  return definition.validateRequest(input);
}

export function collectExecutionInputFileIds(
  input: CreateExecutionRequest,
): string[] {
  const definition = getExecutionNodeDefinition(input.nodeType, input.taskType);

  if (!definition) {
    throw new Error("INVALID_NODE_TYPE");
  }

  return definition.collectFileIds(input);
}

export function buildCreateExecutionStoreInput(
  input: CreateExecutionRequest,
): CreateExecutionStoreInput {
  const definition = getExecutionNodeDefinition(input.nodeType, input.taskType);

  if (!definition) {
    throw new Error("INVALID_NODE_TYPE");
  }

  return definition.buildCreateExecutionStoreInput(input);
}

export function mapCreateExecutionError(
  error: string,
): CreateExecutionErrorMapping | null {
  if (error === "INVALID_BODY") {
    return { code: 40030, message: "请求体必须为 JSON 对象。" };
  }

  if (error === "INVALID_NODE_TYPE") {
    return { code: 40034, message: "当前节点类型尚未接入后端执行。" };
  }

  if (error === "INVALID_TASK_TYPE") {
    return { code: 40035, message: "taskType 与 nodeType 不匹配。" };
  }

  if (error === "INVALID_EXECUTION_MODE") {
    return { code: 40036, message: "executionMode 与 nodeType 不匹配。" };
  }

  if (error === "INVALID_GROUPS") {
    return { code: 40037, message: "groups 至少包含一组输入。" };
  }

  if (error.startsWith("FILE_NOT_FOUND:")) {
    return { code: 40431, message: "存在无效或未完成上传的 fileId。" };
  }

  if (error === "INVALID_WORKFLOW_ID") {
    return { code: 40044, message: "workflowId 不能为空。" };
  }

  for (const definition of executionNodeDefinitions) {
    const mapped = definition.mapValidationError?.(error);

    if (mapped) {
      return mapped;
    }
  }

  return null;
}
