export interface WorkflowViewport {
  x: number;
  y: number;
  zoom: number;
}

export type WorkflowContainerKey = string;
export type WorkflowPersistenceState = "draft" | "materializing" | "persisted";

export interface WorkflowPayload {
  id?: string;
  projectId: string;
  name: string;
  nodes: Record<string, unknown>;
  connections: unknown[];
  viewport: WorkflowViewport;
  metadata: Record<string, unknown>;
  timestamp: number;
  version?: number;
}

export interface WorkflowSummaryItem {
  workflowId: string;
  projectId: string;
  ownerUserId: string;
  name: string;
  groupId: string | null;
  containerKey: WorkflowContainerKey;
  isAutoNamed: boolean;
  nodeCount: number;
  connectionCount: number;
  timestamp: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowGroupSummaryItem {
  groupId: string;
  ownerUserId: string;
  name: string;
  workflowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDetailResponseData {
  workflowId: string;
  ownerUserId: string;
  groupId: string | null;
  containerKey: WorkflowContainerKey;
  isAutoNamed: boolean;
  workflow: WorkflowPayload;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowListResponseData {
  items: WorkflowSummaryItem[];
  groups: WorkflowGroupSummaryItem[];
  total: number;
}

export interface CreateBlankWorkflowRequest {
  id?: string;
  projectId?: string;
  name?: string;
  groupId?: string | null;
  viewport?: WorkflowViewport;
  metadata?: Record<string, unknown>;
  timestamp?: number;
  version?: number;
}

export interface RenameWorkflowRequest {
  name: string;
}

export interface MoveWorkflowGroupRequest {
  groupId: string | null;
}

export interface DeleteWorkflowResponseData {
  workflowId: string;
  deleted: true;
}

export interface CreateWorkflowGroupRequest {
  name?: string;
}

export interface RenameWorkflowGroupRequest {
  name: string;
}

export interface DeleteWorkflowGroupResponseData {
  groupId: string;
  movedWorkflowCount: number;
  deleted: true;
}

export interface CreateWorkflowRequest {
  id?: string;
  projectId: string;
  name: string;
  nodes?: Record<string, unknown>;
  connections?: unknown[];
  viewport?: WorkflowViewport;
  metadata?: Record<string, unknown>;
  timestamp?: number;
  version?: number;
}

export interface UpdateWorkflowRequest {
  workflowId?: string;
  projectId: string;
  name: string;
  nodes: Record<string, unknown>;
  connections: unknown[];
  viewport: WorkflowViewport;
  metadata: Record<string, unknown>;
  timestamp: number;
  version?: number;
}

export interface ApiEnvelope<T> {
  code: number;
  message?: string;
  error?: string;
  data?: T;
  timestamp: number;
}
