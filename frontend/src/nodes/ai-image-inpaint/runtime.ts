import type { WorkflowConnectionInput } from '@/contracts/workflow';
import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import { isFileNodeData } from '@/utils/node';
import { getNodeInputGroupsFromConnections, getPortInputsFromGroups } from '../shared/group-query';
import type {
  GroupedExecutionContext,
  NodeDefinition,
  NodeExecutionGroupPlan,
  NodeExecutionPlan,
  NodeValidationResult,
} from '../types';
import {
  AI_IMAGE_INPAINT_GROUP_ID,
  AI_IMAGE_INPAINT_INPUT_PORT_ID,
  getAIImageInpaintOutputHandle,
  resolveAIImageInpaintInputGroups,
} from './groups';
import {
  AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
  type AIImageInpaintMaskMode,
  normalizeAIImageInpaintNodeConfig,
  normalizeAIImageInpaintMaskMode,
} from './constants';
import { hasInpaintMaskStrokeMarks } from './mask-export';
import { normalizeAIImageInpaintMaskStrokes } from './mask-strokes';

export interface AIImageInpaintBackendGroupPayload {
  groupId: string;
  sourceFileId: string;
  maskFileId: string;
}

export function buildAIImageInpaintBackendGroupPayload(params: {
  groupId: string;
  sourceFileId: string;
  maskFileId: string;
}): AIImageInpaintBackendGroupPayload {
  return {
    groupId: params.groupId,
    sourceFileId: params.sourceFileId,
    maskFileId: params.maskFileId,
  };
}

export function buildAIImageInpaintBackendRequestConfig(config: {
  model?: unknown;
  imageSize?: unknown;
  aspectRatio?: unknown;
  maskMode?: unknown;
}): {
  model: string;
  imageSize?: string;
  aspectRatio?: string;
  maskMode: AIImageInpaintMaskMode;
} {
  const normalizedImageConfig = normalizeAIImageInpaintNodeConfig({
    model: config.model,
    imageSize: config.imageSize,
    aspectRatio: config.aspectRatio,
  });
  const usesParameters = normalizedImageConfig.model !== 'gpt-image-2';

  return {
    model: normalizedImageConfig.model,
    ...(usesParameters
      ? {
          imageSize: normalizedImageConfig.imageSize,
          aspectRatio: normalizedImageConfig.aspectRatio,
        }
      : {}),
    maskMode: normalizeAIImageInpaintMaskMode(
      config.maskMode ?? AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
    ),
  };
}

function isImageFileNode(node: AnyNodeData): node is FileNodeData {
  return isFileNodeData(node) && node.type === 'image';
}

function getNormalizedPrompt(node: AINodeData): string {
  return typeof node.config.prompt === 'string' ? node.config.prompt.trim() : '';
}

function hasRunnableMaskMarks(node: AINodeData): boolean {
  return hasInpaintMaskStrokeMarks(normalizeAIImageInpaintMaskStrokes(node.config.maskStrokes), {
    width: typeof node.config.maskSourceWidth === 'number'
      ? node.config.maskSourceWidth
      : undefined,
    height: typeof node.config.maskSourceHeight === 'number'
      ? node.config.maskSourceHeight
      : undefined,
  });
}

function getSourceImageNode(context: GroupedExecutionContext): FileNodeData | null {
  const groupDefinitions = resolveAIImageInpaintInputGroups(context.node);
  const nodeMap = new Map(
    Object.values(context.workflow.nodes).map((node) => [node.id.value, node]),
  );
  const groupStates = getNodeInputGroupsFromConnections(
    context.node,
    groupDefinitions,
    context.workflow.connections.filter((connection) =>
      connection.type === 'file-reference' &&
      connection.targetId === context.node.id.value
    ),
    nodeMap,
  );

  return getPortInputsFromGroups(
    groupStates,
    AI_IMAGE_INPAINT_GROUP_ID,
    AI_IMAGE_INPAINT_INPUT_PORT_ID,
  )
    .map((input) => input.sourceNode)
    .filter(isImageFileNode)[0] ?? null;
}

function canRunAIImageInpaint(
  node: AINodeData,
  inputs: WorkflowConnectionInput[],
): NodeValidationResult {
  const prompt = getNormalizedPrompt(node);
  if (prompt.length === 0) {
    return {
      valid: false,
      reason: '图片局部重绘的提示词不能为空。',
    };
  }

  const imageInputs = inputs
    .filter((input) =>
      input.connection.type === 'file-reference' &&
      input.connection.targetHandle === `${AI_IMAGE_INPAINT_GROUP_ID}:${AI_IMAGE_INPAINT_INPUT_PORT_ID}`
    )
    .map((input) => input.sourceNode)
    .filter(isImageFileNode);

  if (imageInputs.length === 0) {
    return {
      valid: false,
      reason: '图片局部重绘缺少可用原图，请拖入 1 张原图后执行。',
    };
  }

  if (imageInputs.length !== 1) {
    return {
      valid: false,
      reason: '图片局部重绘需要且只需要 1 张原图输入。',
    };
  }

  if (!hasRunnableMaskMarks(node)) {
    return {
      valid: false,
      reason: '请先用画笔标记需要局部重绘的区域。',
    };
  }

  return { valid: true };
}

function buildAIImageInpaintGroupPlan(
  node: AINodeData,
  sourceNode: FileNodeData,
): NodeExecutionPlan {
  return {
    files: [sourceNode.fileId],
    references: [sourceNode.fileId],
    config: {
      ...node.config,
      ...buildAIImageInpaintBackendRequestConfig(node.config),
      inputGroups: [{
        id: AI_IMAGE_INPAINT_GROUP_ID,
        label: '原图',
        order: 0,
      }],
    },
    prompt: getNormalizedPrompt(node) || undefined,
  };
}

export function buildAIImageInpaintGroupPlans(
  context: GroupedExecutionContext,
): NodeExecutionGroupPlan[] {
  const sourceNode = getSourceImageNode(context);
  if (!sourceNode) {
    return [];
  }

  return [{
    groupId: AI_IMAGE_INPAINT_GROUP_ID,
    groupLabel: '原图',
    order: 0,
    outputHandle: getAIImageInpaintOutputHandle(),
    plan: buildAIImageInpaintGroupPlan(context.node, sourceNode),
  }];
}

export const aiImageInpaintExecution: NodeDefinition['execution'] = {
  mode: 'legacy-grouped-task',
  taskType: 'image-inpaint',
  provider: 'openai',
  canRun: canRunAIImageInpaint,
  buildGroupPlans: buildAIImageInpaintGroupPlans,
};
