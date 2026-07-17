import { useMemo } from 'react';
import { useExecutionNodeState } from './execution-runtime.context.shared';
import type { ExecutionRuntimeNodeState } from './execution-runtime.types';

function isActiveExecutionStatus(status: ExecutionRuntimeNodeState['status']): boolean {
  return status === 'queued' || status === 'processing';
}

export interface UseNodeExecutionRuntimeOptions {
  workflowId?: string | null;
  canRun?: boolean;
}

export interface UseNodeExecutionRuntimeResult {
  executionState: ExecutionRuntimeNodeState | null;
  isProcessing: boolean;
  canRun: boolean;
  hasExecution: boolean;
  status: ExecutionRuntimeNodeState['status'];
}

export function useNodeExecutionRuntime(
  nodeId: string,
  options: UseNodeExecutionRuntimeOptions = {},
): UseNodeExecutionRuntimeResult {
  const executionState = useExecutionNodeState(nodeId, options.workflowId);

  return useMemo(() => {
    const status = executionState?.status ?? null;
    const isProcessing = isActiveExecutionStatus(status);

    return {
      executionState,
      isProcessing,
      canRun: options.canRun ?? !isProcessing,
      hasExecution: executionState !== null,
      status,
    };
  }, [executionState, options.canRun]);
}
