import type {
  WorkflowDetailResponseData,
  WorkflowGroupSummaryItem,
  WorkflowSummaryItem,
} from "@newworkflow/backend-shared/api";
import type { StoredWorkflowDocument } from "./workflow-storage.types.ts";

function countObjectKeys(input: unknown): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return 0;
  }

  return Object.keys(input as Record<string, unknown>).length;
}

export class WorkflowSummaryMapper {
  fromDocument(document: StoredWorkflowDocument): WorkflowSummaryItem {
    return {
      workflowId: document.workflowId,
      projectId: document.workflow.projectId,
      ownerUserId: document.ownerUserId,
      name: document.workflow.name,
      groupId: document.groupId,
      containerKey: document.containerKey,
      isAutoNamed: document.isAutoNamed,
      nodeCount: countObjectKeys(document.workflow.nodes),
      connectionCount: Array.isArray(document.workflow.connections)
        ? document.workflow.connections.length
        : 0,
      timestamp: document.workflow.timestamp,
      version: document.workflow.version ?? 1,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  fromDetail(detail: WorkflowDetailResponseData): WorkflowSummaryItem {
    return {
      workflowId: detail.workflowId,
      projectId: detail.workflow.projectId,
      ownerUserId: detail.ownerUserId,
      name: detail.workflow.name,
      groupId: detail.groupId,
      containerKey: detail.containerKey,
      isAutoNamed: detail.isAutoNamed,
      nodeCount: Object.keys(detail.workflow.nodes).length,
      connectionCount: detail.workflow.connections.length,
      timestamp: detail.workflow.timestamp,
      version: detail.workflow.version ?? 1,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  }

  applyGroupWorkflowCounts(
    groups: WorkflowGroupSummaryItem[],
    items: WorkflowSummaryItem[],
  ): WorkflowGroupSummaryItem[] {
    const workflowCounts = new Map<string, number>();

    for (const item of items) {
      if (!item.groupId) {
        continue;
      }

      workflowCounts.set(item.groupId, (workflowCounts.get(item.groupId) ?? 0) + 1);
    }

    return groups.map((group) => ({
      ...group,
      workflowCount: workflowCounts.get(group.groupId) ?? 0,
    }));
  }

  collectWorkflowPeerNames(
    items: WorkflowSummaryItem[],
    excludedWorkflowId?: string,
  ): string[] {
    return items
      .filter((item) => item.workflowId !== excludedWorkflowId)
      .map((item) => item.name);
  }

  collectGroupPeerNames(
    groups: WorkflowGroupSummaryItem[],
    excludedGroupId?: string,
  ): string[] {
    return groups
      .filter((group) => group.groupId !== excludedGroupId)
      .map((group) => group.name);
  }
}

