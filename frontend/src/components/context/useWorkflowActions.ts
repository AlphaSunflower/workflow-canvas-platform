import { useContext } from 'react';
import { WorkflowActionsContext } from './workflow-actions-context';
import type { WorkflowContextActions } from './workflow-context.types';

export function useWorkflowActions(): WorkflowContextActions {
  const actions = useContext(WorkflowActionsContext);

  if (!actions) {
    throw new Error('useWorkflowActions must be used within a WorkflowProvider');
  }

  return actions;
}
