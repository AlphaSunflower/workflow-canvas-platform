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
import { getGroupInputHandle, getGroupOutputHandle } from '../shared/groups';
import {
  AI_FLOORPLAN_COLORIZE_INPUT_LABEL,
  AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID,
  AI_FLOORPLAN_COLORIZE_MAX_GROUPS,
  AI_FLOORPLAN_COLORIZE_MIN_GROUPS,
  AI_FLOORPLAN_COLORIZE_RESULT_LABEL,
  AI_FLOORPLAN_COLORIZE_RESULT_PORT_ID,
} from './constants';

export {
  AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID,
  AI_FLOORPLAN_COLORIZE_RESULT_PORT_ID,
} from './constants';

export const aiFloorplanColorizeInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'dynamic',
  minGroups: AI_FLOORPLAN_COLORIZE_MIN_GROUPS,
  maxGroups: AI_FLOORPLAN_COLORIZE_MAX_GROUPS,
  ordered: true,
  supportsAdd: true,
  supportsRemove: true,
  handleStyle: 'group-port',
};

export const resolveAIFloorplanColorizeInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> = (node) => buildFixedGroups(
  node,
  (groupId, label) => ({
    id: groupId,
    label,
    ports: [
      {
        id: AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID,
        label: AI_FLOORPLAN_COLORIZE_INPUT_LABEL,
        accepts: ['image'],
        required: true,
        maxConnections: 1,
      },
      {
        id: AI_FLOORPLAN_COLORIZE_RESULT_PORT_ID,
        label: AI_FLOORPLAN_COLORIZE_RESULT_LABEL,
        accepts: ['image'],
        required: false,
        maxConnections: 1,
      },
    ],
  })
);

export function getAIFloorplanColorizeInputHandle(groupId: string): string {
  return getGroupInputHandle(groupId, AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID);
}

export function getAIFloorplanColorizeOutputHandle(groupId: string): string {
  return getGroupOutputHandle(groupId, AI_FLOORPLAN_COLORIZE_RESULT_PORT_ID);
}

export function validateAIFloorplanColorizeConnection(
  context: NodeConnectionValidationContext
): NodeValidationResult {
  const parsedHandle = parseGroupPortHandle(context.targetHandle);
  if (!parsedHandle) {
    return {
      valid: false,
      reason: '请连接到具体输入槽。',
    };
  }

  if (parsedHandle.portId !== AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID) {
    return {
      valid: false,
      reason: '请连接到输入图槽位。',
    };
  }

  return validateGroupedSingleInput(
    context,
    resolveAIFloorplanColorizeInputGroups(context.targetNode as AINodeData)
  );
}
