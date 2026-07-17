import type { AuthStatus } from '@/auth';
import type { Workflow } from '@/types';

export function shouldBootstrapBlankWorkflow(input: {
  authStatus: AuthStatus;
  workflow: Workflow | null | undefined;
}): boolean {
  if (input.authStatus === 'restoring' || input.authStatus === 'refreshing') {
    return false;
  }

  return !input.workflow;
}
