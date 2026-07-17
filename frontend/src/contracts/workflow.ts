import type {
  AIImageInputGroup,
  AINodeData,
  AnyNodeData,
  Connection,
  FileNodeData,
  Viewport,
  Workflow,
  WorkflowMetadata,
} from '@/types';

export interface WorkflowConnectionInput {
  connection: Connection;
  sourceNode: AnyNodeData;
  targetNode: AnyNodeData;
}

export interface WorkflowNodeGroupInput {
  groupId: string;
  connection: Connection;
  sourceNode: FileNodeData;
}

export interface WorkflowNodeGroupPortInput {
  groupId: string;
  portId: string;
  handle: string;
  connection: Connection;
  sourceNode: FileNodeData;
}

export interface WorkflowNodeGroupPortState {
  portId: string;
  label: string;
  handle: string;
  inputs: WorkflowNodeGroupPortInput[];
}

export interface WorkflowResolvedNodeGroupState {
  group: AIImageInputGroup;
  ports: WorkflowNodeGroupPortState[];
}

export interface WorkflowNodeGroupState {
  group: AIImageInputGroup;
  inputs: WorkflowNodeGroupInput[];
}

export interface WorkflowRuntimeSnapshot {
  nodes: Record<string, AnyNodeData>;
  connections: Connection[];
  viewport: Viewport;
  metadata?: Partial<WorkflowMetadata>;
  snapshotMeta?: WorkflowRuntimeSnapshotMeta;
}

export type WorkflowRuntimeSnapshotSource =
  | 'workflow-load'
  | 'canvas-edit'
  | 'external-output'
  | 'execution-reconcile'
  | 'unknown';

export type WorkflowRuntimeSnapshotScope =
  | 'full-replace'
  | 'output-append'
  | 'output-reconcile'
  | 'canvas-sync'
  | 'unknown';

export interface WorkflowRuntimeSnapshotMeta {
  /**
   * Snapshot producer identity.
   * - `canvas-edit` is reserved for Canvas-owned structural synchronization.
   * - `external-output` is reserved for execution output append/refresh writes.
   * - `execution-reconcile` is reserved for historical output reconcile writes.
   */
  source?: WorkflowRuntimeSnapshotSource;
  /**
   * Snapshot application boundary.
   * - `canvas-sync` may reconcile canvas structure and node layout.
   * - `output-append` may only append or refresh output-related runtime data.
   * - `output-reconcile` may only restore missing output-related runtime data.
   */
  scope?: WorkflowRuntimeSnapshotScope;
  baseUpdatedAt?: number;
  baseNodeCount?: number;
  baseConnectionCount?: number;
  sourceNodeId?: string;
  affectedNodeIds?: string[];
  allowNodeShrink?: boolean;
}

export type WorkflowHydrationReason =
  | 'external-output'
  | 'workflow-load'
  | 'canvas-reset';

export interface WorkflowRuntimeSyncOptions {
  hydrateCanvas?: boolean;
  hydrationReason?: WorkflowHydrationReason;
  runtimeSnapshotMeta?: WorkflowRuntimeSnapshotMeta;
}

export interface WorkflowHydrationState {
  version: number;
  reason: WorkflowHydrationReason | null;
}

export interface WorkflowExecutionAdapterInputContext {
  workflowId?: string | null;
  workflow: Workflow;
  node: AINodeData;
  nodeTitle: string;
  inputs: WorkflowConnectionInput[];
  resolvedInputGroups: WorkflowResolvedNodeGroupState[];
}
