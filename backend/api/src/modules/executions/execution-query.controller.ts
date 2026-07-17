import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { URL } from "node:url";

import {
  sendApiError,
  sendApiSuccess,
} from "@newworkflow/backend-shared";
import { requireAuth } from "../auth/auth.guard.ts";
import { AuthService } from "../auth/auth.service.ts";
import { ExecutionQueryService } from "./execution-query.service.ts";

type ExecutionStatusQuery =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

function toOptionalNumber(value: string | null): number | undefined {
  return value ? Number(value) : undefined;
}

function toOptionalSortBy(
  value: string | null,
): "sequence" | "createdAt" | "startedAt" | "completedAt" | undefined {
  if (
    value === "sequence"
    || value === "createdAt"
    || value === "startedAt"
    || value === "completedAt"
  ) {
    return value;
  }

  return undefined;
}

function toOptionalSortOrder(value: string | null): "asc" | "desc" | undefined {
  if (value === "asc" || value === "desc") {
    return value;
  }

  return undefined;
}

export class ExecutionQueryController {
  private readonly executionQueryService: ExecutionQueryService;
  private readonly authService: AuthService;

  constructor(
    executionQueryService: ExecutionQueryService,
    authService: AuthService,
  ) {
    this.executionQueryService = executionQueryService;
    this.authService = authService;
  }

  async handleWorkflowExecutionReconcile(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
    workflowId: string,
  ): Promise<void> {
    const authenticated = await requireAuth(request, response, this.getAuthService());

    if (!authenticated) {
      return;
    }

    const nodeId = requestUrl.searchParams.get("nodeId")?.trim() ?? "";

    if (!workflowId) {
      sendApiError(response, 400, 40082, "INVALID_WORKFLOW_ID", "workflowId is required.");
      return;
    }

    if (!nodeId) {
      sendApiError(response, 400, 40083, "INVALID_NODE_ID", "nodeId is required.");
      return;
    }

    const run = await this.getExecutionQueryService().getLatestCompletedWorkflowNodeRunForActor(
      authenticated,
      workflowId,
      nodeId,
    );

    if (!run) {
      sendApiError(response, 404, 40441, "RUN_NOT_FOUND", "Execution run not found.");
      return;
    }

    sendApiSuccess(response, run);
  }

  async getExecutionRun(
    request: IncomingMessage,
    response: ServerResponse,
    _requestUrl: URL,
    runId: string,
  ): Promise<void> {
    const authenticated = await requireAuth(request, response, this.getAuthService());

    if (!authenticated) {
      return;
    }

    if (!runId) {
      sendApiError(response, 400, 40041, "INVALID_RUN_ID", "runId is required.");
      return;
    }

    const run = await this.getExecutionQueryService().getExecutionRunForActor(authenticated, runId);

    if (!run) {
      sendApiError(response, 404, 40441, "RUN_NOT_FOUND", "Execution run not found.");
      return;
    }

    sendApiSuccess(response, run);
  }

  async listTasks(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    const authenticated = await requireAuth(request, response, this.getAuthService());

    if (!authenticated) {
      return;
    }

    const result = await this.getExecutionQueryService().listTasksForActor(authenticated, {
      runId: requestUrl.searchParams.get("runId") ?? undefined,
      userId: requestUrl.searchParams.get("userId") ?? undefined,
      status: (requestUrl.searchParams.get("status") as ExecutionStatusQuery | null) ?? undefined,
      page: toOptionalNumber(requestUrl.searchParams.get("page")),
      pageSize: toOptionalNumber(requestUrl.searchParams.get("pageSize")),
    });

    sendApiSuccess(response, result);
  }

  async getTask(
    request: IncomingMessage,
    response: ServerResponse,
    _requestUrl: URL,
    taskId: string,
  ): Promise<void> {
    const authenticated = await requireAuth(request, response, this.getAuthService());

    if (!authenticated) {
      return;
    }

    const task = await this.getExecutionQueryService().getTaskDetailForActor(
      authenticated,
      taskId,
    );

    if (!task) {
      sendApiError(response, 404, 40442, "TASK_NOT_FOUND", "Task not found.");
      return;
    }

    sendApiSuccess(response, task);
  }

