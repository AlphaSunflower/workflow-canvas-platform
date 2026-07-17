import type { Workflow, WorkflowSaveOptions } from '@/types';
import { getPersistedWorkflowId } from '@/services/workflow-session';

export type WorkflowAutoSaveReason = 'idle' | 'fallback';
export type WorkflowAutoSavePersistReason = 'auto-idle' | 'auto-fallback';

export interface WorkflowAutoSaveDecisionInput {
  workflow: Workflow | null;
  isDirty: boolean;
  isSaving: boolean;
  hasActiveExecution: boolean;
  previousHadActiveExecution: boolean;
  fileSyncBlockReason: string | null;
  autoSaveEnabled: boolean;
}

export interface WorkflowAutoSaveDecision {
  shouldSave: boolean;
  reason: WorkflowAutoSaveReason | null;
}

export function createWorkflowAutoSaveOptions(
  reason: WorkflowAutoSaveReason,
): WorkflowSaveOptions {
  return {
    force: true,
    silent: true,
    reason: reason === 'idle' ? 'auto-idle' : 'auto-fallback',
  };
}

export async function requestWorkflowAutoSave(
  saveWorkflow: (options?: WorkflowSaveOptions) => Promise<void>,
  reason: WorkflowAutoSaveReason,
): Promise<void> {
  await saveWorkflow(createWorkflowAutoSaveOptions(reason));
}

export function canAutoSaveWorkflow(input: Pick<
  WorkflowAutoSaveDecisionInput,
  'workflow' | 'isDirty' | 'isSaving' | 'fileSyncBlockReason' | 'autoSaveEnabled'
>): boolean {
  return Boolean(
    input.autoSaveEnabled
    && input.workflow
    && getPersistedWorkflowId(input.workflow)
    && input.isDirty
    && !input.isSaving
    && !input.fileSyncBlockReason,
  );
}

export function shouldAutoSaveAfterExecutionIdle(
  input: WorkflowAutoSaveDecisionInput,
): WorkflowAutoSaveDecision {
  if (
    !input.previousHadActiveExecution
    || input.hasActiveExecution
    || !canAutoSaveWorkflow(input)
  ) {
    return {
      shouldSave: false,
      reason: null,
    };
  }

  return {
    shouldSave: true,
    reason: 'idle',
  };
}

export function shouldRunFallbackAutoSave(input: Pick<
  WorkflowAutoSaveDecisionInput,
  'workflow' | 'isDirty' | 'isSaving' | 'fileSyncBlockReason' | 'autoSaveEnabled'
>): WorkflowAutoSaveDecision {
  if (!canAutoSaveWorkflow(input)) {
    return {
      shouldSave: false,
      reason: null,
    };
  }

  return {
    shouldSave: true,
    reason: 'fallback',
  };
}
