import type {
  WorkflowContainerKey,
  WorkflowGroupSummaryItem,
  WorkflowPayload,
  WorkflowSummaryItem,
} from "@newworkflow/backend-shared/api";

export interface WorkflowGroupDocument extends WorkflowGroupSummaryItem {}

export interface WorkflowGroupIndex {
  items: WorkflowGroupDocument[];
}

export interface StoredWorkflowDocument {
  workflowId: string;
  ownerUserId: string;
  groupId: string | null;
  containerKey: WorkflowContainerKey;
  isAutoNamed: boolean;
  workflow: WorkflowPayload;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSummaryIndex {
  items: WorkflowSummaryItem[];
}

export interface WorkflowAccountIndexItem {
  ownerUserId: string;
  workflowIds: string[];
  updatedAt: string;
}

export interface WorkflowAccountIndex {
  items: WorkflowAccountIndexItem[];
}

export const WORKFLOW_UNGROUPED_CONTAINER_KEY = "__ungrouped__";

export function resolveWorkflowContainerKey(groupId: string | null | undefined): WorkflowContainerKey {
  const normalizedGroupId = typeof groupId === "string" ? groupId.trim() : "";
  return normalizedGroupId || WORKFLOW_UNGROUPED_CONTAINER_KEY;
}

export function createEmptyWorkflowSummaryIndex(): WorkflowSummaryIndex {
  return {
    items: [],
  };
}

export function createEmptyWorkflowGroupIndex(): WorkflowGroupIndex {
  return {
    items: [],
  };
}

export function createEmptyWorkflowAccountIndex(): WorkflowAccountIndex {
  return {
    items: [],
  };
}
