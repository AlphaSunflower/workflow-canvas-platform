import type { UseWorkflowReturn } from '../../hooks/workflow/useWorkflow';
import type { WorkflowRuntimeSnapshot } from '@/contracts/workflow';
import type { Workflow } from '@/types';
import type {
  WorkflowContextActions,
  WorkflowContextSelectors,
  WorkflowContextState,
  WorkflowContextValue,
} from './workflow-context.types';
import { WORKFLOW_CONTEXT_MESSAGES } from './workflow-context.messages';
import { flushCanvasRuntimeSync } from '../canvas/canvas-runtime-sync-flush';

type WorkflowStateInput = Pick<
  UseWorkflowReturn,
  | 'workflow'
  | 'hydrationVersion'
  | 'hydrationState'
  | 'isLoaded'
  | 'isDirty'
  | 'lastSavedAt'
  | 'nodes'
  | 'connections'
  | 'viewport'
  | 'metadata'
  | 'nodeCount'
  | 'connectionCount'
  | 'persistenceState'
  | 'hasMaterializedCanvas'
  | 'persistedWorkflowId'
  | 'markDirty'
  | 'markClean'
>;

interface CreateWorkflowProviderStateSourceInput {
  workflow: WorkflowStateInput;
  persistence: Pick<
    WorkflowContextState,
    'isSaving' | 'lastSaveError' | 'lastSavedAt'
  >;
  hasActiveNodeExecution: boolean;
  taskHistory: WorkflowContextState['taskHistory'];
}

interface CreateWorkflowProviderActionSourceInput {
  lifecycleActions: Pick<
    WorkflowContextActions,
    'createWorkflow' | 'loadWorkflow' | 'refreshWorkflow'
  >;
  workflowActions: Pick<
    WorkflowContextActions,
    'patchCurrentWorkflow' | 'resetWorkflow' | 'markDirty' | 'markClean'
  > & {
    getCurrentWorkflow: () => Workflow | null;
    applyRuntimeSnapshot: (
      runtimeSnapshot: WorkflowRuntimeSnapshot,
      options?: Parameters<UseWorkflowReturn['syncRuntimeState']>[1],
    ) => Workflow | null;
  };
  persistenceActions: Pick<
    WorkflowContextActions,
    | 'confirmBeforeWorkflowSwitch'
    | 'ensureMaterializedWorkflow'
    | 'saveWorkflow'
  >;
  fileActions: Pick<
    WorkflowContextActions,
    | 'exportLocalArchive'
    | 'importLocalArchive'
    | 'exportFileNode'
    | 'rebindLocalFileNodeSource'
  >;
  executionActions: Pick<
    WorkflowContextActions,
    | 'optimizeAIImageGenPrompt'
    | 'runNodeAction'
    | 'patchNodeConfig'
    | 'runAINode'
    | 'cancelAINodeRun'
  >;
}

export interface WorkflowProviderSources {
  stateSource: WorkflowContextState;
  actionSource: WorkflowContextActions;
  selectorSource: WorkflowContextSelectors;
  runtimeSource: WorkflowContextValue['runtime'];
}

function getWorkflowSaveBlockedReason(input: {
  isSaving: boolean;
  hasActiveNodeExecution: boolean;
}): string | null {
  if (input.isSaving) {
    return WORKFLOW_CONTEXT_MESSAGES.saveBlockedWhileSaving;
  }

  if (input.hasActiveNodeExecution) {
    return WORKFLOW_CONTEXT_MESSAGES.saveBlockedDuringExecution;
  }

  return null;
}

export function createWorkflowProviderStateSource(
  input: CreateWorkflowProviderStateSourceInput,
): WorkflowContextState {
  const saveBlockedReason = getWorkflowSaveBlockedReason({
    isSaving: input.persistence.isSaving,
    hasActiveNodeExecution: input.hasActiveNodeExecution,
  });

  return {
    workflow: input.workflow.workflow,
    hydrationVersion: input.workflow.hydrationVersion,
    hydrationState: input.workflow.hydrationState,
    isLoaded: input.workflow.isLoaded,
    isDirty: input.workflow.isDirty,
    isSaving: input.persistence.isSaving,
    lastSaveError: input.persistence.lastSaveError,
    canSave: saveBlockedReason === null,
    saveBlockedReason,
    lastSavedAt: input.persistence.lastSavedAt ?? input.workflow.lastSavedAt,
    relatedTasks: input.workflow.metadata?.relatedTasks ?? [],
    taskHistory: input.taskHistory,
    nodes: input.workflow.nodes,
    connections: input.workflow.connections,
    viewport: input.workflow.viewport,
    metadata: input.workflow.metadata,
    nodeCount: input.workflow.nodeCount,
    connectionCount: input.workflow.connectionCount,
    persistenceState: input.workflow.persistenceState,
    hasMaterializedCanvas: input.workflow.hasMaterializedCanvas,
    persistedWorkflowId: input.workflow.persistedWorkflowId,
    workflowGroupId:
      input.workflow.workflow?.workflowGroupId
      ?? input.workflow.workflow?.groupId
      ?? null,
    isAutoNamed: input.workflow.workflow?.isAutoNamed ?? false,
  };
}

export function createWorkflowProviderActionSource(
  input: CreateWorkflowProviderActionSourceInput,
): WorkflowContextActions {
  return {
    createWorkflow: input.lifecycleActions.createWorkflow,
    loadWorkflow: input.lifecycleActions.loadWorkflow,
    patchCurrentWorkflow: input.workflowActions.patchCurrentWorkflow,
    confirmBeforeWorkflowSwitch:
      input.persistenceActions.confirmBeforeWorkflowSwitch,
    refreshWorkflow: input.lifecycleActions.refreshWorkflow,
    ensureMaterializedWorkflow:
      input.persistenceActions.ensureMaterializedWorkflow,
    saveWorkflow: input.persistenceActions.saveWorkflow,
    syncRuntimeSnapshot: (runtimeSnapshot, options) => {
      const flushedWorkflow = flushCanvasRuntimeSync({
        reason: options?.runtimeSnapshotMeta?.scope ?? 'canvas-structural-sync-request',
        force: options?.hydrateCanvas,
        allowNodeShrink: options?.runtimeSnapshotMeta?.allowNodeShrink,
        runtimeSnapshot,
        runtimeSyncOptions: options,
      });

      return (flushedWorkflow as Workflow | null) ?? input.workflowActions.getCurrentWorkflow();
    },
    exportLocalArchive: input.fileActions.exportLocalArchive,
    importLocalArchive: input.fileActions.importLocalArchive,
    updateRuntimeSnapshot: input.workflowActions.applyRuntimeSnapshot,
    resetWorkflow: input.workflowActions.resetWorkflow,
    markDirty: input.workflowActions.markDirty,
    markClean: input.workflowActions.markClean,
    exportFileNode: input.fileActions.exportFileNode,
    rebindLocalFileNodeSource: input.fileActions.rebindLocalFileNodeSource,
    optimizeAIImageGenPrompt:
      input.executionActions.optimizeAIImageGenPrompt,
    runNodeAction: input.executionActions.runNodeAction,
    patchNodeConfig: input.executionActions.patchNodeConfig,
    runAINode: input.executionActions.runAINode,
    cancelAINodeRun: input.executionActions.cancelAINodeRun,
  };
}

export function createWorkflowProviderSelectorSource(input: {
  selectors: Omit<WorkflowContextSelectors, 'canRunNode'>;
  canRunNode: WorkflowContextSelectors['canRunNode'];
}): WorkflowContextSelectors {
  return {
    ...input.selectors,
    canRunNode: input.canRunNode,
  };
}
