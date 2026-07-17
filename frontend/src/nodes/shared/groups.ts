import type { AIConfig, AIImageInputGroup, AINodeData } from '@/types';
import { createAIImageInputGroup, ensureAIImageInputGroups } from '@/utils/node';
import { createGroupPortHandle } from './connection';

export interface GroupReorderOptions {
  renameLabels?: boolean;
}

export function getConfiguredInputGroups(
  config: AIConfig | undefined
): AIImageInputGroup[] {
  return sortInputGroups(ensureAIImageInputGroups(config));
}

export function getNextInputGroupId(groups: Pick<AIImageInputGroup, 'id'>[]): string {
  const nextNumericId = groups.reduce((maxValue, group) => {
    const match = /^group-(\d+)$/.exec(group.id);
    if (!match) {
      return maxValue;
    }

    return Math.max(maxValue, Number.parseInt(match[1], 10));
  }, 0) + 1;

  return `group-${nextNumericId}`;
}

export function sortInputGroups(groups: AIImageInputGroup[]): AIImageInputGroup[] {
  return groups
    .slice()
    .sort((left, right) => left.order - right.order);
}

export function reorderInputGroups(
  groups: AIImageInputGroup[],
  options: GroupReorderOptions = {}
): AIImageInputGroup[] {
  const { renameLabels = true } = options;

  return sortInputGroups(groups).map((group, index) => ({
    ...group,
    order: index,
    label: renameLabels ? `Group ${index + 1}` : group.label,
  }));
}

export function createAppendedInputGroups(
  config: AIConfig | undefined,
  count: number = 1
): AIImageInputGroup[] {
  return appendInputGroups(getConfiguredInputGroups(config), count);
}

export function appendInputGroups(
  groups: AIImageInputGroup[],
  count: number = 1
): AIImageInputGroup[] {
  const nextGroups = [...groups];

  for (let index = 0; index < Math.max(0, count); index += 1) {
    nextGroups.push({
      ...createAIImageInputGroup(nextGroups.length),
      id: getNextInputGroupId(nextGroups),
      label: `Group ${nextGroups.length + 1}`,
      order: nextGroups.length,
    });
  }

  return reorderInputGroups(nextGroups);
}

export function removeInputGroupAndReorder(
  groups: AIImageInputGroup[],
  groupId: string
): AIImageInputGroup[] {
  return reorderInputGroups(
    groups.filter((group) => group.id !== groupId)
  );
}

export function updateNodeInputGroups(
  node: AINodeData,
  groups: AIImageInputGroup[]
): AINodeData {
  return {
    ...node,
    config: {
      ...node.config,
      inputGroups: reorderInputGroups(groups),
    },
    timestamp: {
      ...node.timestamp,
      updated: Date.now(),
    },
  };
}

export function getGroupInputHandle(groupId: string, portId: string = 'images'): string {
  return createGroupPortHandle(groupId, portId);
}

export function getGroupOutputHandle(groupId: string, portId: string = 'result'): string {
  return createGroupPortHandle(groupId, portId);
}
