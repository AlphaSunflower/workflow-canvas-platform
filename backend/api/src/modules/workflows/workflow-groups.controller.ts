import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import {
  readJsonBody,
  sendApiSuccess,
} from "@newworkflow/backend-shared";
import { requireAuth } from "../auth/auth.guard.ts";
import { AuthService } from "../auth/auth.service.ts";
import type {
  CreateWorkflowGroupCommand,
  RenameWorkflowGroupCommand,
} from "./workflows.contracts.ts";
import {
  validateCreateWorkflowGroupRequest,
  validateRenameWorkflowGroupRequest,
} from "./workflow-groups.dto.ts";
import { validateWorkflowGroupIdParam } from "./workflows.dto.ts";
import { WorkflowsService } from "./workflows.service.ts";

export class WorkflowGroupsController {
  private readonly workflowsService: WorkflowsService;
  private readonly authService: AuthService;
  private readonly handleError: (response: ServerResponse, error: unknown) => void;

  constructor(
    workflowsService: WorkflowsService,
    authService: AuthService,
    handleError: (response: ServerResponse, error: unknown) => void,
  ) {
    this.workflowsService = workflowsService;
    this.authService = authService;
    this.handleError = handleError;
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
      const validated = validateCreateWorkflowGroupRequest(body);
      const command: CreateWorkflowGroupCommand = {
        ...validated,
      };
      const result = await this.getWorkflowsService().createGroupForActor(
        authenticated,
        command,
      );
      sendApiSuccess(response, result, 201);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async rename(
    request: IncomingMessage,
    response: ServerResponse,
    groupId: string,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateRenameWorkflowGroupRequest(body);
      const validatedGroupId = validateWorkflowGroupIdParam(groupId);
      const command: RenameWorkflowGroupCommand = {
        ...validated,
      };
      const result = await this.getWorkflowsService().renameGroupForActor(
        authenticated,
        validatedGroupId,
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
    groupId: string,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const validatedGroupId = validateWorkflowGroupIdParam(groupId);
      const result = await this.getWorkflowsService().deleteGroupForActor(
        authenticated,
        validatedGroupId,
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
}
