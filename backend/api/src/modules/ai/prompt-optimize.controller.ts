import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import type { ExecutionError } from "@newworkflow/backend-shared";
import {
  ERROR_CODES,
  readJsonBody,
  sendApiError,
  sendApiSuccess,
} from "@newworkflow/backend-shared";
import {
  requireAuth,
  sendForbidden,
} from "../auth/auth.guard.ts";
import { AuthService } from "../auth/auth.service.ts";
import { validatePromptOptimizeRequest } from "./prompt-optimize.dto.ts";
import type { PromptOptimizeCommand } from "./prompt-optimize.contracts.ts";
import { PromptOptimizeService } from "./prompt-optimize.service.ts";

function isExecutionError(error: unknown): error is ExecutionError {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && "message" in error
    && "retryable" in error,
  );
}

function mapPromptOptimizeError(error: string): {
  statusCode: number;
  code: number;
  message: string;
} {
  switch (error) {
    case "INVALID_BODY":
      return { statusCode: 400, code: 40091, message: "Request body must be a JSON object." };
    case "INVALID_WORKFLOW_ID":
      return { statusCode: 400, code: 40092, message: "workflowId is required." };
    case "INVALID_NODE_ID":
      return { statusCode: 400, code: 40093, message: "nodeId is required." };
    case "INVALID_NODE_TYPE":
      return { statusCode: 400, code: 40094, message: "nodeType must be aiImageGen." };
    case "INVALID_PROMPT":
      return { statusCode: 400, code: 40095, message: "prompt is required." };
    case "INVALID_REFERENCE_FILE_IDS":
      return { statusCode: 400, code: 40096, message: "referenceFileIds must be a string array." };
    case "INVALID_REFERENCE_FILE_COUNT":
      return { statusCode: 400, code: 40097, message: "referenceFileIds count must be between 0 and 5." };
    case "REFERENCE_FILE_NOT_IMAGE":
      return { statusCode: 400, code: 40098, message: "All reference files must be images." };
    case "REFERENCE_IMAGE_PROCESS_FAILED":
      return { statusCode: 400, code: 40099, message: "Reference images could not be processed." };
    default:
      return { statusCode: 500, code: 50091, message: "Prompt optimize API internal error." };
  }
}

function mapProviderExecutionError(error: ExecutionError): {
  statusCode: number;
  code: number;
  errorCode: string;
  message: string;
  details?: Record<string, unknown>;
} {
  switch (error.code) {
    case ERROR_CODES.validationError:
      return {
        statusCode: 400,
        code: 40090,
        errorCode: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      };
    case ERROR_CODES.timeout:
      return {
        statusCode: 504,
        code: 50491,
        errorCode: error.code,
        message: "Prompt optimize provider request timed out.",
        ...(error.details ? { details: error.details } : {}),
      };
    case ERROR_CODES.networkError:
      return {
        statusCode: 502,
        code: 50291,
        errorCode: error.code,
        message: "Prompt optimize provider network request failed.",
        ...(error.details ? { details: error.details } : {}),
      };
    case ERROR_CODES.invalidResponse:
      return {
        statusCode: 502,
        code: 50292,
        errorCode: error.code,
        message: "Prompt optimize provider returned an invalid response.",
        ...(error.details ? { details: error.details } : {}),
      };
    case ERROR_CODES.providerError:
      return {
        statusCode: 502,
        code: 50293,
        errorCode: error.code,
        message: "Prompt optimize provider request failed.",
        ...(error.details ? { details: error.details } : {}),
      };
    default:
      return {
        statusCode: 500,
        code: 50092,
        errorCode: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      };
  }
}

export class PromptOptimizeController {
  private readonly promptOptimizeService: PromptOptimizeService;
  private readonly authService: AuthService;

  constructor(
    promptOptimizeService: PromptOptimizeService,
    authService: AuthService,
  ) {
    this.promptOptimizeService = promptOptimizeService;
    this.authService = authService;
  }

  async optimizePrompt(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validatePromptOptimizeRequest(body);
      const command: PromptOptimizeCommand = {
        ...validated,
      };
      const result = await this.getPromptOptimizeService().optimizePromptForActor(
        authenticated,
        command,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private getPromptOptimizeService(): PromptOptimizeService {
    return this.promptOptimizeService;
  }

  private getAuthService(): AuthService {
    return this.authService;
  }

  private handleError(response: ServerResponse, error: unknown): void {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "FILE_ACCESS_FORBIDDEN") {
      sendForbidden(response);
      return;
    }

    if (message.startsWith("FILE_NOT_FOUND:")) {
      sendApiError(response, 404, 40491, "FILE_NOT_FOUND", "Reference file not found.");
      return;
    }

    if (isExecutionError(error)) {
      const mapped = mapProviderExecutionError(error);
      sendApiError(
        response,
        mapped.statusCode,
        mapped.code,
        mapped.errorCode,
        mapped.message,
        mapped.details,
      );
      return;
    }

    const mapped = mapPromptOptimizeError(message);
    sendApiError(response, mapped.statusCode, mapped.code, message, mapped.message);
  }
}
