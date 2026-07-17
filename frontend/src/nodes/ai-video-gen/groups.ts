import type { AINodeData } from '@/types';
import type {
  NodeConnectionValidationContext,
  NodeDefinition,
} from '../types';
import {
  buildFixedGroups,
  validateDefinitionDrivenConnection,
} from '../shared/connection';
import { getGroupInputHandle, getGroupOutputHandle } from '../shared/groups';

export const AI_VIDEO_GEN_INPUT_PORT_ID = 'images';
export const AI_VIDEO_GEN_RESULT_PORT_ID = 'result';
export const AI_VIDEO_GEN_MIN_GROUPS = 1;
export const AI_VIDEO_GEN_MAX_GROUPS = 10;
export const AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP = 2;

export const aiVideoGenInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'dynamic',
  minGroups: AI_VIDEO_GEN_MIN_GROUPS,
  maxGroups: AI_VIDEO_GEN_MAX_GROUPS,
  ordered: true,
  supportsAdd: true,
  supportsRemove: true,
  handleStyle: 'group-port',
};

export const resolveAIVideoGenInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> = (node) => buildFixedGroups(
  node,
  (groupId, label) => ({
    id: groupId,
    label,
    ports: [
      {
        id: AI_VIDEO_GEN_INPUT_PORT_ID,
        label: 'Reference images',
        accepts: ['image'],
        required: true,
        maxConnections: AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP,
        orderMode: 'ordered',
      },
      {
        id: AI_VIDEO_GEN_RESULT_PORT_ID,
        label: 'Video result',
        accepts: ['video'],
        required: false,
        maxConnections: 1,
      },
    ],
  })
);

export function getAIVideoGenGroupInputHandle(groupId: string): string {
  return getGroupInputHandle(groupId, AI_VIDEO_GEN_INPUT_PORT_ID);
}

export function getAIVideoGenGroupOutputHandle(groupId: string): string {
  return getGroupOutputHandle(groupId, AI_VIDEO_GEN_RESULT_PORT_ID);
}

export function validateAIVideoGenConnection(
  context: NodeConnectionValidationContext
): ReturnType<typeof validateDefinitionDrivenConnection> {
  return validateDefinitionDrivenConnection(
    context,
    resolveAIVideoGenInputGroups(context.targetNode as AINodeData)
  );
}
