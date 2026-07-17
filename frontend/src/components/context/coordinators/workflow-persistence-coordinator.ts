import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { AuthContextValue } from '@/auth';
import { requireAuthenticatedAction } from '@/auth';
import { workflowApi } from '@/api';
import type {
  Workflow,
  WorkflowSaveOptions,
} from '@/types';
import { createWorkflowPersistence } from '@/services/workflow-persistence';
import type {
  WorkflowAuthoritativeWorkflowSupplier,
  WorkflowSwitchFlowController,
  WorkflowSwitchRequestContext,
} from '../workflow-context.types';
import { WORKFLOW_CONTEXT_MESSAGES } from '../workflow-context.messages';
import { runWorkflowSavePreflight } from '../workflow-save-preflight';
import {
  createWorkflowSaveOrchestrator,
  materializeDraftWorkflowViaOrchestrator,
  persistWorkflowViaApi,
} from '../workflow-save-orchestrator';
import {
  hasMeaningfulWorkflowContent,
  isDraftWithoutMeaningfulWorkflowContent,
  shouldConfirmWorkflowSwitch,
} from '../workflow-switch-guard';
import { clearWorkflowExecutionReconcileState } from './workflow-execution-coordinator';
import {
  getPersistedWorkflowId,
  isPersistedWorkflow,
} from '@/services/workflow-session';

interface WorkflowSaveController {
  isDirty: boolean;
  autoSaveConfig: {
    debounceMs: number;
  };
  commitPersistedWorkflow: (workflow: Workflow) => Workflow | null;
}

interface WorkflowPersistenceCoordinatorDependencies {
  auth: Pick<AuthContextValue, 'isAuthenticated' | 'status'>;
  workflow: WorkflowSaveController;
  workflowRef: MutableRefObject<Workflow | null>;
  getAuthoritativeWorkflow: WorkflowAuthoritativeWorkflowSupplier;
  materializationPromiseRef: MutableRefObject<Promise<Workflow> | null>;
  replaceCurrentWorkflow: (workflow: Workflow) => void;
  loadWorkflowIntoState: (workflow: Workflow) => void;
  beforeLoadWorkflow?: () => void;
  switchFlow: Pick<
    WorkflowSwitchFlowController,
    'requestWorkflowSwitchDecision' | 'runWorkflowSwitchSave'
  >;
  setLastLoadError: (value: string | null) => void;
  showError: (title: string, message: string) => void;
}

export interface WorkflowPersistenceCoordinator {
  isSaving: boolean;
  lastSaveError: string | null;
  lastSavedAt: number | null;
  persistWorkflow: (workflow: Workflow) => Promise<Workflow>;
  ensureMaterializedWorkflow: () => Promise<Workflow>;
  ensureWorkflowPersistedForExecution: () => Promise<Workflow>;
  saveWorkflow: (options?: WorkflowSaveOptions) => Promise<void>;
  confirmBeforeWorkflowSwitch: (
    context: WorkflowSwitchRequestContext,
  ) => Promise<boolean>;
  refreshWorkflow: () => Promise<void>;
}

