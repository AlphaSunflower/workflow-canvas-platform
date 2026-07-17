import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useContextMenu } from '../../hooks/ui/useContextMenu';
import { useNotification } from '../../hooks/ui/useNotification';
import { useWorkflow } from '../../hooks/workflow/useWorkflow';
import { WorkflowContext } from './workflow-context';
import { WorkflowActionsContext } from './workflow-actions-context';
import { WorkflowSwitchConfirmDialog } from '../workflow/WorkflowSwitchConfirmDialog';
import { useWorkflowGraphSelectors } from '../../nodes/shared/workflow-graph-selectors';
import type { AnyNodeData } from '../../types';
import { useAuth } from '@/auth';
import { useWorkflowAuthFeedback } from './coordinators/workflow-auth-feedback';
import { useWorkflowPersistenceCoordinator } from './coordinators/workflow-persistence-coordinator';
import { useWorkflowFileActions } from './coordinators/workflow-file-actions';
import { useWorkflowFileSyncCoordinator } from './coordinators/workflow-file-sync-coordinator';
import { useWorkflowExecutionCoordinator } from './coordinators/workflow-execution-coordinator';
import { useWorkflowProviderBridge } from './useWorkflowProviderBridge';
import { useWorkflowProviderLifecycle } from './useWorkflowProviderLifecycle';
import { useWorkflowProviderValue } from './useWorkflowProviderValue';
import { useWorkflowTaskHistory } from '@/components/canvas/useWorkflowTaskHistory';
import { registerDefaultExecutionRuntimeAdapters } from '@/execution-runtime/register-default-execution-runtime-adapters';
import {
  createWorkflowProviderActionSource,
  createWorkflowProviderSelectorSource,
  createWorkflowProviderStateSource,
} from './workflow-provider-sources';
import { useWorkflowSwitchFlow } from './useWorkflowSwitchFlow';
import { createAuthoritativeWorkflowSupplier } from './workflow-authoritative-workflow';

interface WorkflowProviderProps {
  children: ReactNode;
  projectId?: string;
}

