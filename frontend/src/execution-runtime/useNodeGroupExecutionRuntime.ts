import { useMemo } from 'react';
import {
  useExecutionGroupState,
  useExecutionNodeGroupStates,
} from './execution-runtime.context.shared';
import type { ExecutionRuntimeGroupState } from './execution-runtime.types';

function isActiveExecutionStatus(status: ExecutionRuntimeGroupState['status']): boolean {
  return status === 'queued' || status === 'processing';
}

export interface UseNodeGroupExecutionRuntimeResult {
  executionState: ExecutionRuntimeGroupState | null;
  isProcessing: boolean;
  hasExecution: boolean;
  status: ExecutionRuntimeGroupState['status'];
}

export function useNodeGroupExecutionRuntime(
  nodeId: string,
  groupId: string | null | undefined,
  workflowId?: string | null,
): UseNodeGroupExecutionRuntimeResult {
  const executionState = useExecutionGroupState(nodeId, groupId, workflowId);

  return useMemo(() => {
    const status = executionState?.status ?? null;

    return {
      executionState,
      isProcessing: isActiveExecutionStatus(status),
      hasExecution: executionState !== null,
      status,
    };
  }, [executionState]);
}

export function useNodeExecutionGroupsRuntime(
  nodeId: string,
  workflowId?: string | null,
): ExecutionRuntimeGroupState[] {
  return useExecutionNodeGroupStates(nodeId, workflowId);
}
