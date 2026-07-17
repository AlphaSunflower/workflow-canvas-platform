import {
  createContext,
  useContext,
  useSyncExternalStore,
} from 'react';
import {
  executionRuntimeStore as defaultExecutionRuntimeStore,
  type ExecutionRuntimeStore,
} from './execution-runtime.store';
import {
  selectExecutionGroupState,
  selectExecutionNodeGroupStates,
  selectExecutionNodeState,
  selectExecutionRunState,
  selectExecutionTaskState,
} from './execution-runtime.selectors';
import type {
  ExecutionRuntimeGroupState,
  ExecutionRuntimeNodeState,
  ExecutionRuntimeRunState,
  ExecutionRuntimeTaskState,
} from './execution-runtime.types';

export const ExecutionRuntimeStoreContext = createContext<ExecutionRuntimeStore | null>(null);

export function useExecutionRuntimeStore(): ExecutionRuntimeStore {
  return useContext(ExecutionRuntimeStoreContext) ?? defaultExecutionRuntimeStore;
}

export function useExecutionRunState(
  runId?: string | null,
): ExecutionRuntimeRunState | null {
  const store = useExecutionRuntimeStore();

  return useSyncExternalStore(
    (listener): (() => void) => (runId ? store.subscribeRun(runId, listener) : (): void => undefined),
    (): ExecutionRuntimeRunState | null => selectExecutionRunState(store, runId),
    (): ExecutionRuntimeRunState | null => selectExecutionRunState(store, runId),
  );
}

export function useExecutionTaskState(
  taskId?: string | null,
): ExecutionRuntimeTaskState | null {
  const store = useExecutionRuntimeStore();

  return useSyncExternalStore(
    (listener): (() => void) => (taskId ? store.subscribeTask(taskId, listener) : (): void => undefined),
    (): ExecutionRuntimeTaskState | null => selectExecutionTaskState(store, taskId),
    (): ExecutionRuntimeTaskState | null => selectExecutionTaskState(store, taskId),
  );
}

export function useExecutionNodeState(
  nodeId?: string | null,
  workflowId?: string | null,
): ExecutionRuntimeNodeState | null {
  const store = useExecutionRuntimeStore();

  return useSyncExternalStore(
    (listener): (() => void) => (nodeId ? store.subscribeNode(nodeId, workflowId, listener) : (): void => undefined),
    (): ExecutionRuntimeNodeState | null => selectExecutionNodeState(store, nodeId, { workflowId }),
    (): ExecutionRuntimeNodeState | null => selectExecutionNodeState(store, nodeId, { workflowId }),
  );
}

export function useExecutionGroupState(
  nodeId?: string | null,
  groupId?: string | null,
  workflowId?: string | null,
): ExecutionRuntimeGroupState | null {
  const store = useExecutionRuntimeStore();

  return useSyncExternalStore(
    (listener): (() => void) => (nodeId && groupId
      ? store.subscribeGroup(nodeId, groupId, workflowId, listener)
      : (): void => undefined),
    (): ExecutionRuntimeGroupState | null => selectExecutionGroupState(store, nodeId, groupId, { workflowId }),
    (): ExecutionRuntimeGroupState | null => selectExecutionGroupState(store, nodeId, groupId, { workflowId }),
  );
}

export function useExecutionNodeGroupStates(
  nodeId?: string | null,
  workflowId?: string | null,
): ExecutionRuntimeGroupState[] {
  const store = useExecutionRuntimeStore();

  return useSyncExternalStore(
    (listener): (() => void) => (nodeId ? store.subscribeNode(nodeId, workflowId, listener) : (): void => undefined),
    (): ExecutionRuntimeGroupState[] => selectExecutionNodeGroupStates(store, nodeId, { workflowId }),
    (): ExecutionRuntimeGroupState[] => selectExecutionNodeGroupStates(store, nodeId, { workflowId }),
  );
}
