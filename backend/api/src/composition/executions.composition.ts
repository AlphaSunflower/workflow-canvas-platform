import type { ServiceEnv } from "@newworkflow/backend-shared";
import type { AuthService } from "../modules/auth/auth.service.ts";
import { ExecutionQueryController } from "../modules/executions/execution-query.controller.ts";
import { ExecutionQueryService } from "../modules/executions/execution-query.service.ts";
import { ExecutionAccessPolicy } from "../modules/executions/execution-access.policy.ts";
import { ExecutionStoreInputBuilder } from "../modules/executions/execution-store-input.builder.ts";
import { ExecutionsController } from "../modules/executions/executions.controller.ts";
import { DbExecutionsRepository } from "../modules/executions/db-executions.repository.ts";
import { JsonExecutionsRepository } from "../modules/executions/json-executions.repository.ts";
import type { ExecutionsRepository } from "../modules/executions/executions.repository.types.ts";
import { ExecutionsService } from "../modules/executions/executions.service.ts";
import { WorkflowTaskHistoryRepository } from "../modules/workflows/workflow-task-history.repository.ts";
import type { ApiCompositionContext } from "./api-composition.context.ts";
import { resolveApiRootDir } from "./api-composition.shared.ts";
import { createFilesRepository, resolveFilesRepositoryForContext } from "./files.composition.ts";
import { createWorkflowRepositories } from "./workflows.composition.ts";

export interface ExecutionsServiceFactoryInput {
  env?: ServiceEnv;
  rootDir?: string;
}

export interface ExecutionQueryServiceFactoryInput {
  env?: ServiceEnv;
  rootDir?: string;
}

export function createExecutionsService(
  input: ExecutionsServiceFactoryInput = {},
): ExecutionsService {
  const rootDir = resolveApiRootDir(input.rootDir);
  return new ExecutionsService(
    createExecutionsRepository({ env: input.env, rootDir }),
    createFilesRepository({ env: input.env, rootDir }),
    createWorkflowRepositories({ env: input.env, rootDir }).workflowRepository,
    {
      accessPolicy: new ExecutionAccessPolicy(),
      storeInputBuilder: new ExecutionStoreInputBuilder(),
    },
  );
}

export function createExecutionQueryService(
  input: ExecutionQueryServiceFactoryInput = {},
): ExecutionQueryService {
  const rootDir = resolveApiRootDir(input.rootDir);
  return new ExecutionQueryService(
    createExecutionsRepository({ env: input.env, rootDir }),
    createFilesRepository({ env: input.env, rootDir }),
    createWorkflowRepositories({ env: input.env, rootDir }).workflowRepository,
    createWorkflowTaskHistoryRepository({ env: input.env, rootDir }),
  );
}

function createExecutionsRepository(input: {
  env?: ServiceEnv;
  rootDir: string;
}): ExecutionsRepository {
  if (input.env?.persistenceMode === "db") {
    return new DbExecutionsRepository(input.env.database);
  }

  return new JsonExecutionsRepository(input.rootDir);
}

function createWorkflowTaskHistoryRepository(input: {
  env?: ServiceEnv;
  rootDir: string;
}): WorkflowTaskHistoryRepository {
  return new WorkflowTaskHistoryRepository(input.rootDir, input.env?.persistenceMode === "db"
    ? { databaseConfig: input.env.database, mode: "db" }
    : {});
}

export function composeExecutionsModule(
  context: ApiCompositionContext,
  authService: AuthService,
) {
  const rootDir = resolveApiRootDir(context.rootDir);
  const filesRepository = resolveFilesRepositoryForContext(context);
  const executionsService = context.resolve(
    "executionsService",
    () => new ExecutionsService(
      createExecutionsRepository({ env: context.env, rootDir }),
      filesRepository,
      createWorkflowRepositories({ env: context.env, rootDir }).workflowRepository,
      {
        accessPolicy: new ExecutionAccessPolicy(),
        storeInputBuilder: new ExecutionStoreInputBuilder(),
      },
    ),
  );
  const executionQueryService = context.resolve(
    "executionQueryService",
    () => new ExecutionQueryService(
      createExecutionsRepository({ env: context.env, rootDir }),
      filesRepository,
      createWorkflowRepositories({ env: context.env, rootDir }).workflowRepository,
      createWorkflowTaskHistoryRepository({ env: context.env, rootDir }),
    ),
  );

  return {
    services: {
      executionsService,
      executionQueryService,
    },
    controllers: {
      executionsController: context.resolve(
        "executionsController",
        () => new ExecutionsController(executionsService, authService),
      ),
      executionQueryController: context.resolve(
        "executionQueryController",
        () => new ExecutionQueryController(executionQueryService, authService),
      ),
    },
  };
}