export function useWorkflowPersistenceCoordinator(
  dependencies: WorkflowPersistenceCoordinatorDependencies,
): WorkflowPersistenceCoordinator {
  const {
    auth,
    workflow,
    workflowRef,
    getAuthoritativeWorkflow,
    materializationPromiseRef,
    replaceCurrentWorkflow,
    loadWorkflowIntoState,
    beforeLoadWorkflow,
    switchFlow,
    setLastLoadError,
    showError,
  } = dependencies;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const persistenceRef = useRef(createWorkflowPersistence<Workflow, Workflow>({
    debounceMs: workflow.autoSaveConfig.debounceMs,
    save: async (nextWorkflow: Workflow): Promise<Workflow> => {
      return persistWorkflowViaApi(nextWorkflow);
    },
  }));

  useEffect(() => {
    const persistence = persistenceRef.current;
    const syncSavingState = (): void => {
      const persistenceState = persistence.getState();
      setIsSaving(
        persistenceState.isSaving
        || persistenceState.hasQueuedSave
        || persistenceState.hasScheduledSave,
      );
      setLastSaveError(
        persistenceState.lastError instanceof Error
          ? persistenceState.lastError.message
          : persistenceState.lastError
            ? String(persistenceState.lastError)
            : null,
      );
    };

    syncSavingState();
    return persistence.subscribe(syncSavingState);
  }, []);

  useEffect(() => {
    const persistence = persistenceRef.current;
    return () => {
      persistence.cancel();
    };
  }, []);

  const persistWorkflow = useCallback(
    (nextWorkflow: Workflow): Promise<Workflow> => {
      return persistWorkflowViaApi(nextWorkflow).then((savedWorkflow) => {
        const persistedWorkflowId =
          getPersistedWorkflowId(savedWorkflow) ?? savedWorkflow.id;
        clearWorkflowExecutionReconcileState(persistedWorkflowId);
        return savedWorkflow;
      });
    },
    [],
  );

  const commitSavedWorkflow = useCallback((savedWorkflow: Workflow): Workflow | null => {
    const committedWorkflow = workflow.commitPersistedWorkflow(savedWorkflow);
    if (!committedWorkflow) {
      return null;
    }

    workflowRef.current = committedWorkflow;
    setLastSaveError(null);
    setLastSavedAt(committedWorkflow.timestamp.updated);
    return committedWorkflow;
  }, [workflow, workflowRef]);

  const persistWorkflowThroughQueue = useCallback((
    nextWorkflow: Workflow,
    options?: WorkflowSaveOptions,
  ): Promise<Workflow> => {
    const persistenceMode = options?.force ? 'immediate' : 'debounced';
    return persistenceRef.current.save(nextWorkflow, {
      mode: persistenceMode,
      debounceMs: workflow.autoSaveConfig.debounceMs,
    });
  }, [workflow.autoSaveConfig.debounceMs]);

  const commitMaterializedWorkflow = useCallback(
    (savedWorkflow: Workflow): void => {
      const persistedWorkflowId =
        getPersistedWorkflowId(savedWorkflow) ?? savedWorkflow.id;
      clearWorkflowExecutionReconcileState(persistedWorkflowId);
      replaceCurrentWorkflow(savedWorkflow);
      workflowRef.current = savedWorkflow;
      setLastLoadError(null);
      setLastSaveError(null);
      setLastSavedAt(savedWorkflow.timestamp.updated);
    },
    [replaceCurrentWorkflow, setLastLoadError, workflowRef],
  );

  const ensureMaterializedWorkflow = useCallback(async (): Promise<Workflow> => {
    const activeWorkflow = getAuthoritativeWorkflow();
    if (!activeWorkflow) {
      throw new Error('No workflow is available for materialization.');
    }

    if (isPersistedWorkflow(activeWorkflow)) {
      return activeWorkflow;
    }

    const authError = requireAuthenticatedAction(auth, {
      actionLabel: WORKFLOW_CONTEXT_MESSAGES.createCanvasActionLabel,
    });
    if (authError) {
      throw authError;
    }

    if (materializationPromiseRef.current) {
      return materializationPromiseRef.current;
    }

    const materializationPromise = materializeDraftWorkflowViaOrchestrator({
      getAuthoritativeWorkflow,
      createBlankWorkflow: async (request) => {
        const result = await workflowApi.createBlank(request);
        if (!result.success) {
          throw result.error;
        }

        return result.data;
      },
      persistWorkflowViaApi: persistWorkflow,
      commitMaterializedWorkflow,
    })
      .catch((error) => {
        setLastLoadError(
          error instanceof Error
            ? error.message
            : 'Failed to materialize workflow',
        );
        throw error;
      })
      .finally(() => {
        materializationPromiseRef.current = null;
      });

    materializationPromiseRef.current = materializationPromise;
    return materializationPromise;
  }, [
    auth,
    commitMaterializedWorkflow,
    getAuthoritativeWorkflow,
    materializationPromiseRef,
    persistWorkflow,
    setLastLoadError,
  ]);

  const ensureWorkflowPersistedForExecution = useCallback(
    async (): Promise<Workflow> => {
      const activeWorkflow = getAuthoritativeWorkflow();
      if (!activeWorkflow) {
        throw new Error('No workflow is available for execution.');
      }

      if (isPersistedWorkflow(activeWorkflow)) {
        return activeWorkflow;
      }

      const workflowToPersist: Workflow = {
        ...activeWorkflow,
        persistedWorkflowId: undefined,
        id: activeWorkflow.id,
        persistenceState: 'creating',
        hasMaterializedCanvas: true,
      };
      const savedWorkflow = await persistWorkflow(workflowToPersist);
      loadWorkflowIntoState(savedWorkflow);
      workflowRef.current = savedWorkflow;
      setLastSaveError(null);
      setLastSavedAt(savedWorkflow.timestamp.updated);
      return savedWorkflow;
    },
    [getAuthoritativeWorkflow, loadWorkflowIntoState, persistWorkflow, workflowRef],
  );

  const saveOrchestrator = useMemo(() => createWorkflowSaveOrchestrator({
    getAuthoritativeWorkflow,
    materializeDraftWorkflow: ensureMaterializedWorkflow,
    persistWorkflow: persistWorkflowThroughQueue,
    commit: {
      commitPersistedWorkflow: (savedWorkflow) => {
        const persistedWorkflowId =
          getPersistedWorkflowId(savedWorkflow) ?? savedWorkflow.id;
        clearWorkflowExecutionReconcileState(persistedWorkflowId);
        return commitSavedWorkflow(savedWorkflow);
      },
    },
  }), [
    commitSavedWorkflow,
    ensureMaterializedWorkflow,
    persistWorkflowThroughQueue,
    getAuthoritativeWorkflow,
  ]);

  const saveWorkflow = useCallback(
    async (saveOptions?: WorkflowSaveOptions): Promise<void> => {
      const activeWorkflow = getAuthoritativeWorkflow();
      if (!activeWorkflow) {
        throw new Error('No workflow is available to save.');
      }

      if (!saveOptions?.force && !workflow.isDirty) {
        return;
      }

      runWorkflowSavePreflight({
        reason: saveOptions?.reason === 'auto-idle'
          ? 'auto-idle'
          : saveOptions?.reason === 'auto-fallback'
            ? 'auto-fallback'
            : 'manual-save',
        force: saveOptions?.force ?? false,
      });

      await saveOrchestrator.saveAuthoritativeWorkflow(saveOptions);
    },
    [getAuthoritativeWorkflow, saveOrchestrator, workflow.isDirty],
  );

  const confirmBeforeWorkflowSwitch = useCallback(
    async (
      context: WorkflowSwitchRequestContext,
    ): Promise<boolean> => {
      const activeWorkflow = getAuthoritativeWorkflow();
      const hasMeaningfulChanges =
        context.hasMeaningfulChanges
        || hasMeaningfulWorkflowContent(activeWorkflow);
      const activeIsDraftWithoutMaterialization =
        isDraftWithoutMeaningfulWorkflowContent(
          activeWorkflow,
          hasMeaningfulChanges,
        );

      if (
        !shouldConfirmWorkflowSwitch({
          workflow: activeWorkflow,
          isDirty: workflow.isDirty,
          hasMeaningfulChanges,
        })
      ) {
        return true;
      }

      const decision = await switchFlow.requestWorkflowSwitchDecision({
        ...context,
        hasMeaningfulChanges,
        isDraftWithoutMaterialization: activeIsDraftWithoutMaterialization,
      });

      if (decision === 'cancel') {
        return false;
      }

      if (decision === 'discard') {
        return true;
      }

      try {
        await switchFlow.runWorkflowSwitchSave(async () => {
          if (!getAuthoritativeWorkflow()) {
            return;
          }

          await saveWorkflow({
            force: true,
            silent: true,
            reason: 'manual',
          });
        });
        setLastLoadError(null);
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to save current workflow before switching.';
        setLastLoadError(message);
        showError(WORKFLOW_CONTEXT_MESSAGES.saveFailedTitle, message);
        return false;
      }
    },
    [
      saveWorkflow,
      setLastLoadError,
      showError,
      switchFlow,
      workflow.isDirty,
      getAuthoritativeWorkflow,
    ],
  );

  const refreshWorkflow = useCallback(async (): Promise<void> => {
    const activeWorkflowId = getPersistedWorkflowId(getAuthoritativeWorkflow());

    if (!activeWorkflowId) {
      const error = new Error('Current canvas has not been saved yet.');
      setLastLoadError(error.message);
      throw error;
    }

    const result = await workflowApi.getById(activeWorkflowId);
    if (result.success) {
      beforeLoadWorkflow?.();
      loadWorkflowIntoState(result.data);
      workflowRef.current = result.data;
      setLastLoadError(null);
      setLastSaveError(null);
      setLastSavedAt(result.data.timestamp.updated);
      return;
    }

    const message = result.error.message;
    setLastLoadError(message);
    throw result.error;
  }, [beforeLoadWorkflow, getAuthoritativeWorkflow, loadWorkflowIntoState, setLastLoadError, workflowRef]);

  return useMemo(() => ({
    isSaving,
    lastSaveError,
    lastSavedAt,
    persistWorkflow,
    ensureMaterializedWorkflow,
    ensureWorkflowPersistedForExecution,
    saveWorkflow,
    confirmBeforeWorkflowSwitch,
    refreshWorkflow,
  }), [
    confirmBeforeWorkflowSwitch,
    ensureMaterializedWorkflow,
    ensureWorkflowPersistedForExecution,
    isSaving,
    lastSaveError,
    lastSavedAt,
    persistWorkflow,
    refreshWorkflow,
    saveWorkflow,
  ]);
}
