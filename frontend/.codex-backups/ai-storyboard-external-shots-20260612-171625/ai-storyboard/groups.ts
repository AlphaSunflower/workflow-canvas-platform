import type { AINodeData } from '@/types';
import type {
  NodeConnectionValidationContext,
  NodeDefinition,
  NodeValidationResult,
} from '../types';
import {
  buildFixedGroups,
  parseGroupPortHandle,
  validateDefinitionDrivenConnection,
} from '../shared/connection';
import { getGroupInputHandle, getGroupOutputHandle } from '../shared/groups';
import {
  AI_STORYBOARD_INPUT_PORT_ID,
  AI_STORYBOARD_MAX_GROUPS,
  AI_STORYBOARD_MAX_INPUTS,
  AI_STORYBOARD_MIN_GROUPS,
  AI_STORYBOARD_RESULT_PORT_ID,
} from './constants';

export {
  AI_STORYBOARD_INPUT_PORT_ID,
  AI_STORYBOARD_MAX_GROUPS,
  AI_STORYBOARD_MAX_INPUTS,
  AI_STORYBOARD_MIN_GROUPS,
  AI_STORYBOARD_RESULT_PORT_ID,
} from './constants';

export const aiStoryboardInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'fixed',
  minGroups: AI_STORYBOARD_MIN_GROUPS,
  maxGroups: AI_STORYBOARD_MAX_GROUPS,
  ordered: true,
  supportsAdd: false,
  supportsRemove: false,
  handleStyle: 'group-port',
};

export const resolveAIStoryboardInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> = (node) => buildFixedGroups(
  node,
  (groupId, label) => ({
    id: groupId,
    label,
    ports: [
      {
        id: AI_STORYBOARD_INPUT_PORT_ID,
        label: '图片分镜',
        accepts: ['image'],
        required: false,
        maxConnections: AI_STORYBOARD_MAX_INPUTS,
        orderMode: 'ordered',
      },
      {
        id: AI_STORYBOARD_RESULT_PORT_ID,
        label: '分镜输出',
        accepts: ['image', 'video'],
        required: false,
        maxConnections: AI_STORYBOARD_MAX_INPUTS,
      },
    ],
  })
);

export function getAIStoryboardInputHandle(groupId: string): string {
  return getGroupInputHandle(groupId, AI_STORYBOARD_INPUT_PORT_ID);
}

export function getAIStoryboardOutputHandle(groupId: string): string {
  return getGroupOutputHandle(groupId, AI_STORYBOARD_RESULT_PORT_ID);
}

export function validateAIStoryboardConnection(
  context: NodeConnectionValidationContext
): NodeValidationResult {
  const parsedHandle = parseGroupPortHandle(context.targetHandle);
  if (!parsedHandle) {
    return {
      valid: false,
      reason: '请连接到分镜图片输入槽。',
    };
  }

  if (parsedHandle.portId !== AI_STORYBOARD_INPUT_PORT_ID) {
    return {
      valid: false,
      reason: '请连接到分镜图片输入槽。',
    };
  }

  return validateDefinitionDrivenConnection(
    context,
    resolveAIStoryboardInputGroups(context.targetNode as AINodeData)
  );
}
