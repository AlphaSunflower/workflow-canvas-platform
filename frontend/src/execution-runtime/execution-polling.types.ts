import type { AppError } from '@/types';
import type { ExecutionRuntimePatch, ExecutionRuntimeRunState } from './execution-runtime.types';
import type { ExecutionRuntimeStore, ExecutionRuntimeStoreApplyResult } from './execution-runtime.store';

export interface ExecutionPollingConfig {
  intervalMs?: number;
}

export interface ExecutionPollingTaskOptions {
  runId: string;
  workflowId?: string | null;
  nodeId?: string | null;
  signal?: AbortSignal;
  config?: ExecutionPollingConfig;
  mapSnapshotToPatches?: (
    snapshot: ExecutionRuntimeRunState,
    previousSnapshot: ExecutionRuntimeRunState | null,
  ) => ExecutionRuntimePatch[];
  onSnapshot?: (snapshot: ExecutionRuntimeRunState, applyResult: ExecutionRuntimeStoreApplyResult) => void;
  onCompleted?: (snapshot: ExecutionRuntimeRunState) => void;
  onFailed?: (error: AppError | Error | DOMException | unknown) => void;
  onStopped?: (reason: 'manual' | 'aborted' | 'completed' | 'failed') => void;
}

export interface ExecutionPollingTaskState {
  runId: string;
  workflowId?: string | null;
  nodeId?: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  lastPolledAt: number | null;
  intervalMs: number;
}

export interface ExecutionPollingTaskHandle {
  state: ExecutionPollingTaskState;
  promise: Promise<ExecutionRuntimeRunState>;
  stop: () => void;
  signal: AbortSignal;
}

export interface ExecutionPollingSnapshotContext {
  workflowId?: string | null;
  nodeId?: string | null;
}

export interface ExecutionPollingManagerOptions {
  store?: ExecutionRuntimeStore;
  defaultIntervalMs?: number;
}
