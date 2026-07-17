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
import { validateStoryboardArrangeRequest } from "./storyboard-arrange.dto.ts";
import type { StoryboardArrangeCommand } from "./storyboard-arrange.contracts.ts";
import { StoryboardArrangeService } from "./storyboard-arrange.service.ts";

function isExecutionError(error: unknown): error is ExecutionError {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && "message" in error
    && "retryable" in error,
  );
}

function mapStoryboardArrangeError(error: string): {
  statusCode: number;
  code: number;
  message: string;
} {
  switch (error) {
    case "INVALID_BODY":
      return { statusCode: 400, code: 40111, message: "Request body must be a JSON object." };
    case "INVALID_WORKFLOW_ID":
      return { statusCode: 400, code: 40112, message: "workflowId is required." };
    case "INVALID_NODE_ID":
      return { statusCode: 400, code: 40113, message: "nodeId is required." };
    case "INVALID_NODE_TYPE":
      return { statusCode: 400, code: 40114, message: "nodeType must be aiStoryboard." };
    case "INVALID_SHOTS":
      return { statusCode: 400, code: 40115, message: "shots must be a non-empty array." };
    case "INVALID_SHOT_ID":
      return { statusCode: 400, code: 40116, message: "shots[].shotId is required." };
    case "INVALID_SHOT_ORDER":
      return { statusCode: 400, code: 40117, message: "shots[].order must be a positive number." };
    case "INVALID_IMAGE_FILE_ID":
      return { statusCode: 400, code: 40118, message: "shots[].imageFileId is required." };
    case "DUPLICATE_SHOT_ID":
      return { statusCode: 400, code: 40119, message: "shots[].shotId must be unique." };
    case "SHOT_FILE_NOT_IMAGE":
      return { statusCode: 400, code: 40120, message: "All shot files must be images." };
    case "SHOT_IMAGE_PROCESS_FAILED":
      return { statusCode: 400, code: 40121, message: "Shot images could not be processed." };
    case "SHOT_FILE_STORE_BUSY":
    case "FILE_STORE_LOCK_TIMEOUT":
      return { statusCode: 503, code: 50311, message: "Shot image store is busy. Try again after uploads finish." };
    case "INVALID_PROVIDER_RESULT_JSON":
    case "INVALID_PROVIDER_RESULT_ARRAY":
    case "INVALID_PROVIDER_RESULT_ITEM":
    case "INVALID_PROVIDER_RESULT_SHOT_ID":
    case "INVALID_PROVIDER_RESULT_ORDER":
    case "INVALID_PROVIDER_RESULT_PROMPT":
    case "UNKNOWN_PROVIDER_RESULT_SHOT_ID":
    case "INVALID_PROVIDER_RESULT_LENGTH":
    case "DUPLICATE_PROVIDER_RESULT_SHOT_ID":
    case "DUPLICATE_PROVIDER_RESULT_ORDER":
    case "INVALID_PROVIDER_RESULT_ORDER_RANGE":
      return { statusCode: 502, code: 50211, message: "Storyboard arrange provider returned an invalid result." };
    default:
      return { statusCode: 500, code: 50111, message: "Storyboard arrange API internal error." };
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
        code: 40110,
        errorCode: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      };
    case ERROR_CODES.timeout:
      return {
        statusCode: 504,
        code: 50411,
        errorCode: error.code,
        message: "Storyboard arrange provider request timed out.",
        ...(error.details ? { details: error.details } : {}),
      };
    case ERROR_CODES.networkError:
      return {
        statusCode: 502,
        code: 50212,
        errorCode: error.code,
        message: "Storyboard arrange provider network request failed.",
        ...(error.details ? { details: error.details } : {}),
      };
    case ERROR_CODES.invalidResponse:
      return {
        statusCode: 502,
        code: 50213,
        errorCode: error.code,
        message: "Storyboard arrange provider returned an invalid response.",
        ...(error.details ? { details: error.details } : {}),
      };
    case ERROR_CODES.providerError:
      return {
        statusCode: 502,
        code: 50214,
        errorCode: error.code,
        message: "Storyboard arrange provider request failed.",
        ...(error.details ? { details: error.details } : {}),
      };
    default:
      return {
        statusCode: 500,
        code: 50112,
        errorCode: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      };
  }
}

export class StoryboardArrangeController {
  private readonly storyboardArrangeService: StoryboardArrangeService;
  private readonly authService: AuthService;

  constructor(
    storyboardArrangeService: StoryboardArrangeService,
    authService: AuthService,
  ) {
    this.storyboardArrangeService = storyboardArrangeService;
    this.authService = authService;
  }

  async arrangeStoryboard(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateStoryboardArrangeRequest(body);
      const command: StoryboardArrangeCommand = {
        ...validated,
      };
      const result = await this.getStoryboardArrangeService().arrangeShotsForActor(
        authenticated,
        command,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private getStoryboardArrangeService(): StoryboardArrangeService {
    return this.storyboardArrangeService;
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
      sendApiError(response, 404, 40411, "FILE_NOT_FOUND", "Shot image file not found.");
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

    const mapped = mapStoryboardArrangeError(message);
    sendApiError(response, mapped.statusCode, mapped.code, message, mapped.message);
  }
}