  async getTaskEvents(
    request: IncomingMessage,
    response: ServerResponse,
    _requestUrl: URL,
    taskId: string,
  ): Promise<void> {
    const authenticated = await requireAuth(request, response, this.getAuthService());

    if (!authenticated) {
      return;
    }

    const events = await this.getExecutionQueryService().getTaskEventsForActor(
      authenticated,
      taskId,
    );

    if (!events) {
      sendApiError(response, 404, 40442, "TASK_NOT_FOUND", "Task not found.");
      return;
    }

    sendApiSuccess(response, events);
  }

  async listWorkflowTasks(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
    workflowId: string,
  ): Promise<void> {
    const authenticated = await requireAuth(request, response, this.getAuthService());

    if (!authenticated) {
      return;
    }

    if (!workflowId) {
      sendApiError(response, 400, 40082, "INVALID_WORKFLOW_ID", "workflowId is required.");
      return;
    }

    const result = await this.getExecutionQueryService().listWorkflowTasksForActor(
      authenticated,
      workflowId,
      {
        runId: requestUrl.searchParams.get("runId") ?? undefined,
        status: (requestUrl.searchParams.get("status") as ExecutionStatusQuery | null)
          ?? undefined,
        nodeId: requestUrl.searchParams.get("nodeId") ?? undefined,
        nodeType: requestUrl.searchParams.get("nodeType") ?? undefined,
        taskType: requestUrl.searchParams.get("taskType") ?? undefined,
        page: toOptionalNumber(requestUrl.searchParams.get("page")),
        pageSize: toOptionalNumber(requestUrl.searchParams.get("pageSize")),
        sortBy: toOptionalSortBy(requestUrl.searchParams.get("sortBy")),
        sortOrder: toOptionalSortOrder(requestUrl.searchParams.get("sortOrder")),
      },
    );

    if (!result) {
      sendApiError(response, 404, 40481, "WORKFLOW_NOT_FOUND", "Workflow not found.");
      return;
    }

    sendApiSuccess(response, result);
  }

  async getWorkflowTask(
    request: IncomingMessage,
    response: ServerResponse,
    _requestUrl: URL,
    workflowId: string,
    taskId: string,
  ): Promise<void> {
    const authenticated = await requireAuth(request, response, this.getAuthService());

    if (!authenticated) {
      return;
    }

    if (!workflowId) {
      sendApiError(response, 400, 40082, "INVALID_WORKFLOW_ID", "workflowId is required.");
      return;
    }

    const task = await this.getExecutionQueryService().getWorkflowTaskDetailForActor(
      authenticated,
      workflowId,
      taskId,
    );

    if (!task) {
      sendApiError(response, 404, 40442, "TASK_NOT_FOUND", "Task not found.");
      return;
    }

    sendApiSuccess(response, task);
  }

  async getWorkflowTaskEvents(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
    workflowId: string,
    taskId: string,
  ): Promise<void> {
    const authenticated = await requireAuth(request, response, this.getAuthService());

    if (!authenticated) {
      return;
    }

    if (!workflowId) {
      sendApiError(response, 400, 40082, "INVALID_WORKFLOW_ID", "workflowId is required.");
      return;
    }

    const events = await this.getExecutionQueryService().getWorkflowTaskEventsForActor(
      authenticated,
      workflowId,
      taskId,
      {
        page: toOptionalNumber(requestUrl.searchParams.get("page")),
        pageSize: toOptionalNumber(requestUrl.searchParams.get("pageSize")),
        sortOrder: toOptionalSortOrder(requestUrl.searchParams.get("sortOrder")),
      },
    );

    if (!events) {
      sendApiError(response, 404, 40442, "TASK_NOT_FOUND", "Task not found.");
      return;
    }

    sendApiSuccess(response, events);
  }

  private getExecutionQueryService(): ExecutionQueryService {
    return this.executionQueryService;
  }

  private getAuthService(): AuthService {
    return this.authService;
  }
}
