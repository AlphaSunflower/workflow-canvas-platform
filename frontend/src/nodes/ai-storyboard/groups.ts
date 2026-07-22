import type { AINodeData, StoryboardShotData } from '@/types';
import type {
  NodeConnectionValidationContext,
  NodeDefinition,
  NodeInputGroupDefinition,
  NodeValidationResult,
} from '../types';
import {
  parseGroupPortHandle,
  validateDefinitionDrivenConnection,
} from '../shared/connection';
import { getGroupInputHandle, getGroupOutputHandle } from '../shared/groups';
import {
  AI_STORYBOARD_INPUT_PORT_ID,
  AI_STORYBOARD_LEGACY_GROUP_ID,
  AI_STORYBOARD_MAX_INPUTS,
  AI_STORYBOARD_MAX_INPUTS_PER_SHOT,
  AI_STORYBOARD_RESULT_PORT_ID,
} from './constants';

export {
  AI_STORYBOARD_INPUT_PORT_ID,
  AI_STORYBOARD_LEGACY_GROUP_ID,
  AI_STORYBOARD_MAX_INPUTS,
  AI_STORYBOARD_MAX_INPUTS_PER_SHOT,
  AI_STORYBOARD_RESULT_PORT_ID,
} from './constants';

export const aiStoryboardInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'dynamic',
  minGroups: 0,
  maxGroups: AI_STORYBOARD_MAX_INPUTS,
  ordered: true,
  supportsAdd: false,
  supportsRemove: false,
  handleStyle: 'group-port',
};

function createShotInputGroup(shotId: string, label: string): NodeInputGroupDefinition {
  return {
    id: shotId,
    label,
    ports: [
      {
        id: AI_STORYBOARD_INPUT_PORT_ID,
        label: '参考图片',
        accepts: ['image'],
        required: false,
        maxConnections: AI_STORYBOARD_MAX_INPUTS_PER_SHOT,
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
  };
}

function createLegacyInputGroup(): NodeInputGroupDefinition {
  return {
    id: AI_STORYBOARD_LEGACY_GROUP_ID,
    label: '图片分镜 (Legacy)',
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
  };
}

function getStoryboardShots(node: AINodeData): StoryboardShotData[] {
  return Array.isArray(node.config.shots) ? node.config.shots : [];
}

export const resolveAIStoryboardInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> = (node) => {
  const shots = getStoryboardShots(node as AINodeData);
  const groups: NodeInputGroupDefinition[] = [createLegacyInputGroup()];

  for (const shot of shots) {
    const label = `Shot ${shot.order}`;
    groups.push(createShotInputGroup(shot.id, label));
  }

  return groups;
};

export function getAIStoryboardInputHandle(groupId: string): string {
  return getGroupInputHandle(groupId, AI_STORYBOARD_INPUT_PORT_ID);
}

export function getAIStoryboardOutputHandle(groupId: string): string {
  return getGroupOutputHandle(groupId, AI_STORYBOARD_RESULT_PORT_ID);
}

export function getAIStoryboardShotOutputHandle(shotId: string): string {
  return getAIStoryboardOutputHandle(shotId);
}

export function isStoryboardShotGroupId(groupId: string): boolean {
  return groupId.startsWith('storyboard-shot-') || groupId === AI_STORYBOARD_LEGACY_GROUP_ID;
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

  const shots = getStoryboardShots(context.targetNode as AINodeData);
  const isValidGroup = parsedHandle.groupId === AI_STORYBOARD_LEGACY_GROUP_ID
    || shots.some((shot) => shot.id === parsedHandle.groupId);

  if (!isValidGroup) {
    return {
      valid: false,
      reason: '请连接到有效的分镜输入槽。',
    };
  }

  return validateDefinitionDrivenConnection(
    context,
    resolveAIStoryboardInputGroups(context.targetNode as AINodeData)
  );
}
