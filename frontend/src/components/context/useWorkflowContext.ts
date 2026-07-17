import { useContext } from 'react';
import { WorkflowContext } from './workflow-context';
import type { WorkflowContextValue } from './workflow-context';

export function useWorkflowContext(): WorkflowContextValue {
  const context = useContext(WorkflowContext);

  if (!context) {
    throw new Error('useWorkflowContext must be used within a WorkflowProvider');
  }

  return context;
}
