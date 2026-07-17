import { hasMaterializedCanvas } from '@/services/workflow-session';
import type { Workflow } from '@/types';

export function hasMeaningfulWorkflowContent(workflow: Workflow | null | undefined): boolean {
  if (!workflow) {
    return false;
  }

  return Object.keys(workflow.nodes).length > 0 || workflow.connections.length > 0;
}

export function isDraftWithoutMeaningfulWorkflowContent(
  workflow: Workflow | null | undefined,
  hasMeaningfulChanges: boolean = hasMeaningfulWorkflowContent(workflow),
): boolean {
  return Boolean(
    workflow
    && !hasMaterializedCanvas(workflow)
    && !hasMeaningfulChanges,
  );
}

export function shouldConfirmWorkflowSwitch(input: {
  workflow: Workflow | null | undefined;
  isDirty: boolean;
  hasMeaningfulChanges?: boolean;
}): boolean {
  const hasMeaningfulChanges = input.hasMeaningfulChanges ?? hasMeaningfulWorkflowContent(input.workflow);
  if (!input.isDirty) {
    return false;
  }

  if (!hasMeaningfulChanges) {
    return false;
  }

  return !isDraftWithoutMeaningfulWorkflowContent(input.workflow, hasMeaningfulChanges);
}
