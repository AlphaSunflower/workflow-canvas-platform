import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import {
  readJsonBody,
  sendApiError,
  sendApiSuccess,
} from "@newworkflow/backend-shared";
import { requireAuth, sendForbidden } from "../auth/auth.guard.ts";
import { AuthService } from "../auth/auth.service.ts";
import { WorkflowGroupsController } from "./workflow-groups.controller.ts";
import type {
  CreateBlankWorkflowCommand,
  CreateWorkflowCommand,
  MoveWorkflowGroupCommand,
  RenameWorkflowCommand,
  UpdateWorkflowCommand,
} from "./workflows.contracts.ts";
import {
  validateCreateBlankWorkflowRequest,
  validateCreateWorkflowRequest,
  validateMoveWorkflowGroupRequest,
  validateRenameWorkflowRequest,
  validateUpdateWorkflowRequest,
  validateWorkflowIdParam,
} from "./workflows.dto.ts";
import { WorkflowsService } from "./workflows.service.ts";

function mapWorkflowsError(error: string): {
  statusCode: number;
  code: number;
  message: string;
} {
  switch (error) {
    case "INVALID_BODY":
      return { statusCode: 400, code: 40081, message: "请求体必须为 JSON 对象。" };
    case "INVALID_WORKFLOW_ID":
      return { statusCode: 400, code: 40082, message: "workflowId 不能为空。" };
    case "INVALID_PROJECT_ID":
      return { statusCode: 400, code: 40083, message: "projectId 不能为空。" };
    case "INVALID_WORKFLOW_NAME":
      return { statusCode: 400, code: 40084, message: "name 不能为空且长度不能超过 120。" };
    case "INVALID_NODES":
      return { statusCode: 400, code: 40085, message: "nodes 必须为对象。" };
    case "INVALID_CONNECTIONS":
      return { statusCode: 400, code: 40086, message: "connections 必须为数组。" };
    case "INVALID_VIEWPORT":
      return { statusCode: 400, code: 40087, message: "viewport 字段无效。" };
    case "INVALID_METADATA":
      return { statusCode: 400, code: 40088, message: "metadata 必须为对象。" };
    case "INVALID_TIMESTAMP":
      return { statusCode: 400, code: 40089, message: "timestamp 必须为数字。" };
    case "INVALID_VERSION":
      return { statusCode: 400, code: 40090, message: "version 必须为数字。" };
    case "INVALID_GROUP_ID":
      return { statusCode: 400, code: 40091, message: "groupId 无效。" };
    case "INVALID_GROUP_NAME":
      return { statusCode: 400, code: 40092, message: "group name 不能为空且长度不能超过 120。" };
    case "WORKFLOW_NOT_FOUND":
      return { statusCode: 404, code: 40481, message: "未找到对应画布。" };
    case "WORKFLOW_GROUP_NOT_FOUND":
      return { statusCode: 404, code: 40482, message: "未找到对应画布分组。" };
    case "WORKFLOW_ALREADY_EXISTS":
      return { statusCode: 409, code: 40981, message: "workflowId 已存在。" };
    case "WORKFLOW_NAME_CONFLICT_RESOLVE_FAILED":
      return { statusCode: 409, code: 40982, message: "画布重命名冲突修正失败。" };
    case "WORKFLOW_STORE_LOCK_TIMEOUT":
      return { statusCode: 503, code: 50381, message: "画布存储暂时繁忙，请稍后重试。" };
    case "WORKFLOW_GROUP_STORE_LOCK_TIMEOUT":
      return { statusCode: 503, code: 50382, message: "画布分组存储暂时繁忙，请稍后重试。" };
    case "WORKFLOW_FILE_BINDINGS_LOCK_TIMEOUT":
      return { statusCode: 503, code: 50383, message: "画布文件绑定存储暂时繁忙，请稍后重试。" };
    default:
      return { statusCode: 500, code: 50081, message: "画布接口内部错误。" };
  }
}

export class WorkflowsController {
  private readonly workflowsService: WorkflowsService;
  private readonly authService: AuthService;
  private workflowGroupsController: WorkflowGroupsController | null = null;

