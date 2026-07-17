import type { UUID } from './base.types';

export type WorkflowPersistenceState =
  | 'draft'
  | 'creating'
  | 'persisted';

export interface WorkflowManagerGroupSummary {
  groupId: UUID;
  ownerUserId: UUID;
  name: string;
  workflowCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowManagerItem {
  workflowId: UUID;
  projectId: UUID;
  ownerUserId: UUID;
  name: string;
  groupId: UUID | null;
  containerKey: string;
  isAutoNamed: boolean;
  nodeCount: number;
  connectionCount: number;
  timestamp: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  persistenceState: WorkflowPersistenceState;
}

export interface WorkflowManagerList {
  items: WorkflowManagerItem[];
  groups: WorkflowManagerGroupSummary[];
  total: number;
}
