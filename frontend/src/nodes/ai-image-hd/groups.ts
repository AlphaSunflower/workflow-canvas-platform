import type { AINodeData } from '@/types';
import type {
  NodeConnectionValidationContext,
  NodeDefinition,
  NodeValidationResult,
} from '../types';
import {
  buildFixedGroups,
  parseGroupPortHandle,
  validateGroupedSingleInput,
} from '../shared/connection';
import {
  AI_IMAGE_HD_INPUT_LIMIT_PER_GROUP,
  AI_IMAGE_HD_INPUT_PORT_ID,
  AI_IMAGE_HD_MAX_GROUPS,
  AI_IMAGE_HD_MIN_GROUPS,
  AI_IMAGE_HD_RESULT_PORT_ID,
} from './constants';

export {
  AI_IMAGE_HD_INPUT_LIMIT_PER_GROUP,
  AI_IMAGE_HD_INPUT_PORT_ID,
  AI_IMAGE_HD_MAX_GROUPS,
  AI_IMAGE_HD_MIN_GROUPS,
  AI_IMAGE_HD_RESULT_PORT_ID,
} from './constants';

export const aiImageHdInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'dynamic',
  minGroups: AI_IMAGE_HD_MIN_GROUPS,
  maxGroups: AI_IMAGE_HD_MAX_GROUPS,
  ordered: true,
  supportsAdd: true,
  supportsRemove: true,
  handleStyle: 'group-port',
};

export const resolveAIImageHdInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> = (node) => buildFixedGroups(
  node,
  (groupId, label) => ({
    id: groupId,
    label,
    ports: [
      {
        id: AI_IMAGE_HD_INPUT_PORT_ID,
        label: '输入图',
        accepts: ['image'],
        required: true,
        maxConnections: AI_IMAGE_HD_INPUT_LIMIT_PER_GROUP,
      },
      {
        id: AI_IMAGE_HD_RESULT_PORT_ID,
        label: '结果输出',
        accepts: ['image'],
        required: false,
        maxConnections: 1,
      },
    ],
  })
);

export function getAIImageHdGroupInputHandle(groupId: string): string {
  return `${groupId}:${AI_IMAGE_HD_INPUT_PORT_ID}`;
}

export function getAIImageHdGroupOutputHandle(groupId: string): string {
  return `${groupId}:${AI_IMAGE_HD_RESULT_PORT_ID}`;
}

export function validateAIImageHdConnection(
  context: NodeConnectionValidationContext
): NodeValidationResult {
  const parsedHandle = parseGroupPortHandle(context.targetHandle);
  if (!parsedHandle) {
    return {
      valid: false,
      reason: '请连接到具体输入槽。',
    };
  }

  if (parsedHandle.portId !== AI_IMAGE_HD_INPUT_PORT_ID) {
    return {
      valid: false,
      reason: '请连接到输入图槽位。',
    };
  }

  return validateGroupedSingleInput(
    context,
    resolveAIImageHdInputGroups(context.targetNode as AINodeData)
  );
}
