import { useMemo } from 'react';
import type { WorkflowSwitchFlowController } from './workflow-context.types';
import { useWorkflowSwitchConfirmation } from './useWorkflowSwitchConfirmation';

export function useWorkflowSwitchFlow(): WorkflowSwitchFlowController {
  const confirmation = useWorkflowSwitchConfirmation();

  const dialog = useMemo<WorkflowSwitchFlowController['dialog']>(() => ({
    isOpen: confirmation.pendingSwitchConfirmation !== null,
    context: confirmation.pendingSwitchConfirmation?.context ?? null,
    isSaving: confirmation.isConfirmingSwitchSave,
    onDecision: confirmation.resolveWorkflowSwitchDecision,
  }), [
    confirmation.isConfirmingSwitchSave,
    confirmation.pendingSwitchConfirmation,
    confirmation.resolveWorkflowSwitchDecision,
  ]);

  return {
    dialog,
    requestWorkflowSwitchDecision:
      confirmation.requestWorkflowSwitchDecision,
    runWorkflowSwitchSave: confirmation.runWorkflowSwitchSave,
  };
}
