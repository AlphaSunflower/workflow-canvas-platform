import { useCallback, useState } from 'react';
import type {
  PendingWorkflowSwitchConfirmation,
  WorkflowSwitchDecision,
  WorkflowSwitchRequestContext,
} from './workflow-context.types';

export interface WorkflowSwitchConfirmationController {
  pendingSwitchConfirmation: PendingWorkflowSwitchConfirmation | null;
  isConfirmingSwitchSave: boolean;
  requestWorkflowSwitchDecision: (
    context: WorkflowSwitchRequestContext,
  ) => Promise<WorkflowSwitchDecision>;
  resolveWorkflowSwitchDecision: (decision: WorkflowSwitchDecision) => void;
  runWorkflowSwitchSave: <T>(operation: () => Promise<T>) => Promise<T>;
}

export function useWorkflowSwitchConfirmation(): WorkflowSwitchConfirmationController {
  const [pendingSwitchConfirmation, setPendingSwitchConfirmation] = useState<PendingWorkflowSwitchConfirmation | null>(null);
  const [isConfirmingSwitchSave, setIsConfirmingSwitchSave] = useState(false);

  const requestWorkflowSwitchDecision = useCallback((
    context: WorkflowSwitchRequestContext,
  ): Promise<WorkflowSwitchDecision> => {
    return new Promise<WorkflowSwitchDecision>((resolve) => {
      setPendingSwitchConfirmation((previousConfirmation) => {
        previousConfirmation?.resolve('cancel');
        return {
          context,
          resolve,
        };
      });
    });
  }, []);

  const resolveWorkflowSwitchDecision = useCallback((decision: WorkflowSwitchDecision): void => {
    setPendingSwitchConfirmation((currentConfirmation) => {
      if (!currentConfirmation) {
        return null;
      }

      currentConfirmation.resolve(decision);
      return decision === 'save' ? currentConfirmation : null;
    });
  }, []);

  const runWorkflowSwitchSave = useCallback(async <T,>(
    operation: () => Promise<T>,
  ): Promise<T> => {
    setIsConfirmingSwitchSave(true);
    try {
      return await operation();
    } finally {
      setPendingSwitchConfirmation(null);
      setIsConfirmingSwitchSave(false);
    }
  }, []);

  return {
    pendingSwitchConfirmation,
    isConfirmingSwitchSave,
    requestWorkflowSwitchDecision,
    resolveWorkflowSwitchDecision,
    runWorkflowSwitchSave,
  };
}
