import http from "node:http";
import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { URL } from "node:url";

import {
  createLogger,
  sendApiError,
} from "@newworkflow/backend-shared";
import type { ServiceEnv } from "@newworkflow/backend-shared";
import type { AuthController } from "../modules/auth/auth.controller.ts";
import type { AuthService } from "../modules/auth/auth.service.ts";
import type { PromptOptimizeController } from "../modules/ai/prompt-optimize.controller.ts";
import type { PromptOptimizeService } from "../modules/ai/prompt-optimize.service.ts";
import type { StoryboardArrangeController } from "../modules/ai/storyboard-arrange.controller.ts";
import type { StoryboardArrangeService } from "../modules/ai/storyboard-arrange.service.ts";
import type { ExecutionQueryController } from "../modules/executions/execution-query.controller.ts";
import type { ExecutionQueryService } from "../modules/executions/execution-query.service.ts";
import type { ExecutionsController } from "../modules/executions/executions.controller.ts";
import type { ExecutionsService } from "../modules/executions/executions.service.ts";
import type { FilesController } from "../modules/files/files.controller.ts";
import type { FilesService } from "../modules/files/files.service.ts";
import type { UsersController } from "../modules/users/users.controller.ts";
import type { UsersService } from "../modules/users/users.service.ts";
import type { WorkflowsController } from "../modules/workflows/workflows.controller.ts";
import type { WorkflowsService } from "../modules/workflows/workflows.service.ts";
import {
  createApiDependencies,
  type ApiDependencies,
  type ApiDependencyOverrides,
} from "./create-api-dependencies.ts";
import { createApiRouter } from "../router/api-router.ts";
import { buildApiOverrides } from "./build-api-overrides.ts";

const logger = createLogger("api");
const DEV_CORS_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const CORS_ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const CORS_ALLOWED_HEADERS = "Authorization,Content-Type,If-None-Match,If-Modified-Since,X-Upload-Id";
const CORS_EXPOSED_HEADERS = "ETag,Last-Modified,Content-Length,Content-Type,Cache-Control";

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

function handleUnexpectedRequestError(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
): void {
  logger.error("API request failed unexpectedly", {
    method: request.method,
    url: request.url,
    remoteAddress: request.socket.remoteAddress,
    error: serializeError(error),
  });

  if (response.writableEnded) {
    return;
  }

  if (response.headersSent) {
    response.destroy();
    return;
  }

  sendApiError(
    response,
    500,
    50000,
    "INTERNAL_ERROR",
    "后端接口内部错误。",
  );
}

function shouldApplyDevCors(runtimeEnv: ServiceEnv): boolean {
  return runtimeEnv.nodeEnv !== "production";
}

function applyDevCorsHeaders(
  runtimeEnv: ServiceEnv,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (response.headersSent) {
    return false;
  }

  if (!shouldApplyDevCors(runtimeEnv)) {
    return false;
  }

  const origin = request.headers.origin;
  if (typeof origin !== "string" || !DEV_CORS_ALLOWED_ORIGINS.has(origin)) {
    return false;
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  response.setHeader("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
  response.setHeader("Access-Control-Expose-Headers", CORS_EXPOSED_HEADERS);
  response.setHeader("Vary", "Origin");
  return true;
}

function handleCorsPreflight(
  runtimeEnv: ServiceEnv,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (request.method !== "OPTIONS") {
    return false;
  }

  const allowed = applyDevCorsHeaders(runtimeEnv, request, response);
  response.writeHead(allowed ? 204 : 404);
  response.end();
  return true;
}

export interface CreateApiServerOptions {
  rootDir?: string;
  dependencies?: ApiDependencies;
  overrides?: ApiDependencyOverrides;
  authServiceFactory?: () => AuthService;
  promptOptimizeServiceFactory?: () => PromptOptimizeService;
  storyboardArrangeServiceFactory?: () => StoryboardArrangeService;
  usersServiceFactory?: () => UsersService;
  filesServiceFactory?: () => FilesService;
  workflowsServiceFactory?: () => WorkflowsService;
  executionsServiceFactory?: () => ExecutionsService;
  executionQueryServiceFactory?: () => ExecutionQueryService;
  authController?: AuthController;
  promptOptimizeController?: PromptOptimizeController;
  storyboardArrangeController?: StoryboardArrangeController;
  usersController?: UsersController;
  filesController?: FilesController;
  workflowsController?: WorkflowsController;
  executionsController?: ExecutionsController;
  executionQueryController?: ExecutionQueryController;
}

export function createApiServer(
  runtimeEnv: ServiceEnv,
  options?: CreateApiServerOptions,
): Server {
  const dependencies = options?.dependencies ?? createApiDependencies({
    env: runtimeEnv,
    rootDir: options?.rootDir,
    overrides: buildApiOverrides(options),
  });
  const router = createApiRouter(dependencies.controllers);

  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${runtimeEnv.host}:${runtimeEnv.port}`);
    applyDevCorsHeaders(runtimeEnv, request, response);
    if (handleCorsPreflight(runtimeEnv, request, response)) {
      return;
    }

    void router.handle({
      request,
      response,
      requestUrl,
    }, runtimeEnv).catch((error) => {
      handleUnexpectedRequestError(request, response, error);
    });
  });
}

export function startApiServer(
  runtimeEnv: ServiceEnv,
  options?: CreateApiServerOptions,
): Server {
  const server = createApiServer(runtimeEnv, options);

  server.listen(runtimeEnv.port, () => {
    logger.info("API service started", {
      host: runtimeEnv.host,
      port: runtimeEnv.port,
      nodeEnv: runtimeEnv.nodeEnv,
    });
  });

  return server;
}
