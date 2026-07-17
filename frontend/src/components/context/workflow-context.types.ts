import type { UseNotificationReturn, UseContextMenuReturn } from '../../hooks/ui';
import type { BrowserFileSystemFileHandleLike } from '@/services/local-file-source-store';
import type {
  ExecutionTaskRef,
  Workflow,
  AnyNodeData,
  AINodeData,
  FileNodeData,
  Connection,
  Viewport,
  WorkflowMetadata,
  WorkflowSaveOptions,
  AIStreamChunk,
  AITask,
  AITaskType,
  AIProvider,
  AIModelType,
  NodeTaskRef,
  WorkflowRelatedTaskRef,
  UUID,
} from '../../types';
import type {
  WorkflowHydrationState,
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
  WorkflowConnectionInput,
  WorkflowNodeGroupInput,
  WorkflowNodeGroupPortInput,
  WorkflowNodeGroupState,
  WorkflowResolvedNodeGroupState,
} from '@/contracts/workflow';
import type { WorkflowNodeActionAccess } from '@/contracts/node-actions';
import type { TaskHistoryListItem } from '@/components/canvas/task-history.types';

export type {
  WorkflowHydrationState,
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
  WorkflowConnectionInput,
  WorkflowExecutionAdapterInputContext,
  WorkflowNodeGroupInput,
  WorkflowNodeGroupPortInput,
  WorkflowNodeGroupPortState,
  WorkflowNodeGroupState,
  WorkflowResolvedNodeGroupState,
} from '@/contracts/workflow';
export type {
  WorkflowAIExecutionState,
  WorkflowNodeGroupExecutionState,
} from '@/contracts/execution';
export type { PatchNodeConfigOptions, RunNodeActionParams, WorkflowNodeActionAccess } from '@/contracts/node-actions';

export type WorkflowSwitchDecision = 'save' | 'discard' | 'cancel';
export type WorkflowAuthoritativeWorkflowSupplier = () => Workflow | null;

export interface WorkflowSwitchRequestContext {
  targetLabel: string;
  targetKind: 'workflow' | 'new-blank';
  canSave: boolean;
  saveBlockedReason: string | null;
  hasMeaningfulChanges: boolean;
  isDraftWithoutMaterialization: boolean;
}

export interface PendingWorkflowSwitchConfirmation {
  context: WorkflowSwitchRequestContext;
  resolve: (decision: WorkflowSwitchDecision) => void;
}

export interface WorkflowSwitchFlowDialogState {
  isOpen: boolean;
  context: WorkflowSwitchRequestContext | null;
  isSaving: boolean;
  onDecision: (decision: WorkflowSwitchDecision) => void;
}

export interface WorkflowSwitchFlowController {
  dialog: WorkflowSwitchFlowDialogState;
  requestWorkflowSwitchDecision: (
    context: WorkflowSwitchRequestContext,
  ) => Promise<WorkflowSwitchDecision>;
  runWorkflowSwitchSave: <T>(operation: () => Promise<T>) => Promise<T>;
}

export interface WorkflowContextState {
  workflow: Workflow | null;
  hydrationVersion: number;
  hydrationState: WorkflowHydrationState;
  isLoaded: boolean;
  isDirty: boolean;
  isSaving: boolean;
  lastSaveError: string | null;
  canSave: boolean;
  saveBlockedReason: string | null;
  lastSavedAt: number | null;
  relatedTasks: WorkflowRelatedTaskRef[];
  taskHistory: TaskHistoryListItem[];
  nodes: AnyNodeData[];
  connections: Connection[];
  viewport: Viewport | null;
  metadata: WorkflowMetadata | null;
  nodeCount: number;
  connectionCount: number;
  persistenceState: Workflow['persistenceState'] | null;
  hasMaterializedCanvas: boolean;
  persistedWorkflowId: UUID | null;
  workflowGroupId: UUID | null;
  isAutoNamed: boolean;
}

