import type { WorkflowExecutionAdapterInputContext } from '@/contracts/workflow';
import type { AINodeData, FileInfo, FileNodeData } from '@/types';
import type { ExecutionRuntimePatch, ExecutionRuntimeRunState } from './execution-runtime.types';
import type {
  ExecutionOutputCommitCustomHandlerRequest,
  ExecutionOutputCommitCustomHandlerResult,
  ExecutionOutputCommitStateCheckRequest,
} from './execution-output-commit.types';
import type {
  ExecutionRuntimeGroupedNodeExecutionTarget,
  ExecutionRuntimeNodeExecutionKind,
  ExecutionRuntimeNodeExecutionOutput,
  ExecutionRuntimeNodeExecutionPayload,
  ExecutionRuntimeNodeExecutionRunContext,
  ExecutionRuntimeNodeExecutionTarget,
  ExecutionRuntimeSingleNodeExecutionTarget,
} from './node-execution.types';

export interface ExecutionRuntimePersistedTaskRef {
  taskId: string;
  runId?: string;
  runNo?: string;
  taskType?: string;
  groupId?: string;
  groupLabel?: string;
  groupOrder?: number;
  outputHandle?: string;
}

export type MaybePromise<T> = T | Promise<T>;

export interface ExecutionRuntimeNodeAdapterServices {
  ensureBackendFileId?: (node: FileNodeData, options?: { signal?: AbortSignal; workflowId?: string | null; authScope?: string | null }) => Promise<string>;
  registerBackendBlobFile?: (blob: Blob | File, options?: {
    signal?: AbortSignal;
    fileName?: string;
    displayName?: string;
    fileType?: 'image' | 'video' | 'ply' | 'unknown';
    sourceType?: 'input' | 'intermediate' | 'output';
    mimeType?: string;
  }) => Promise<string>;
  registerInpaintMaskFile?: (nodeId: string, blob: Blob | File, options?: { signal?: AbortSignal }) => Promise<string>;
  getBackendFileInfo?: (fileId: string, signal?: AbortSignal) => Promise<FileInfo>;
  resolveFileUrl?: (fileId: string) => string;
}

export interface ExecutionRuntimeNodeAdapterContext extends WorkflowExecutionAdapterInputContext {
  signal?: AbortSignal;
  services?: ExecutionRuntimeNodeAdapterServices;
}

export type ExecutionRuntimeNodeAdapterValidationResult =
  | { valid: true }
  | { valid: false; reason: string; code?: string };

export interface ExecutionRuntimeNodeOutputAdapter<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> {
  extractExecutionOutputs: (
    snapshot: ExecutionRuntimeRunState,
    context: ExecutionRuntimeNodeExecutionRunContext<TRequest, TTarget>,
  ) => ExecutionRuntimeNodeExecutionOutput[];
  outputCommitMode?: 'terminal-only' | 'incremental';
  createReconcileTargets?: (request: {
    workflow: import('@/types').Workflow;
    node: AINodeData;
    snapshot: ExecutionRuntimeRunState;
    persistedTaskRefs: ExecutionRuntimePersistedTaskRef[];
  }) => TTarget[];
  normalizeReconcileOutput?: (request: {
    output: ExecutionRuntimeNodeExecutionOutput;
    workflow: import('@/types').Workflow;
    node: AINodeData;
    snapshot: ExecutionRuntimeRunState;
    persistedTaskRefs: ExecutionRuntimePersistedTaskRef[];
  }) => ExecutionRuntimeNodeExecutionOutput;
  isOutputCommitted?: (
    request: ExecutionOutputCommitStateCheckRequest<TRequest, TTarget>,
  ) => MaybePromise<boolean>;
  commitExecutionOutputs?: (
    request: ExecutionOutputCommitCustomHandlerRequest<TRequest, TTarget>,
  ) => MaybePromise<ExecutionOutputCommitCustomHandlerResult>;
}

interface ExecutionRuntimeNodeAdapterBase<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> extends ExecutionRuntimeNodeOutputAdapter<TRequest, TTarget> {
  nodeType: AINodeData['type'];
  executionKind: ExecutionRuntimeNodeExecutionKind;
  taskType: string;
  validateExecution: (
    context: ExecutionRuntimeNodeAdapterContext,
  ) => ExecutionRuntimeNodeAdapterValidationResult;
  createExecutionPayload: (
    context: ExecutionRuntimeNodeAdapterContext,
  ) => MaybePromise<ExecutionRuntimeNodeExecutionPayload<TRequest, TTarget>>;
  mapSnapshotToRuntimePatch: (
    snapshot: ExecutionRuntimeRunState,
    context: ExecutionRuntimeNodeExecutionRunContext<TRequest, TTarget>,
  ) => ExecutionRuntimePatch[];
}

export interface ExecutionRuntimeSingleNodeAdapter<TRequest = unknown>
  extends ExecutionRuntimeNodeAdapterBase<TRequest, ExecutionRuntimeSingleNodeExecutionTarget> {
  executionKind: 'single';
}

export interface ExecutionRuntimeGroupedNodeAdapter<TRequest = unknown>
  extends ExecutionRuntimeNodeAdapterBase<TRequest, ExecutionRuntimeGroupedNodeExecutionTarget> {
  executionKind: 'grouped';
}

export type ExecutionRuntimeNodeAdapter<TRequest = unknown> =
  | ExecutionRuntimeSingleNodeAdapter<TRequest>
  | ExecutionRuntimeGroupedNodeAdapter<TRequest>;
