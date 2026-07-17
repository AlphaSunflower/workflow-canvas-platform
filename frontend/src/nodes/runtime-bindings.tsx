/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import type { ExecutionRuntimeGroupState } from '@/execution-runtime/execution-runtime.types';
import type { UseNodeExecutionRuntimeResult } from '@/execution-runtime/useNodeExecutionRuntime';
import type {
  WorkflowUIActions,
  WorkflowUINotificationRuntime,
  WorkflowUISelectors,
} from '@/contracts/workflow-ui';

export interface NodeRuntimeBindingsValue {
  workflowId: string | null;
  actions: WorkflowUIActions;
  selectors: WorkflowUISelectors;
  runtime: WorkflowUINotificationRuntime;
  nodeExecutionRuntime: UseNodeExecutionRuntimeResult | null;
  groupExecutionStates: ExecutionRuntimeGroupState[];
}

const NodeRuntimeBindingsContext = createContext<NodeRuntimeBindingsValue | null>(null);

interface NodeRuntimeBindingsProviderProps {
  value: NodeRuntimeBindingsValue;
  children: ReactNode;
}

export function NodeRuntimeBindingsProvider(
  props: NodeRuntimeBindingsProviderProps,
): JSX.Element {
  return (
    <NodeRuntimeBindingsContext.Provider value={props.value}>
      {props.children}
    </NodeRuntimeBindingsContext.Provider>
  );
}

export function useNodeRuntimeBindings(): NodeRuntimeBindingsValue {
  const value = useContext(NodeRuntimeBindingsContext);
  if (!value) {
    throw new Error('Node runtime bindings are unavailable outside canvas node renderers.');
  }

  return value;
}
