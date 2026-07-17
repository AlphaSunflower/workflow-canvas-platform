import type {
  AdminExecutionDetailResponseData,
  AdminExecutionListQuery,
  AdminExecutionListResponseData,
  AdminFileListQuery,
  AdminFileListResponseData,
  AdminFileUsageResponseData,
  AdminOverviewResponseData,
  AdminStorageIssueListQuery,
  AdminStorageIssueListResponseData,
  AdminUserListQuery,
  AdminUserListResponseData,
  AdminWorkflowDetailResponseData,
  AdminWorkflowListQuery,
  AdminWorkflowListResponseData,
} from "@newworkflow/backend-shared";
import { AdminRepository } from "./admin.repository.ts";

export class AdminService {
  constructor(private readonly repository: AdminRepository) {}

  async getOverview(): Promise<AdminOverviewResponseData> {
    return this.repository.getOverview();
  }

  async listFiles(query: AdminFileListQuery): Promise<AdminFileListResponseData> {
    return this.repository.listFiles(query);
  }

  async getFileUsage(fileId: string): Promise<AdminFileUsageResponseData> {
    const result = await this.repository.getFileUsage(fileId);

    if (!result) {
      throw new Error("ADMIN_FILE_NOT_FOUND");
    }

    return result;
  }

  async listExecutions(query: AdminExecutionListQuery): Promise<AdminExecutionListResponseData> {
    return this.repository.listExecutions(query);
  }

  async getExecutionDetail(runId: string): Promise<AdminExecutionDetailResponseData> {
    const result = await this.repository.getExecutionDetail(runId);

    if (!result) {
      throw new Error("ADMIN_EXECUTION_NOT_FOUND");
    }

    return result;
  }

  async listWorkflows(query: AdminWorkflowListQuery): Promise<AdminWorkflowListResponseData> {
    return this.repository.listWorkflows(query);
  }

  async getWorkflowDetail(workflowId: string): Promise<AdminWorkflowDetailResponseData> {
    const result = await this.repository.getWorkflowDetail(workflowId);

    if (!result) {
      throw new Error("ADMIN_WORKFLOW_NOT_FOUND");
    }

    return result;
  }

  async listUsers(query: AdminUserListQuery): Promise<AdminUserListResponseData> {
    return this.repository.listUsers(query);
  }

  async listStorageIssues(
    query: AdminStorageIssueListQuery,
  ): Promise<AdminStorageIssueListResponseData> {
    return this.repository.listStorageIssues(query);
  }
}
