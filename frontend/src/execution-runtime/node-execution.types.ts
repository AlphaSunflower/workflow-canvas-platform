import type { FileInfo } from '@/types';
import type { NodeActionOnlyExecutionRequest } from './node-action-only-execution';
import type { ExecutionRuntimeRunState } from './execution-runtime.types';

export type ExecutionRuntimeNodeExecutionKind = 'single' | 'grouped';

interface ExecutionRuntimeNodeExecutionTargetBase {
  nodeId: string;
  nodeType: string;
  outputHandle?: string;
}

export interface ExecutionRuntimeSingleNodeExecutionTarget extends ExecutionRuntimeNodeExecutionTargetBase {
  kind: 'single';
  order: 0;
}

export interface ExecutionRuntimeGroupedNodeExecutionTarget extends ExecutionRuntimeNodeExecutionTargetBase {
  kind: 'group';
  groupId: string;
  groupOrder: number;
  groupLabel?: string;
}

export type ExecutionRuntimeNodeExecutionTarget =
  | ExecutionRuntimeSingleNodeExecutionTarget
  | ExecutionRuntimeGroupedNodeExecutionTarget;

export interface ExecutionRuntimeNodeExecutionPayload<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> {
  nodeId: string;
  nodeType: string;
  nodeTitle: string;
  taskType: string;
  executionKind: ExecutionRuntimeNodeExecutionKind;
  request: TRequest;
  targets: TTarget[];
}

export interface ExecutionRuntimeNodeExecutionRunContext<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> {
  workflowId?: string | null;
  nodeId: string;
  payload: ExecutionRuntimeNodeExecutionPayload<TRequest, TTarget>;
  previousSnapshot?: ExecutionRuntimeRunState | null;
}

export type ExecutionRuntimeNodeActionOnlyExecutionPayload<
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
> = ExecutionRuntimeNodeExecutionPayload<NodeActionOnlyExecutionRequest, TTarget>;

export interface ExecutionRuntimeNodeExecutionOutput {
  nodeId: string;
  runId: string;
  taskId: string;
  taskType?: string;
  resultFileId: string;
  groupId?: string;
  groupOrder: number;
  sourceHandle?: string;
  resultFile?: FileInfo;
}
