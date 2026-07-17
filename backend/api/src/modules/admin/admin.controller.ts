import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import {
  sendApiError,
  sendApiSuccess,
} from "@newworkflow/backend-shared";
import { AuthService } from "../auth/auth.service.ts";
import { AdminService } from "./admin.service.ts";
import { requireAdminAccess } from "./admin.guard.ts";
import {
  parseAdminExecutionListQuery,
  parseAdminFileListQuery,
  parseAdminStorageIssueListQuery,
  parseAdminUserListQuery,
  parseAdminWorkflowListQuery,
} from "./admin.dto.ts";

function mapAdminError(error: string): {
  statusCode: number;
  code: number;
  message: string;
} {
  switch (error) {
    case "ADMIN_FILE_NOT_FOUND":
      return { statusCode: 404, code: 40471, message: "File not found." };
    case "ADMIN_EXECUTION_NOT_FOUND":
      return { statusCode: 404, code: 40472, message: "Execution not found." };
    case "ADMIN_WORKFLOW_NOT_FOUND":
      return { statusCode: 404, code: 40473, message: "Workflow not found." };
    default:
      return { statusCode: 500, code: 50071, message: "Admin API internal error." };
  }
}

export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly authService: AuthService,
  ) {}

  async getOverview(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!await this.requireAdmin(request, response)) {
      return;
    }

    try {
      sendApiSuccess(response, await this.adminService.getOverview());
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async listFiles(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    if (!await this.requireAdmin(request, response)) {
      return;
    }

    try {
      sendApiSuccess(response, await this.adminService.listFiles(parseAdminFileListQuery(requestUrl)));
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async getFileUsage(
    request: IncomingMessage,
    response: ServerResponse,
    fileId: string,
  ): Promise<void> {
    if (!await this.requireAdmin(request, response)) {
      return;
    }

    try {
      sendApiSuccess(response, await this.adminService.getFileUsage(fileId));
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async listExecutions(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    if (!await this.requireAdmin(request, response)) {
      return;
    }

    try {
      sendApiSuccess(response, await this.adminService.listExecutions(parseAdminExecutionListQuery(requestUrl)));
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async getExecutionDetail(
    request: IncomingMessage,
    response: ServerResponse,
    runId: string,
  ): Promise<void> {
    if (!await this.requireAdmin(request, response)) {
      return;
    }

    try {
      sendApiSuccess(response, await this.adminService.getExecutionDetail(runId));
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async listWorkflows(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    if (!await this.requireAdmin(request, response)) {
      return;
    }

    try {
      sendApiSuccess(response, await this.adminService.listWorkflows(parseAdminWorkflowListQuery(requestUrl)));
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async getWorkflowDetail(
    request: IncomingMessage,
    response: ServerResponse,
    workflowId: string,
  ): Promise<void> {
    if (!await this.requireAdmin(request, response)) {
      return;
    }

    try {
      sendApiSuccess(response, await this.adminService.getWorkflowDetail(workflowId));
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async listUsers(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    if (!await this.requireAdmin(request, response)) {
      return;
    }

    try {
      sendApiSuccess(response, await this.adminService.listUsers(parseAdminUserListQuery(requestUrl)));
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async listStorageIssues(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    if (!await this.requireAdmin(request, response)) {
      return;
    }

    try {
      sendApiSuccess(response, await this.adminService.listStorageIssues(parseAdminStorageIssueListQuery(requestUrl)));
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private async requireAdmin(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    return Boolean(await requireAdminAccess(request, response, this.authService));
  }

  private handleError(response: ServerResponse, error: unknown): void {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const mapped = mapAdminError(message);
    sendApiError(response, mapped.statusCode, mapped.code, message, mapped.message);
  }
}
