import type {
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
} from '@/contracts/workflow';
import type { AINodeData, FileInfo, Workflow } from '@/types';
import type { ExecutionOutputRuntimeResource } from '@/services/execution-output-runtime-sync';
import type { ExecutionRuntimeRunState } from './execution-runtime.types';
import type {
  ExecutionRuntimeNodeAdapterContext,
  ExecutionRuntimeNodeOutputAdapter,
} from './node-execution-adapter.types';
import type {
  ExecutionRuntimeNodeExecutionOutput,
  ExecutionRuntimeNodeExecutionPayload,
  ExecutionRuntimeNodeExecutionRunContext,
  ExecutionRuntimeNodeExecutionTarget,
  ExecutionRuntimeGroupedNodeExecutionTarget,
} from './node-execution.types';

export type ExecutionOutputCommitMode = 'terminal-only' | 'incremental';

export interface ExecutionOutputCommitServiceAppendOptions {
  x?: number;
  y?: number;
  gapX?: number;
  gapY?: number;
  columns?: number;
}

export interface ExecutionOutputCommitWorkflowAccess {
  getCurrentWorkflow: () => Workflow | null;
  applyRuntimeSnapshot: (runtime: WorkflowRuntimeSnapshot, options?: WorkflowRuntimeSyncOptions) => Workflow | null;
  resolveFileUrl: (fileId: string) => string;
  ensureExecutionOutputRuntimeResource?: (fileInfo: import('@/types').FileInfo, options?: { signal?: AbortSignal }) => Promise<ExecutionOutputRuntimeResource | null>;
  prefetchExecutionOutputRuntimeResource?: (fileInfo: import('@/types').FileInfo, options?: { signal?: AbortSignal }) => Promise<void>;
}

export interface ExecutionOutputCommitRequest<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> {
  workflowId?: string | null;
  runId: string;
  node: AINodeData;
  snapshot: ExecutionRuntimeRunState;
  payload: ExecutionRuntimeNodeExecutionPayload<TRequest, TTarget>;
  adapter: ExecutionRuntimeNodeOutputAdapter<TRequest, TTarget>;
  adapterContext: ExecutionRuntimeNodeAdapterContext;
  workflowAccess: ExecutionOutputCommitWorkflowAccess;
  mode?: ExecutionOutputCommitMode;
  appendOptions?: ExecutionOutputCommitServiceAppendOptions;
}

export interface LegacyBackendExecutionTarget {
  groupId: string;
  groupOrder: number;
  groupLabel?: string;
  outputHandle?: string;
}

export interface ExecutionOutputCommitPayloadInput<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> {
  kind: 'payload';
  payload: ExecutionRuntimeNodeExecutionPayload<TRequest, TTarget>;
  adapterContext: ExecutionRuntimeNodeAdapterContext;
  mode?: ExecutionOutputCommitMode;
}

export interface ExecutionOutputCommitLegacyGroupedInput {
  kind: 'legacy-grouped-targets';
  targets: LegacyBackendExecutionTarget[];
  mode?: ExecutionOutputCommitMode;
}

export type ExecutionOutputCommitWorkflowInput<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> =
  | ExecutionOutputCommitPayloadInput<TRequest, TTarget>
  | ExecutionOutputCommitLegacyGroupedInput;

export interface ExecutionOutputCommitResolvedRequest<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> extends ExecutionOutputCommitRequest<TRequest, TTarget> {}

export interface ExecutionOutputCommitResolvedLegacyGroupedRequest
  extends ExecutionOutputCommitRequest<undefined, ExecutionRuntimeGroupedNodeExecutionTarget> {}

export interface ExecutionOutputCommitPreparedOutput {
  output: ExecutionRuntimeNodeExecutionOutput;
  fileInfo?: FileInfo;
  runtimeResource?: ExecutionOutputRuntimeResource | null;
}

export interface ExecutionOutputCommitStateCheckRequest<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> {
  workflow: Workflow | null;
  node: AINodeData;
  snapshot: ExecutionRuntimeRunState;
  payload: ExecutionRuntimeNodeExecutionPayload<TRequest, TTarget>;
  output: ExecutionRuntimeNodeExecutionOutput;
  adapterContext: ExecutionRuntimeNodeAdapterContext;
  workflowAccess: ExecutionOutputCommitWorkflowAccess;
}

export interface ExecutionOutputCommitCustomHandlerRequest<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> extends ExecutionOutputCommitRequest<TRequest, TTarget> {
  currentWorkflow: Workflow;
  preparedOutputs: ExecutionOutputCommitPreparedOutput[];
}

export interface ExecutionOutputCommitCustomHandlerResult {
  changed: boolean;
}

export interface ExecutionOutputCommitResult {
  changed: boolean;
  committedCount: number;
  skippedCount: number;
  outputs: ExecutionRuntimeNodeExecutionOutput[];
}

export interface ExecutionOutputCommitWorkflowOutputState {
  sourceNodeId: string;
  resultFileId: string;
  sourceHandle?: string;
  taskId?: string;
  hasSourceOutput: boolean;
  matchedNodeIds: string[];
  linkedMatchedNodeIds: string[];
  relevantConnectionIds: string[];
  brokenConnectionIds: string[];
  isCommitted: boolean;
}

export interface ExecutionOutputCommitCacheEntry {
  runId: string;
  nodeId: string;
  workflowId?: string | null;
  taskId: string;
  groupId?: string | null;
  resultFileId: string;
  sourceHandle?: string;
  fingerprint: string;
  committedAt: number;
}

export interface ExecutionOutputCommitRunCacheRecord {
  runId: string;
  nodeId: string;
  workflowId?: string | null;
  itemsByFingerprint: Map<string, ExecutionOutputCommitCacheEntry>;
}

export interface ExecutionOutputCommitAdapterRunContext<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> extends ExecutionRuntimeNodeExecutionRunContext<TRequest, TTarget> {}
