import { workflowApi } from '@/api';
import type {
  FileNodeData,
  Workflow,
  WorkflowSaveOptions,
} from '@/types';
import {
  assertExecutionFilesReady,
  ensureExecutionFilesReady,
} from '@/services/execution-file-readiness';
import {
  getPersistedWorkflowId,
  hasMaterializedCanvas,
  isPersistedWorkflow,
} from '@/services/workflow-session';
import { isFileNodeData } from '@/utils';
import type { WorkflowAuthoritativeWorkflowSupplier } from './workflow-context.types';
import { materializeWorkflowSession } from './workflow-materialization';

export interface WorkflowSaveOrchestratorCommitDependencies {
  commitPersistedWorkflow: (workflow: Workflow) => Workflow | null;
}

export interface WorkflowSaveOrchestratorDependencies {
  getAuthoritativeWorkflow: WorkflowAuthoritativeWorkflowSupplier;
  materializeDraftWorkflow: () => Promise<Workflow>;
  persistWorkflow: (
    workflow: Workflow,
    options?: WorkflowSaveOptions,
  ) => Promise<Workflow>;
  commit: WorkflowSaveOrchestratorCommitDependencies;
}

export interface WorkflowSaveOrchestrator {
  saveAuthoritativeWorkflow: (
    options?: WorkflowSaveOptions,
  ) => Promise<Workflow | null>;
}

function buildWorkflowForSave(
  workflow: Workflow,
  updatedAt: number,
): Workflow {
  return {
    ...workflow,
    timestamp: {
      ...workflow.timestamp,
      updated: updatedAt,
    },
  };
}

async function ensureWorkflowSaveReady(
  workflow: Workflow,
): Promise<void> {
  const fileNodes = Object.values(workflow.nodes).filter(
    (node): node is FileNodeData => isFileNodeData(node),
  );
  if (fileNodes.length === 0) {
    return;
  }

  const readiness = await ensureExecutionFilesReady(
    workflow,
    fileNodes,
  );
  assertExecutionFilesReady(workflow, readiness);
}

export async function persistWorkflowViaApi(
  nextWorkflow: Workflow,
): Promise<Workflow> {
  await ensureWorkflowSaveReady(nextWorkflow);

  const result = await workflowApi.save(nextWorkflow);
  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

export function createWorkflowSaveOrchestrator(
  dependencies: WorkflowSaveOrchestratorDependencies,
): WorkflowSaveOrchestrator {
  const ensurePersistedAuthoritativeWorkflow = async (): Promise<Workflow> => {
    const activeWorkflow = dependencies.getAuthoritativeWorkflow();
    if (!activeWorkflow) {
      throw new Error('No workflow is available to save.');
    }

    if (isPersistedWorkflow(activeWorkflow) && hasMaterializedCanvas(activeWorkflow)) {
      return activeWorkflow;
    }

    return dependencies.materializeDraftWorkflow();
  };

  const savePreparedWorkflow = async (
    nextWorkflow: Workflow,
    options?: WorkflowSaveOptions,
  ): Promise<Workflow | null> => {
    const savedWorkflow = await dependencies.persistWorkflow(
      nextWorkflow,
      options,
    );
    return dependencies.commit.commitPersistedWorkflow(savedWorkflow);
  };

  return {
    async saveAuthoritativeWorkflow(
      options?: WorkflowSaveOptions,
    ): Promise<Workflow | null> {
      const activeWorkflow = await ensurePersistedAuthoritativeWorkflow();

      if (!getPersistedWorkflowId(activeWorkflow)) {
        return null;
      }

      const updatedWorkflow = buildWorkflowForSave(
        activeWorkflow,
        Date.now(),
      );
      return savePreparedWorkflow(updatedWorkflow, options);
    },
  };
}

export interface CreateWorkflowMaterializeDraftOrchestratorDependencies {
  getAuthoritativeWorkflow: WorkflowAuthoritativeWorkflowSupplier;
  createBlankWorkflow: Parameters<typeof materializeWorkflowSession>[0]['createBlankWorkflow'];
  persistWorkflowViaApi: (workflow: Workflow) => Promise<Workflow>;
  commitMaterializedWorkflow: (workflow: Workflow) => void;
}

export async function materializeDraftWorkflowViaOrchestrator(
  dependencies: CreateWorkflowMaterializeDraftOrchestratorDependencies,
): Promise<Workflow> {
  return materializeWorkflowSession({
    getCurrentWorkflow: dependencies.getAuthoritativeWorkflow,
    createBlankWorkflow: dependencies.createBlankWorkflow,
    persistWorkflow: dependencies.persistWorkflowViaApi,
    commitWorkflow: dependencies.commitMaterializedWorkflow,
  });
}
