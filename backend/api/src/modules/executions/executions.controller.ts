import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import {
  readJsonBody,
  sendApiError,
  sendApiSuccess,
} from "@newworkflow/backend-shared";
import {
  requireAuth,
  sendForbidden,
} from "../auth/auth.guard.ts";
import { AuthService } from "../auth/auth.service.ts";
import type { ExecutionCreateCommand } from "./executions.contracts.ts";
import { validateCreateExecutionRequest } from "./executions.dto.ts";
import { mapCreateExecutionError } from "./execution-node.registry.ts";
import { ExecutionsService } from "./executions.service.ts";

export class ExecutionsController {
  private readonly executionsService: ExecutionsService;
  private readonly authService: AuthService;

  constructor(
    executionsService: ExecutionsService,
    authService: AuthService,
  ) {
    this.executionsService = executionsService;
    this.authService = authService;
  }

  async createExecution(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateCreateExecutionRequest(body);
      const command: ExecutionCreateCommand = validated;
      const result = await this.getExecutionsService().createExecutionForActor(
        authenticated,
        command,
      );
      sendApiSuccess(response, result, 201);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private getExecutionsService(): ExecutionsService {
    return this.executionsService;
  }

  private getAuthService(): AuthService {
    return this.authService;
  }

  private handleError(response: ServerResponse, error: unknown): void {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "FILE_ACCESS_FORBIDDEN" || message === "WORKFLOW_ACCESS_FORBIDDEN") {
      sendForbidden(response);
      return;
    }

    const mapped = mapCreateExecutionError(message)
      ?? { code: 50031, message: "Execution create API internal error." };
    const statusCode = mapped.code >= 50000
      ? 500
      : mapped.code >= 40400
        ? 404
        : mapped.code >= 40300
          ? 403
          : 400;
    const errorCode =
      message.startsWith("FILE_NOT_FOUND:") ? "FILE_NOT_FOUND" : message;

    sendApiError(response, statusCode, mapped.code, errorCode, mapped.message);
  }
}