export interface WorkflowContextActions extends WorkflowNodeActionAccess {
  createWorkflow: (projectId: UUID, name?: string) => Workflow;
  loadWorkflow: (workflow: Workflow) => void;
  patchCurrentWorkflow: (updater: (workflow: Workflow) => Workflow) => Workflow | null;
  confirmBeforeWorkflowSwitch: (
    context: WorkflowSwitchRequestContext,
  ) => Promise<boolean>;
  refreshWorkflow: () => Promise<void>;
  ensureMaterializedWorkflow: () => Promise<Workflow>;
  saveWorkflow: (options?: WorkflowSaveOptions) => Promise<void>;
  /**
   * Requests a Canvas-owned structural runtime sync. Node components should use
   * this entrypoint for graph structure reconciliation instead of directly
   * writing workflow snapshots.
   */
  syncRuntimeSnapshot: (runtime: WorkflowRuntimeSnapshot, options?: WorkflowRuntimeSyncOptions) => Workflow | null;
  exportLocalArchive: () => Promise<void>;
  importLocalArchive: (content: string) => Promise<void>;
  /**
   * Applies a controlled runtime snapshot directly to workflow state. Reserved
   * for runtime hydrate, output commit and reconcile-style flows.
   */
  updateRuntimeSnapshot: (runtime: WorkflowRuntimeSnapshot, options?: WorkflowRuntimeSyncOptions) => Workflow | null;
  resetWorkflow: () => void;
  markDirty: () => void;
  markClean: (savedAt?: number) => void;
  exportFileNode: (nodeId: string, options?: { forceDirectoryPicker?: boolean }) => Promise<void>;
  rebindLocalFileNodeSource: (
    nodeId: string,
    file: File,
    options?: {
      localSourceHandle?: BrowserFileSystemFileHandleLike;
    },
  ) => Promise<FileNodeData | null>;
  optimizeAIImageGenPrompt: (
    nodeId: string,
    options?: {
      signal?: AbortSignal;
      prompt?: string;
    },
  ) => Promise<void>;
  runAINode: (nodeId: string) => Promise<void>;
  cancelAINodeRun: (nodeId: string) => Promise<void>;
}

export interface WorkflowContextSelectors {
  getNodeById: (nodeId: string) => AnyNodeData | null;
  getConnectionsForNode: (nodeId: string) => Connection[];
  getIncomingConnections: (nodeId: string) => Connection[];
  getOutgoingConnections: (nodeId: string) => Connection[];
  getIncomingSourceNodes: (nodeId: string) => AnyNodeData[];
  getConnectedFileInputs: (nodeId: string) => FileNodeData[];
  getConnectedAIInputs: (nodeId: string) => AINodeData[];
  getNodeInputSummary: (nodeId: string) => WorkflowConnectionInput[];
  getResolvedNodeInputGroups: (nodeId: string) => WorkflowResolvedNodeGroupState[];
  getResolvedNodeGroupPortInputs: (nodeId: string, groupId: string, portId: string) => WorkflowNodeGroupPortInput[];
  hasResolvedNodeGroupInputs: (nodeId: string) => boolean;
  getNodeGroupInputs: (nodeId: string, groupId: string) => WorkflowNodeGroupInput[];
  getNodeInputGroups: (nodeId: string) => WorkflowNodeGroupState[];
  hasNodeGroupInputs: (nodeId: string) => boolean;
  getNodeTasks: (nodeId: string) => NodeTaskRef[];
  canRunNode: (nodeId: string) => boolean;
  getNodeDisplayName: (nodeId: string) => string;
  getAllNodeInputs: (nodeId: string) => WorkflowConnectionInput[];
}

export interface WorkflowContextRuntime {
  notification: UseNotificationReturn;
  contextMenu: UseContextMenuReturn;
  projectId: string;
  lastLoadError: string | null;
}

export interface WorkflowContextValue {
  state: WorkflowContextState;
  actions: WorkflowContextActions;
  selectors: WorkflowContextSelectors;
  runtime: WorkflowContextRuntime;
}

export interface CreateAITaskParams {
  taskRef?: ExecutionTaskRef;
  nodeId: string;
  projectId: UUID;
  workflowId?: UUID;
  workflowVersion?: number;
  nodeType?: AINodeData['type'];
  type: AITaskType;
  provider: AIProvider;
  model?: AIModelType;
  files: UUID[];
  references: UUID[];
  fileBindings?: AITask['input']['fileBindings'];
  config: AINodeData['config'];
  prompt?: string;
  negativePrompt?: string;
  groupId?: string;
  groupLabel?: string;
  groupOrder?: number;
  outputHandle?: string;
  idempotencyKey?: string;
}

export interface AIExecutionChunkState {
  progress: number;
  message: string | null;
  status: AITask['status'];
  output?: AITask['output'];
  error?: string;
}

export interface AIExecutionEvent {
  task: AITask;
  chunk?: AIStreamChunk;
  state: AIExecutionChunkState;
}
