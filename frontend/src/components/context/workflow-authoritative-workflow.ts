import type { Workflow } from '@/types';
import { normalizeWorkflowNodeIdMetadata } from '@/utils';
import type { WorkflowAuthoritativeWorkflowSupplier } from './workflow-context.types';

interface WorkflowRefLike {
  current: Workflow | null;
}

export function getAuthoritativeWorkflowFromRef(
  workflowRef: WorkflowRefLike,
): Workflow | null {
  return workflowRef.current;
}

export function createAuthoritativeWorkflowSupplier(
  workflowRef: WorkflowRefLike,
): WorkflowAuthoritativeWorkflowSupplier {
  return () => getAuthoritativeWorkflowFromRef(workflowRef);
}

export function createAuthoritativeWorkflowExportProjection(
  workflow: Workflow,
  exportedAt: number = Date.now(),
): Workflow {
  return {
    ...workflow,
    metadata: normalizeWorkflowNodeIdMetadata(
      workflow.metadata,
      workflow.nodes,
    ),
    timestamp: {
      ...workflow.timestamp,
      updated: exportedAt,
    },
  };
}
