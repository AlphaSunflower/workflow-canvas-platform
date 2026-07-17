import { workflowApi } from '@/api';
import type {
  UUID,
  Workflow,
  WorkflowManagerGroupSummary,
  WorkflowManagerItem,
  WorkflowManagerList,
} from '@/types';

export interface WorkflowManagerGroupSection {
  group: WorkflowManagerGroupSummary | null;
  items: WorkflowManagerItem[];
}

export const UNGROUPED_CONTAINER_LABEL = '\u672a\u5206\u7ec4';
export const CURRENT_WORKFLOW_LABEL = '\u5f53\u524d';
export const AUTO_NAMED_LABEL = '\u81ea\u52a8\u547d\u540d';

export function formatWorkflowManagerTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

export function buildWorkflowManagerSections(list: WorkflowManagerList): WorkflowManagerGroupSection[] {
  const groupedItemMap = new Map<string, WorkflowManagerItem[]>();
  const ungroupedItems: WorkflowManagerItem[] = [];

  list.items.forEach((item) => {
    if (!item.groupId) {
      ungroupedItems.push(item);
      return;
    }

    const groupItems = groupedItemMap.get(item.groupId) ?? [];
    groupItems.push(item);
    groupedItemMap.set(item.groupId, groupItems);
  });

  const sections: WorkflowManagerGroupSection[] = [{
    group: null,
    items: ungroupedItems
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt),
  }];

  const sortedGroups = list.groups
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));

  sortedGroups.forEach((group) => {
    sections.push({
      group,
      items: (groupedItemMap.get(group.groupId) ?? [])
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt),
    });
  });

  return sections;
}

export function getWorkflowGroupLabel(group: WorkflowManagerGroupSummary | null): string {
  return group?.name ?? UNGROUPED_CONTAINER_LABEL;
}

export function getWorkflowSummaryText(item: WorkflowManagerItem): string {
  return `${item.nodeCount} \u8282\u70b9 / ${item.connectionCount} \u8fde\u7ebf`;
}

export async function loadManagedWorkflowById(workflowId: UUID): Promise<Workflow> {
  const result = await workflowApi.getById(workflowId);
  if (!result.success) {
    throw result.error;
  }

  return result.data;
}
