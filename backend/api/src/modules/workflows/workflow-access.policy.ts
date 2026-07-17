import type {
  WorkflowDetailResponseData,
  WorkflowGroupSummaryItem,
} from "@newworkflow/backend-shared/api";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";

export class WorkflowAccessPolicy {
  canAccessWorkflow(
    authenticated: AuthenticatedAccount,
    ownerUserId: string,
  ): boolean {
    if (authenticated.user.role === "admin") {
      return true;
    }

    return authenticated.user.userId === ownerUserId;
  }

  assertCanAccessWorkflow(
    authenticated: AuthenticatedAccount,
    ownerUserId: string,
  ): void {
    if (!this.canAccessWorkflow(authenticated, ownerUserId)) {
      throw new Error("WORKFLOW_ACCESS_FORBIDDEN");
    }
  }

  assertIsWorkflowOwner(
    authenticated: AuthenticatedAccount,
    ownerUserId: string,
  ): void {
    if (authenticated.user.userId !== ownerUserId) {
      throw new Error("WORKFLOW_ACCESS_FORBIDDEN");
    }
  }

  assertCanAccessGroup(
    authenticated: AuthenticatedAccount,
    group: WorkflowGroupSummaryItem | null,
  ): WorkflowGroupSummaryItem {
    if (!group) {
      throw new Error("WORKFLOW_GROUP_NOT_FOUND");
    }

    if (group.ownerUserId !== authenticated.user.userId) {
      throw new Error("WORKFLOW_ACCESS_FORBIDDEN");
    }

    return group;
  }

  assertCanManageWorkflowDetail(
    authenticated: AuthenticatedAccount,
    workflow: WorkflowDetailResponseData | null,
  ): WorkflowDetailResponseData {
    if (!workflow) {
      throw new Error("WORKFLOW_NOT_FOUND");
    }

    this.assertIsWorkflowOwner(authenticated, workflow.ownerUserId);
    return workflow;
  }

  assertCanUpdateWorkflowDetail(
    authenticated: AuthenticatedAccount,
    workflow: WorkflowDetailResponseData | null,
  ): WorkflowDetailResponseData {
    if (!workflow) {
      throw new Error("WORKFLOW_NOT_FOUND");
    }

    this.assertCanAccessWorkflow(authenticated, workflow.ownerUserId);
    return workflow;
  }
}
