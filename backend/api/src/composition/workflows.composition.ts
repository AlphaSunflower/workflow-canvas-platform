import type { ServiceEnv } from "@newworkflow/backend-shared";
import type { AuthService } from "../modules/auth/auth.service.ts";
import {
  DbWorkflowGroupsRepository,
  DbWorkflowRepository,
} from "../modules/workflows/db-workflow.repository.ts";
import { DbWorkflowFilesRepository } from "../modules/workflows/db-workflow-files.repository.ts";
import { WorkflowGroupsRepository } from "../modules/workflows/workflow-groups.repository.ts";
import { WorkflowAccessPolicy } from "../modules/workflows/workflow-access.policy.ts";
import { WorkflowFileHydrator } from "../modules/workflows/workflow-file-hydrator.ts";
import { WorkflowFilesRepository } from "../modules/workflows/workflow-files.repository.ts";
import { WorkflowNodeSanitizer } from "../modules/workflows/workflow-node-sanitizer.ts";
import { WorkflowRepository } from "../modules/workflows/workflow.repository.ts";
import type {
  WorkflowFilesRepository as WorkflowFilesRepositoryInterface,
  WorkflowGroupRepository,
  WorkflowRepository as WorkflowRepositoryInterface,
} from "../modules/workflows/workflow.repository.types.ts";
import { WorkflowsController } from "../modules/workflows/workflows.controller.ts";
import { WorkflowsService } from "../modules/workflows/workflows.service.ts";
import type { ApiCompositionContext } from "./api-composition.context.ts";
import { resolveApiRootDir } from "./api-composition.shared.ts";
import { createFilesRepository, resolveFilesRepositoryForContext } from "./files.composition.ts";

export interface WorkflowsServiceFactoryInput {
  env?: ServiceEnv;
  rootDir?: string;
}

export interface WorkflowRepositoryFactoryInput {
  env?: ServiceEnv;
  rootDir?: string;
}

export interface WorkflowRepositories {
  workflowRepository: WorkflowRepositoryInterface;
  workflowGroupsRepository: WorkflowGroupRepository;
  workflowFilesRepository: WorkflowFilesRepositoryInterface;
}

export function createWorkflowRepositories(
  input: WorkflowRepositoryFactoryInput = {},
): WorkflowRepositories {
  const rootDir = resolveApiRootDir(input.rootDir);

  if (input.env?.persistenceMode === "db") {
    const options = {};
    return {
      workflowRepository: new DbWorkflowRepository(input.env.database, options),
      workflowGroupsRepository: new DbWorkflowGroupsRepository(input.env.database, options),
      workflowFilesRepository: new DbWorkflowFilesRepository(input.env.database, options),
    };
  }

  return {
    workflowRepository: new WorkflowRepository(rootDir),
    workflowGroupsRepository: new WorkflowGroupsRepository(rootDir),
    workflowFilesRepository: new WorkflowFilesRepository(rootDir),
  };
}

export function createWorkflowsService(
  input: WorkflowsServiceFactoryInput = {},
): WorkflowsService {
  const rootDir = resolveApiRootDir(input.rootDir);
  const repositories = createWorkflowRepositories({ env: input.env, rootDir });
  return new WorkflowsService(
    repositories.workflowRepository,
    repositories.workflowGroupsRepository,
    repositories.workflowFilesRepository,
    createFilesRepository({ env: input.env, rootDir }),
    {
      accessPolicy: new WorkflowAccessPolicy(),
      nodeSanitizer: new WorkflowNodeSanitizer(),
      fileHydrator: new WorkflowFileHydrator(),
    },
  );
}

export function composeWorkflowsModule(
  context: ApiCompositionContext,
  authService: AuthService,
) {
  const rootDir = resolveApiRootDir(context.rootDir);
  const repositories = createWorkflowRepositories({ env: context.env, rootDir });
  const filesRepository = resolveFilesRepositoryForContext(context);
  const workflowsService = context.resolve(
    "workflowsService",
    () => new WorkflowsService(
      repositories.workflowRepository,
      repositories.workflowGroupsRepository,
      repositories.workflowFilesRepository,
      filesRepository,
      {
        accessPolicy: new WorkflowAccessPolicy(),
        nodeSanitizer: new WorkflowNodeSanitizer(),
        fileHydrator: new WorkflowFileHydrator(),
      },
    ),
  );

  return {
    services: {
      workflowsService,
    },
    controllers: {
      workflowsController: context.resolve(
        "workflowsController",
        () => new WorkflowsController(workflowsService, authService),
      ),
    },
  };
}
