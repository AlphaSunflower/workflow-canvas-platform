import { useCallback } from 'react';
import { getAuthenticationErrorFeedback } from '@/auth';

interface WorkflowAuthFeedbackDependencies {
  showWarning: (title: string, message: string) => void;
}

export interface WorkflowAuthFeedback {
  showAuthFeedback: (error: unknown, actionLabel: string) => boolean;
}

export function useWorkflowAuthFeedback(
  dependencies: WorkflowAuthFeedbackDependencies,
): WorkflowAuthFeedback {
  const { showWarning } = dependencies;

  const showAuthFeedback = useCallback((error: unknown, actionLabel: string): boolean => {
    const feedback = getAuthenticationErrorFeedback(error, actionLabel);
    if (!feedback) {
      return false;
    }

    showWarning(feedback.title, feedback.message);
    return true;
  }, [showWarning]);

  return {
    showAuthFeedback,
  };
}
