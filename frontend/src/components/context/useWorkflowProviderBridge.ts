import { useCallback, useEffect, useRef } from 'react';
import type { UseWorkflowReturn } from '../../hooks/workflow/useWorkflow';
import type { WorkflowRuntimeSnapshot } from '@/contracts/workflow';
import type { Workflow } from '@/types';
import { syncWorkflowRefWithRuntimeSnapshot } from './workflow-runtime-sync';

interface WorkflowProviderBridgeDependencies {
  workflow: Pick<
    UseWorkflowReturn,
    'workflow'
    | 'create'
    | 'load'
    | 'patchCurrent'
    | 'reset'
    | 'syncRuntimeState'
  >;
  setLastLoadError: (value: string | null) => void;
}

export interface WorkflowProviderBridge {
  workflowRef: React.MutableRefObject<Workflow | null>;
  materializationPromiseRef: React.MutableRefObject<Promise<Workflow> | null>;
  patchCurrentWorkflow: (updater: (workflow: Workflow) => Workflow) => Workflow | null;
  applyRuntimeSnapshot: (
    runtimeSnapshot: WorkflowRuntimeSnapshot,
    options?: Parameters<UseWorkflowReturn['syncRuntimeState']>[1],
  ) => Workflow | null;
  createWorkflow: (projectId: Workflow['projectId'], name?: string) => Workflow;
  loadWorkflow: (workflow: Workflow) => void;
  resetWorkflow: () => void;
}

export function useWorkflowProviderBridge(
  dependencies: WorkflowProviderBridgeDependencies,
): WorkflowProviderBridge {
  const { workflow, setLastLoadError } = dependencies;
  const workflowRef = useRef<Workflow | null>(null);
  const materializationPromiseRef = useRef<Promise<Workflow> | null>(null);

  useEffect(() => {
    workflowRef.current = workflow.workflow;
  }, [workflow.workflow]);

  const patchCurrentWorkflow = useCallback((updater: (currentWorkflow: Workflow) => Workflow): Workflow | null => {
    const nextWorkflow = workflow.patchCurrent(updater);
    if (!nextWorkflow) {
      return null;
    }

    workflowRef.current = nextWorkflow;
    setLastLoadError(null);
    return nextWorkflow;
  }, [setLastLoadError, workflow]);

  const applyRuntimeSnapshot = useCallback((
    runtimeSnapshot: WorkflowRuntimeSnapshot,
    options?: Parameters<UseWorkflowReturn['syncRuntimeState']>[1],
  ): Workflow | null => {
    return syncWorkflowRefWithRuntimeSnapshot(
      workflowRef,
      workflow.syncRuntimeState,
      runtimeSnapshot,
      options,
    );
  }, [workflow.syncRuntimeState]);

  const createWorkflow = useCallback((projectId: Workflow['projectId'], name?: string): Workflow => {
    setLastLoadError(null);
    return workflow.create(projectId, name);
  }, [setLastLoadError, workflow]);

  const loadWorkflow = useCallback((nextWorkflow: Workflow): void => {
    workflow.load(nextWorkflow);
    workflowRef.current = nextWorkflow;
    setLastLoadError(null);
  }, [setLastLoadError, workflow]);

  const resetWorkflow = useCallback((): void => {
    workflow.reset();
    setLastLoadError(null);
  }, [setLastLoadError, workflow]);

  return {
    workflowRef,
    materializationPromiseRef,
    patchCurrentWorkflow,
    applyRuntimeSnapshot,
    createWorkflow,
    loadWorkflow,
    resetWorkflow,
  };
}
