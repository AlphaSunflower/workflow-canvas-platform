import {
  useNodeExecutionRuntime as useExecutionRuntimeNodeRuntime,
  type UseNodeExecutionRuntimeOptions,
  type UseNodeExecutionRuntimeResult,
} from '@/execution-runtime/useNodeExecutionRuntime';
import {
  useNodeExecutionGroupsRuntime as useExecutionRuntimeNodeGroupsRuntime,
  useNodeGroupExecutionRuntime as useExecutionRuntimeNodeGroupRuntime,
  type UseNodeGroupExecutionRuntimeResult,
} from '@/execution-runtime/useNodeGroupExecutionRuntime';
import type { ExecutionRuntimeGroupState } from '@/execution-runtime/execution-runtime.types';
import { useWorkflowContext } from './useWorkflowContext';

export type {
  UseNodeExecutionRuntimeOptions,
  UseNodeExecutionRuntimeResult,
  UseNodeGroupExecutionRuntimeResult,
};

export function useNodeExecutionRuntime(
  nodeId: string,
  options: UseNodeExecutionRuntimeOptions = {},
): UseNodeExecutionRuntimeResult {
  const { state } = useWorkflowContext();

  return useExecutionRuntimeNodeRuntime(nodeId, {
    ...options,
    workflowId: options.workflowId ?? state.workflow?.id ?? null,
  });
}

export function useNodeExecutionGroupsRuntime(
  nodeId: string,
  workflowId?: string | null,
): ExecutionRuntimeGroupState[] {
  const { state } = useWorkflowContext();

  return useExecutionRuntimeNodeGroupsRuntime(nodeId, workflowId ?? state.workflow?.id ?? null);
}

export function useNodeGroupExecutionRuntime(
  nodeId: string,
  groupId: string | null | undefined,
  workflowId?: string | null,
): UseNodeGroupExecutionRuntimeResult {
  const { state } = useWorkflowContext();

  return useExecutionRuntimeNodeGroupRuntime(
    nodeId,
    groupId,
    workflowId ?? state.workflow?.id ?? null,
  );
}
