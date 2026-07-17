import type { AINodeData } from '@/types';
import type {
  NodeConnectionValidationContext,
  NodeDefinition,
  NodeInputGroupDefinition,
  NodeValidationResult,
} from '../types';
import {
  createGroupPortHandle,
  findGroupPort,
  parseGroupPortHandle,
  rejectAINodeInputs,
} from '../shared/connection';
import {
  AI_IMAGE_INPAINT_GROUP_ID,
  AI_IMAGE_INPAINT_GROUP_LABEL,
  AI_IMAGE_INPAINT_INPUT_LABEL,
  AI_IMAGE_INPAINT_INPUT_LIMIT,
  AI_IMAGE_INPAINT_INPUT_PORT_ID,
  AI_IMAGE_INPAINT_RESULT_LABEL,
  AI_IMAGE_INPAINT_RESULT_PORT_ID,
} from './constants';

export {
  AI_IMAGE_INPAINT_GROUP_ID,
  AI_IMAGE_INPAINT_GROUP_LABEL,
  AI_IMAGE_INPAINT_INPUT_LIMIT,
  AI_IMAGE_INPAINT_INPUT_PORT_ID,
  AI_IMAGE_INPAINT_RESULT_PORT_ID,
} from './constants';

export const aiImageInpaintInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'fixed',
  minGroups: 1,
  maxGroups: 1,
  ordered: false,
  supportsAdd: false,
  supportsRemove: false,
  handleStyle: 'group-port',
};

export const aiImageInpaintGroup = {
  id: AI_IMAGE_INPAINT_GROUP_ID,
  label: AI_IMAGE_INPAINT_GROUP_LABEL,
  order: 0,
} as const;

export const resolveAIImageInpaintInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> =
  (): NodeInputGroupDefinition[] => [
    {
      id: AI_IMAGE_INPAINT_GROUP_ID,
      label: AI_IMAGE_INPAINT_GROUP_LABEL,
      ports: [
        {
          id: AI_IMAGE_INPAINT_INPUT_PORT_ID,
          label: AI_IMAGE_INPAINT_INPUT_LABEL,
          accepts: ['image'],
          required: true,
          maxConnections: AI_IMAGE_INPAINT_INPUT_LIMIT,
        },
        {
          id: AI_IMAGE_INPAINT_RESULT_PORT_ID,
          label: AI_IMAGE_INPAINT_RESULT_LABEL,
          accepts: ['image'],
          required: false,
          maxConnections: 1,
        },
      ],
    },
  ];

export function getAIImageInpaintInputHandle(): string {
  return createGroupPortHandle(
    AI_IMAGE_INPAINT_GROUP_ID,
    AI_IMAGE_INPAINT_INPUT_PORT_ID,
  );
}

export function getAIImageInpaintOutputHandle(): string {
  return createGroupPortHandle(
    AI_IMAGE_INPAINT_GROUP_ID,
    AI_IMAGE_INPAINT_RESULT_PORT_ID,
  );
}

export function createAIImageInpaintInputGroup(): AINodeData['config']['inputGroups'] {
  return [{
    id: AI_IMAGE_INPAINT_GROUP_ID,
    label: AI_IMAGE_INPAINT_GROUP_LABEL,
    order: 0,
  }];
}

export function normalizeAIImageInpaintNode(node: AINodeData): AINodeData {
  return {
    ...node,
    config: {
      ...node.config,
      inputGroups: createAIImageInpaintInputGroup(),
    },
  };
}

export function validateAIImageInpaintConnection(
  context: NodeConnectionValidationContext,
): NodeValidationResult {
  const aiCheck = rejectAINodeInputs(context);
  if (!aiCheck.valid) {
    return aiCheck;
  }

  if (context.sourceNode.type !== 'image') {
    return {
      valid: false,
      reason: '图片局部重绘只接受图片输入。',
    };
  }

  const parsedHandle = parseGroupPortHandle(context.targetHandle);
  if (!parsedHandle) {
    return {
      valid: false,
      reason: '请连接到原图输入槽。',
    };
  }

  const inputHandle = getAIImageInpaintInputHandle();
  if (
    parsedHandle.groupId !== AI_IMAGE_INPAINT_GROUP_ID ||
    parsedHandle.portId !== AI_IMAGE_INPAINT_INPUT_PORT_ID ||
    context.targetHandle !== inputHandle
  ) {
    return {
      valid: false,
      reason: '请连接到图片局部重绘的原图输入槽。',
    };
  }

  const resolvedPort = findGroupPort(
    resolveAIImageInpaintInputGroups(context.targetNode as AINodeData),
    inputHandle,
  );
  if (!resolvedPort) {
    return {
      valid: false,
      reason: '原图输入槽不存在。',
    };
  }

  return { valid: true };
}
