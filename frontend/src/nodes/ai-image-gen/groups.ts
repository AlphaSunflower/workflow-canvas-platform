import type { AINodeData } from '@/types';
import type { NodeConnectionValidationContext, NodeDefinition } from '../types';
import { buildFixedGroups, validateDefinitionDrivenConnection } from '../shared/connection';
import { getGroupInputHandle, getGroupOutputHandle } from '../shared/groups';

export const AI_IMAGE_INPUT_PORT_ID = 'images';
export const AI_IMAGE_RESULT_PORT_ID = 'result';
export const AI_IMAGE_GEN_MIN_GROUPS = 1;
export const AI_IMAGE_GEN_MAX_GROUPS = 10;
export const AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP = 5;

export const aiImageGenInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'dynamic',
  minGroups: AI_IMAGE_GEN_MIN_GROUPS,
  maxGroups: AI_IMAGE_GEN_MAX_GROUPS,
  ordered: true,
  supportsAdd: true,
  supportsRemove: true,
  handleStyle: 'group-port',
};

export const resolveAIImageGenInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> = (node) => buildFixedGroups(
  node,
  (groupId, label) => ({
    id: groupId,
    label,
    ports: [
      {
        id: AI_IMAGE_INPUT_PORT_ID,
        label: '图片序列',
        accepts: ['image'],
        required: false,
        maxConnections: AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP,
        orderMode: 'ordered',
      },
      {
        id: AI_IMAGE_RESULT_PORT_ID,
        label: '结果输出',
        accepts: ['image'],
        required: false,
        maxConnections: 1,
      },
    ],
  })
);

export function getAIImageGenGroupInputHandle(groupId: string): string {
  return getGroupInputHandle(groupId, AI_IMAGE_INPUT_PORT_ID);
}

export function getAIImageGenGroupOutputHandle(groupId: string): string {
  return getGroupOutputHandle(groupId, AI_IMAGE_RESULT_PORT_ID);
}

export function validateAIImageGenConnection(
  context: NodeConnectionValidationContext,
): ReturnType<typeof validateDefinitionDrivenConnection> {
  return validateDefinitionDrivenConnection(
    context,
    resolveAIImageGenInputGroups(context.targetNode as AINodeData)
  );
}