  constructor(
    workflowsService: WorkflowsService,
    authService: AuthService,
  ) {
    this.workflowsService = workflowsService;
    this.authService = authService;
  }

  async list(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const result = await this.getWorkflowsService().listWorkflowsForActor(authenticated);
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async listManaged(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const result = await this.getWorkflowsService().listManagedWorkflowsForActor(authenticated);
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async create(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateCreateWorkflowRequest(body);
      const command: CreateWorkflowCommand = {
        ...validated,
      };
      const result = await this.getWorkflowsService().createWorkflowForActor(
        authenticated,
        command,
      );
      sendApiSuccess(response, result, 201);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async createBlank(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateCreateBlankWorkflowRequest(body);
      const command: CreateBlankWorkflowCommand = {
        ...validated,
      };
      const result = await this.getWorkflowsService().createBlankWorkflowForActor(
        authenticated,
        command,
      );
      sendApiSuccess(response, result, 201);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async get(
    request: IncomingMessage,
    response: ServerResponse,
    workflowId: string,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const validatedWorkflowId = validateWorkflowIdParam(workflowId);
      const result = await this.getWorkflowsService().getWorkflowForActor(
        authenticated,
        validatedWorkflowId,
      );

      if (!result) {
        sendApiError(response, 404, 40481, "WORKFLOW_NOT_FOUND", "未找到对应画布。");
        return;
      }

      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async update(
    request: IncomingMessage,
    response: ServerResponse,
    workflowId: string,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateUpdateWorkflowRequest(body);
      const validatedWorkflowId = validateWorkflowIdParam(workflowId);
      const command: UpdateWorkflowCommand = {
        ...validated,
      };
      const result = await this.getWorkflowsService().updateWorkflowForActor(
        authenticated,
        validatedWorkflowId,
        command,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async rename(
    request: IncomingMessage,
    response: ServerResponse,
    workflowId: string,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateRenameWorkflowRequest(body);
      const validatedWorkflowId = validateWorkflowIdParam(workflowId);
      const command: RenameWorkflowCommand = {
        ...validated,
      };
      const result = await this.getWorkflowsService().renameWorkflowForActor(
        authenticated,
        validatedWorkflowId,
        command,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async moveGroup(
    request: IncomingMessage,
    response: ServerResponse,
    workflowId: string,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateMoveWorkflowGroupRequest(body);
      const validatedWorkflowId = validateWorkflowIdParam(workflowId);
      const command: MoveWorkflowGroupCommand = {
        ...validated,
      };
      const result = await this.getWorkflowsService().moveWorkflowGroupForActor(
        authenticated,
        validatedWorkflowId,
        command,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async delete(
    request: IncomingMessage,
    response: ServerResponse,
    workflowId: string,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const validatedWorkflowId = validateWorkflowIdParam(workflowId);
      const result = await this.getWorkflowsService().deleteWorkflowForActor(
        authenticated,
        validatedWorkflowId,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private getWorkflowsService(): WorkflowsService {
    return this.workflowsService;
  }

  private getAuthService(): AuthService {
    return this.authService;
  }

  private getWorkflowGroupsController(): WorkflowGroupsController {
    if (!this.workflowGroupsController) {
      this.workflowGroupsController = new WorkflowGroupsController(
        this.workflowsService,
        this.authService,
        (response, error) => this.handleError(response, error),
      );
    }

    return this.workflowGroupsController;
  }

  async createGroup(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    return this.getWorkflowGroupsController().create(request, response);
  }

  async renameGroup(
    request: IncomingMessage,
    response: ServerResponse,
    groupId: string,
  ): Promise<void> {
    return this.getWorkflowGroupsController().rename(request, response, groupId);
  }

  async deleteGroup(
    request: IncomingMessage,
    response: ServerResponse,
    groupId: string,
  ): Promise<void> {
    return this.getWorkflowGroupsController().delete(request, response, groupId);
  }

  private handleError(response: ServerResponse, error: unknown): void {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "WORKFLOW_ACCESS_FORBIDDEN") {
      sendForbidden(response);
      return;
    }

    const mapped = mapWorkflowsError(message);
    sendApiError(response, mapped.statusCode, mapped.code, message, mapped.message);
  }
}
