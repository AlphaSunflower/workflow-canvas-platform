import type { Position, Timestamp, UUID, RFEdge } from './base.types';
import type { AnyNodeData, NodeReference } from './node.types';
import type { WorkflowRelatedTaskRef } from './snapshot.types';

export interface Workflow {
  id: UUID;
  persistedWorkflowId?: UUID;
  projectId: UUID;
  name: string;
  nodes: Record<string, AnyNodeData>;
  connections: Connection[];
  viewport: Viewport;
  metadata: WorkflowMetadata;
  timestamp: Timestamp;
  version?: number;
  ownerUserId?: UUID;
  groupId?: UUID | null;
  workflowGroupId?: UUID | null;
  containerKey?: string;
  isAutoNamed?: boolean;
  persistenceState?: 'draft' | 'creating' | 'persisted';
  hasMaterializedCanvas?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface Connection {
  id: UUID;
  type: 'file-reference' | 'output-link';
  sourceId: string;
  targetId: string;
  sourceHandle?: string;
  targetHandle?: string;
  order?: number;
  references?: NodeReference[];
}

export type WorkflowEdge = RFEdge;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkflowMetadata {
  nodeCount: number;
  connectionCount: number;
  // Highest node sequence ever issued inside this canvas.
  // This value is monotonic and must not decrease when nodes are deleted.
  lastNodeId: number;
  canvasSize: { width: number; height: number };
  // Workflow-scoped task history references retained for execution/task-history compatibility.
  relatedTasks?: WorkflowRelatedTaskRef[];
  // Historical node ids that have been issued in this canvas.
  // This field is optional and may be partially populated by old data.
  usedNodeIds?: string[];
  // Backward-compatibility field only.
  // Released ids must not be reused for new node allocation.
  releasedNodeIds?: string[];
}

export interface WorkflowState {
  current: Workflow | null;
  history: WorkflowHistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: number | null;
  persistenceState?: Workflow['persistenceState'];
  hasMaterializedCanvas?: boolean;
}

export interface WorkflowHistoryEntry {
  id: UUID;
  timestamp: number;
  action: string;
  snapshot: Partial<Workflow>;
  description?: string;
}

export type WorkflowOperationType = 'add' | 'update' | 'delete' | 'move' | 'connect' | 'disconnect' | 'batch';

export interface WorkflowOperation {
  type: WorkflowOperationType;
  payload: unknown;
  timestamp: number;
  undo?: WorkflowOperation;
}

export interface NodeOperation extends WorkflowOperation {
  nodeId: string;
}

export interface DragOperation {
  nodeIds: string[];
  startPosition: Position;
  currentPosition: Position;
  isShift: boolean;
  targetType: 'canvas' | 'reference-area';
  targetNodeId?: string;
}

export interface BatchOperation extends WorkflowOperation {
  type: 'batch';
  operations: WorkflowOperation[];
}

export interface WorkflowExport {
  version: string;
  exportedAt: number;
  workflow: Workflow;
}

export interface WorkflowImport {
  file: File;
  validateOnly: boolean;
}

export interface WorkflowImportResult {
  success: boolean;
  workflow?: Workflow;
  errors: string[];
  warnings: string[];
}

export interface WorkflowSaveOptions {
  force: boolean;
  silent: boolean;
  reason?: 'manual' | 'auto-idle' | 'auto-fallback';
}

export interface AutoSaveConfig {
  enabled: boolean;
  idleSaveEnabled: boolean;
  fallbackIntervalMs: number;
  debounceMs: number;
  interval?: number;
}

export interface LayoutConfig {
  type: 'grid' | 'smart' | 'force-directed';
  spacing: number;
  padding: number;
}

export interface ConnectionStyle {
  type: 'bezier' | 'straight' | 'step';
  animated: boolean;
  color: string;
  strokeWidth: number;
}

export interface SelectionState {
  selectedNodeIds: Set<string>;
  selectedConnectionIds: Set<string>;
  selectionBox: { start: Position; end: Position } | null;
}

export interface ClipboardData {
  nodes: AnyNodeData[];
  connections: Connection[];
  copiedAt: number;
}

export interface Template {
  id: UUID;
  name: string;
  description: string;
  category: string;
  thumbnail?: string;
  workflow: Partial<Workflow>;
  isBuiltIn: boolean;
  createdBy?: UUID;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateCategory {
  id: string;
  name: string;
  icon: string;
  order: number;
}
