import { useCallback, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { AuthStatus } from '@/auth/auth-context';
import { shouldBootstrapBlankWorkflow } from './workflow-session-bootstrap';
import type { Workflow } from '@/types';

interface WorkflowProviderLifecycleDependencies {
  authStatus: AuthStatus;
  projectId: Workflow['projectId'];
  workflowRef: MutableRefObject<Workflow | null>;
  createWorkflow: (projectId: Workflow['projectId'], name?: string) => Workflow;
  loadWorkflow: (workflow: Workflow) => void;
  refreshWorkflow: () => Promise<void>;
  resetRuntimeExecutionState: () => void;
}

export interface WorkflowProviderLifecycle {
  createWorkflow: (projectId: Workflow['projectId'], name?: string) => Workflow;
  loadWorkflow: (workflow: Workflow) => void;
  refreshWorkflow: () => Promise<void>;
}

export function useWorkflowProviderLifecycle(
  dependencies: WorkflowProviderLifecycleDependencies,
): WorkflowProviderLifecycle {
  const {
    authStatus,
    projectId,
    workflowRef,
    createWorkflow,
    loadWorkflow,
    refreshWorkflow,
    resetRuntimeExecutionState,
  } = dependencies;

  const createWorkflowWithReset = useCallback((currentProjectId: Workflow['projectId'], name?: string): Workflow => {
    resetRuntimeExecutionState();
    return createWorkflow(currentProjectId, name);
  }, [createWorkflow, resetRuntimeExecutionState]);

  const loadWorkflowWithReset = useCallback((nextWorkflow: Workflow): void => {
    resetRuntimeExecutionState();
    loadWorkflow(nextWorkflow);
  }, [loadWorkflow, resetRuntimeExecutionState]);

  const refreshWorkflowWithReset = useCallback(async (): Promise<void> => {
    resetRuntimeExecutionState();
    await refreshWorkflow();
  }, [refreshWorkflow, resetRuntimeExecutionState]);

  useEffect(() => {
    if (shouldBootstrapBlankWorkflow({
      authStatus,
      workflow: workflowRef.current,
    })) {
      createWorkflowWithReset(projectId);
    }
  }, [authStatus, createWorkflowWithReset, projectId, workflowRef]);

  useEffect(() => {
    return () => {
      resetRuntimeExecutionState();
    };
  }, [resetRuntimeExecutionState]);

  return {
    createWorkflow: createWorkflowWithReset,
    loadWorkflow: loadWorkflowWithReset,
    refreshWorkflow: refreshWorkflowWithReset,
  };
}
