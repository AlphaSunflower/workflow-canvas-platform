import type { Workflow, UUID } from '@/types';
import { generateUUID } from '@/utils';

export function createWorkflowSessionId(): UUID {
  return `draft:${generateUUID()}`;
}

export function isDraftWorkflowId(workflowId: string | null | undefined): boolean {
  return typeof workflowId === 'string' && workflowId.startsWith('draft:');
}

export function isPersistedWorkflow(workflow: Workflow | null | undefined): workflow is Workflow & {
  persistedWorkflowId: UUID;
  persistenceState: 'persisted';
} {
  return Boolean(
    workflow
    && workflow.persistenceState === 'persisted'
    && typeof workflow.persistedWorkflowId === 'string'
    && workflow.persistedWorkflowId.length > 0,
  );
}

export function getPersistedWorkflowId(workflow: Workflow | null | undefined): UUID | null {
  return isPersistedWorkflow(workflow)
    ? workflow.persistedWorkflowId
    : null;
}

export function hasMaterializedCanvas(workflow: Workflow | null | undefined): boolean {
  return Boolean(
    workflow
    && (
      workflow.hasMaterializedCanvas
      || workflow.persistenceState === 'creating'
      || workflow.persistenceState === 'persisted'
    ),
  );
}

export function createDraftWorkflowIdentity(): Pick<
  Workflow,
  'id' | 'persistedWorkflowId' | 'persistenceState' | 'hasMaterializedCanvas'
> {
  return {
    id: createWorkflowSessionId(),
    persistedWorkflowId: undefined,
    persistenceState: 'draft',
    hasMaterializedCanvas: false,
  };
}

