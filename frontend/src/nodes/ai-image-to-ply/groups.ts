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

export const AI_IMAGE_TO_PLY_INPUT_PORT_ID = 'image';
export const AI_IMAGE_TO_PLY_RESULT_PORT_ID = 'result';
export const AI_IMAGE_TO_PLY_MIN_GROUPS = 1;
export const AI_IMAGE_TO_PLY_MAX_GROUPS = 10;

export const aiImageToPlyInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'dynamic',
  minGroups: AI_IMAGE_TO_PLY_MIN_GROUPS,
  maxGroups: AI_IMAGE_TO_PLY_MAX_GROUPS,
  ordered: true,
  supportsAdd: true,
  supportsRemove: true,
  handleStyle: 'group-port',
};

export const resolveAIImageToPlyInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> = (node) => buildFixedGroups(
  node,
  (groupId, label) => ({
    id: groupId,
    label,
    ports: [
      {
        id: AI_IMAGE_TO_PLY_INPUT_PORT_ID,
        label: '输入图',
        accepts: ['image'],
        required: true,
        maxConnections: 1,
      },
      {
        id: AI_IMAGE_TO_PLY_RESULT_PORT_ID,
        label: 'PLY 输出',
        accepts: ['ply'],
        required: false,
        maxConnections: 1,
      },
    ],
  })
);

export function getAIImageToPlyGroupInputHandle(groupId: string): string {
  return `${groupId}:${AI_IMAGE_TO_PLY_INPUT_PORT_ID}`;
}

export function getAIImageToPlyGroupOutputHandle(groupId: string): string {
  return `${groupId}:${AI_IMAGE_TO_PLY_RESULT_PORT_ID}`;
}

export function validateAIImageToPlyConnection(
  context: NodeConnectionValidationContext
): NodeValidationResult {
  const parsedHandle = parseGroupPortHandle(context.targetHandle);
  if (!parsedHandle) {
    return {
      valid: false,
      reason: '请连接到具体输入槽。',
    };
  }

  if (parsedHandle.portId !== AI_IMAGE_TO_PLY_INPUT_PORT_ID) {
    return {
      valid: false,
      reason: '请连接到输入图槽位。',
    };
  }

  return validateGroupedSingleInput(
    context,
    resolveAIImageToPlyInputGroups(context.targetNode as AINodeData)
  );
}