export function WorkflowProvider({
  children,
  projectId = 'default',
}: WorkflowProviderProps): JSX.Element {
  registerDefaultExecutionRuntimeAdapters();
  const auth = useAuth();
  const notification = useNotification();
  const contextMenu = useContextMenu();
  const {
    showError,
    showInfo,
    showSuccess,
    showWarning,
  } = notification;
  const { showAuthFeedback } = useWorkflowAuthFeedback({
    showWarning,
  });
  const [lastLoadError, setLastLoadError] = useState<string | null>(null);
  const workflow = useWorkflow();
  const switchFlow = useWorkflowSwitchFlow();
  const {
    workflowRef,
    materializationPromiseRef,
    patchCurrentWorkflow,
    applyRuntimeSnapshot,
    createWorkflow,
    loadWorkflow,
    resetWorkflow,
  } = useWorkflowProviderBridge({
    workflow,
    setLastLoadError,
  });

  const selectors = useWorkflowGraphSelectors({
    nodes: workflow.nodes,
    connections: workflow.connections,
  });

  const nodeMap = useMemo(() => {
    return new Map<string, AnyNodeData>(
      workflow.nodes.map((node) => [node.id.value, node]),
    );
  }, [workflow.nodes]);
  const getAuthoritativeWorkflow = useMemo(
    () => createAuthoritativeWorkflowSupplier(workflowRef),
    [workflowRef],
  );

  const persistence = useWorkflowPersistenceCoordinator({
    auth,
    workflow: {
      isDirty: workflow.isDirty,
      autoSaveConfig: workflow.autoSaveConfig,
      commitPersistedWorkflow: workflow.commitPersistedWorkflow,
    },
    workflowRef,
    getAuthoritativeWorkflow,
    materializationPromiseRef,
    replaceCurrentWorkflow: workflow.replaceCurrent,
    loadWorkflowIntoState: workflow.load,
    beforeLoadWorkflow: undefined,
    switchFlow,
    setLastLoadError,
    showError,
  });

  const fileActions = useWorkflowFileActions({
    workflow,
    workflowRef,
    getAuthoritativeWorkflow,
    nodeMap,
    loadWorkflow,
    patchCurrentWorkflow,
    setLastLoadError,
    showError,
    showInfo,
    showSuccess,
    showWarning,
  });

  const execution = useWorkflowExecutionCoordinator({
    auth,
    workflow: {
      workflow: workflow.workflow,
      persistedWorkflowId: workflow.persistedWorkflowId,
    },
    workflowRef,
    nodeMap,
    selectors,
    applyRuntimeSnapshot,
    ensureWorkflowPersistedForExecution: persistence.ensureWorkflowPersistedForExecution,
    patchCurrentWorkflow,
    showAuthFeedback,
    showError,
    showInfo,
    showSuccess,
    showWarning,
  });

  const lifecycle = useWorkflowProviderLifecycle({
    authStatus: auth.status,
    projectId,
    workflowRef,
    createWorkflow,
    loadWorkflow,
    refreshWorkflow: persistence.refreshWorkflow,
    resetRuntimeExecutionState: execution.resetRuntimeExecutionState,
  });

  useWorkflowFileSyncCoordinator({
    workflow: {
      workflow: workflow.workflow,
      nodes: workflow.nodes,
      isDirty: workflow.isDirty,
      isSaving: persistence.isSaving,
      lastSaveError: persistence.lastSaveError,
      autoSaveConfig: workflow.autoSaveConfig,
    },
    workflowRef,
    hasActiveExecution: execution.hasActiveNodeExecution,
    saveWorkflow: persistence.saveWorkflow,
    showError,
  });

  const taskHistory = useWorkflowTaskHistory({
    workflowId: workflow.persistedWorkflowId ?? workflow.workflow?.id ?? null,
    relatedTasks: workflow.metadata?.relatedTasks ?? [],
  });

  const stateSource = useMemo(() => createWorkflowProviderStateSource({
    workflow,
    persistence,
    hasActiveNodeExecution: execution.hasActiveNodeExecution,
    taskHistory: taskHistory.items,
  }), [
    execution.hasActiveNodeExecution,
    persistence,
    taskHistory.items,
    workflow,
  ]);

  const actionSource = useMemo(() => createWorkflowProviderActionSource({
    lifecycleActions: {
      createWorkflow: lifecycle.createWorkflow,
      loadWorkflow: lifecycle.loadWorkflow,
      refreshWorkflow: lifecycle.refreshWorkflow,
    },
    workflowActions: {
      getCurrentWorkflow: () => workflowRef.current,
      patchCurrentWorkflow,
      resetWorkflow,
      markDirty: workflow.markDirty,
      markClean: workflow.markClean,
      applyRuntimeSnapshot,
    },
    persistenceActions: {
      confirmBeforeWorkflowSwitch: persistence.confirmBeforeWorkflowSwitch,
      ensureMaterializedWorkflow: persistence.ensureMaterializedWorkflow,
      saveWorkflow: persistence.saveWorkflow,
    },
    fileActions: {
      exportLocalArchive: fileActions.exportLocalArchive,
      importLocalArchive: fileActions.importLocalArchive,
      exportFileNode: fileActions.exportFileNode,
      rebindLocalFileNodeSource: fileActions.rebindLocalFileNodeSource,
    },
    executionActions: {
      optimizeAIImageGenPrompt: execution.optimizeAIImageGenPrompt,
      runNodeAction: execution.runNodeAction,
      patchNodeConfig: execution.patchNodeConfig,
      runAINode: execution.runAINode,
      cancelAINodeRun: execution.cancelAINodeRun,
    },
  }), [
    applyRuntimeSnapshot,
    execution.cancelAINodeRun,
    execution.optimizeAIImageGenPrompt,
    execution.patchNodeConfig,
    execution.runAINode,
    execution.runNodeAction,
    fileActions.exportFileNode,
    fileActions.exportLocalArchive,
    fileActions.importLocalArchive,
    fileActions.rebindLocalFileNodeSource,
    lifecycle.createWorkflow,
    lifecycle.loadWorkflow,
    lifecycle.refreshWorkflow,
    patchCurrentWorkflow,
    persistence.confirmBeforeWorkflowSwitch,
    persistence.ensureMaterializedWorkflow,
    persistence.saveWorkflow,
    resetWorkflow,
    workflow.markClean,
    workflow.markDirty,
  ]);

  const selectorSource = useMemo(() => createWorkflowProviderSelectorSource({
    selectors,
    canRunNode: execution.canRunNode,
  }), [execution.canRunNode, selectors]);

  const { actions, value } = useWorkflowProviderValue({
    stateSource,
    actionSource,
    selectorSource,
    runtimeSource: {
      notification,
      contextMenu,
      projectId,
      lastLoadError,
    },
  });

  return (
    <WorkflowActionsContext.Provider value={actions}>
      <WorkflowContext.Provider value={value}>
        {children}
        <WorkflowSwitchConfirmDialog
          isOpen={switchFlow.dialog.isOpen}
          context={switchFlow.dialog.context}
          isSaving={switchFlow.dialog.isSaving}
          onDecision={switchFlow.dialog.onDecision}
        />
      </WorkflowContext.Provider>
    </WorkflowActionsContext.Provider>
  );
}
