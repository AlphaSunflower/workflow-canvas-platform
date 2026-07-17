import type { FileAssetResponse } from "@newworkflow/backend-shared/api";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import type { WorkflowDetailResponseData } from "@newworkflow/backend-shared/api";

export class ExecutionAccessPolicy {
  assertWorkflowId(workflowId: string | null | undefined): string {
    if (typeof workflowId !== "string" || workflowId.trim().length === 0) {
      throw new Error("INVALID_WORKFLOW_ID");
    }

    return workflowId.trim();
  }

  assertFilesAccessible(
    authenticated: AuthenticatedAccount,
    files: FileAssetResponse[],
  ): void {
    if (authenticated.user.role === "admin") {
      return;
    }

    const unauthorizedFile = files.find((file) => file.userId !== authenticated.user.userId);

    if (unauthorizedFile) {
      throw new Error("FILE_ACCESS_FORBIDDEN");
    }
  }

  assertWorkflowAccessible(
    authenticated: AuthenticatedAccount,
    workflow: WorkflowDetailResponseData | null,
  ): WorkflowDetailResponseData {
    if (!workflow) {
      throw new Error("WORKFLOW_NOT_FOUND");
    }

    if (
      authenticated.user.role !== "admin"
      && workflow.ownerUserId !== authenticated.user.userId
    ) {
      throw new Error("WORKFLOW_ACCESS_FORBIDDEN");
    }

    return workflow;
  }
}
