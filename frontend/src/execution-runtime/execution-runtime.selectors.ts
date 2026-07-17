import type {
  ExecutionRuntimeGroupState,
  ExecutionRuntimeNodeState,
  ExecutionRuntimeRunState,
  ExecutionRuntimeTaskState,
} from './execution-runtime.types';
import {
  getExecutionRuntimeGroupKey,
  getExecutionRuntimeNodeKey,
  type ExecutionRuntimeStore,
} from './execution-runtime.store';

export interface ExecutionRuntimeSelectorScope {
  workflowId?: string | null;
}

export function getExecutionRuntimeWorkflowKey(workflowId?: string | null): string {
  return workflowId ?? '__global__';
}

export function selectExecutionRunState(
  store: ExecutionRuntimeStore,
  runId: string | null | undefined,
): ExecutionRuntimeRunState | null {
  if (!runId) {
    return null;
  }

  return store.getRun(runId);
}

export function selectExecutionTaskState(
  store: ExecutionRuntimeStore,
  taskId: string | null | undefined,
): ExecutionRuntimeTaskState | null {
  if (!taskId) {
    return null;
  }

  return store.getTask(taskId);
}

export function selectExecutionNodeState(
  store: ExecutionRuntimeStore,
  nodeId: string | null | undefined,
  scope: ExecutionRuntimeSelectorScope = {},
): ExecutionRuntimeNodeState | null {
  if (!nodeId) {
    return null;
  }

  return store.getNode(nodeId, scope.workflowId);
}

export function selectExecutionGroupState(
  store: ExecutionRuntimeStore,
  nodeId: string | null | undefined,
  groupId: string | null | undefined,
  scope: ExecutionRuntimeSelectorScope = {},
): ExecutionRuntimeGroupState | null {
  if (!nodeId || !groupId) {
    return null;
  }

  return store.getGroup(nodeId, groupId, scope.workflowId);
}

export function selectExecutionNodeGroupStates(
  store: ExecutionRuntimeStore,
  nodeId: string | null | undefined,
  scope: ExecutionRuntimeSelectorScope = {},
): ExecutionRuntimeGroupState[] {
  if (!nodeId) {
    return [];
  }

  return store.getNodeGroups(nodeId, scope.workflowId);
}

export function getExecutionRuntimeNodeSubscriptionKey(
  nodeId: string,
  workflowId?: string | null,
): string {
  return getExecutionRuntimeNodeKey(nodeId, workflowId);
}

export function getExecutionRuntimeGroupSubscriptionKey(
  nodeId: string,
  groupId: string,
  workflowId?: string | null,
): string {
  return getExecutionRuntimeGroupKey(nodeId, groupId, workflowId);
}
