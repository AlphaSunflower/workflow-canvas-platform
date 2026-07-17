/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import type {
  WorkflowUIActions,
  WorkflowUINotificationRuntime,
  WorkflowUISelectors,
} from '@/contracts/workflow-ui';

export interface CanvasNodeRuntimeBindingsValue {
  workflowId: string | null;
  actions: WorkflowUIActions;
  selectors: WorkflowUISelectors;
  runtime: WorkflowUINotificationRuntime;
}

const CanvasNodeRuntimeBindingsContext = createContext<CanvasNodeRuntimeBindingsValue | null>(null);

interface CanvasNodeRuntimeBindingsProviderProps {
  value: CanvasNodeRuntimeBindingsValue;
  children: ReactNode;
}

export function CanvasNodeRuntimeBindingsProvider(
  props: CanvasNodeRuntimeBindingsProviderProps,
): JSX.Element {
  return (
    <CanvasNodeRuntimeBindingsContext.Provider value={props.value}>
      {props.children}
    </CanvasNodeRuntimeBindingsContext.Provider>
  );
}

function useCanvasNodeRuntimeBindingsValue(): CanvasNodeRuntimeBindingsValue {
  const value = useContext(CanvasNodeRuntimeBindingsContext);
  if (!value) {
    throw new Error('Canvas node runtime bindings are unavailable outside the canvas renderer.');
  }

  return value;
}

export function useCanvasNodeRuntimeBindings(): CanvasNodeRuntimeBindingsValue {
  return useCanvasNodeRuntimeBindingsValue();
}

export function useCanvasNodeActions(): WorkflowUIActions {
  return useCanvasNodeRuntimeBindingsValue().actions;
}

export function useCanvasNodeSelectors(): WorkflowUISelectors {
  return useCanvasNodeRuntimeBindingsValue().selectors;
}

export function useCanvasNodeNotificationRuntime(): WorkflowUINotificationRuntime {
  return useCanvasNodeRuntimeBindingsValue().runtime;
}
