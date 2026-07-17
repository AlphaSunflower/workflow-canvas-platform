import type { Workflow } from '@/types';
import { createError } from '@/utils';
import { createBlankWorkflowPayload } from '@/services/workflow-file-normalizer';
import { getPersistedWorkflowId, isPersistedWorkflow } from '@/services/workflow-session';

const FRONTEND_DEFAULT_DRAFT_NAME = '未命名工作流';

export interface EnsureMaterializedDependencies {
  getCurrentWorkflow: () => Workflow | null;
  createBlankWorkflow: (request: ReturnType<typeof createBlankWorkflowPayload>) => Promise<Workflow>;
  persistWorkflow: (workflow: Workflow) => Promise<Workflow>;
  commitWorkflow: (workflow: Workflow) => void;
}

export function shouldUseBackendDefaultWorkflowName(workflow: Workflow): boolean {
  return workflow.isAutoNamed === true || workflow.name.trim() === FRONTEND_DEFAULT_DRAFT_NAME;
}

export async function materializeWorkflowSession(
  dependencies: EnsureMaterializedDependencies,
): Promise<Workflow> {
  const activeWorkflow = dependencies.getCurrentWorkflow();
  if (!activeWorkflow) {
    throw createError('WORKFLOW_ERROR', 'No workflow is available to materialize.', {
      module: 'workflow-materialization',
      operation: 'materializeWorkflowSession',
      timestamp: Date.now(),
    });
  }

  if (isPersistedWorkflow(activeWorkflow)) {
    return activeWorkflow;
  }

  const blankWorkflow = await dependencies.createBlankWorkflow(
    createBlankWorkflowPayload({
      id: undefined,
      projectId: activeWorkflow.projectId,
      name: shouldUseBackendDefaultWorkflowName(activeWorkflow)
        ? undefined
        : activeWorkflow.name,
      groupId: activeWorkflow.workflowGroupId ?? activeWorkflow.groupId ?? null,
      viewport: activeWorkflow.viewport,
      metadata: activeWorkflow.metadata as unknown as Record<string, unknown>,
      timestamp: activeWorkflow.timestamp.updated,
      version: activeWorkflow.version,
    }),
  );

  const persistedWorkflowId = getPersistedWorkflowId(blankWorkflow) ?? blankWorkflow.id;
  const workflowToPersist: Workflow = {
    ...activeWorkflow,
    id: persistedWorkflowId,
    persistedWorkflowId,
    version: blankWorkflow.version,
    ownerUserId: blankWorkflow.ownerUserId,
    groupId: blankWorkflow.groupId,
    workflowGroupId: blankWorkflow.workflowGroupId ?? blankWorkflow.groupId ?? null,
    containerKey: blankWorkflow.containerKey,
    isAutoNamed: blankWorkflow.isAutoNamed,
    persistenceState: 'persisted',
    hasMaterializedCanvas: true,
    createdAt: blankWorkflow.createdAt,
    updatedAt: blankWorkflow.updatedAt,
    timestamp: {
      created: activeWorkflow.timestamp.created,
      updated: Date.now(),
    },
  };

  const savedWorkflow = await dependencies.persistWorkflow(workflowToPersist);
  dependencies.commitWorkflow(savedWorkflow);
  return savedWorkflow;
}
