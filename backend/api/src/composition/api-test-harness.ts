import type { ServiceEnv } from "@newworkflow/backend-shared";
import {
  createAuthService,
  createExecutionQueryService,
  createExecutionsService,
  createFilesService,
  createUsersService,
  createWorkflowsService,
} from "./create-api-dependencies.ts";

export function createApiTestHarness(rootDir: string, env: ServiceEnv) {
  return {
    createAuthService: () => createAuthService({ rootDir, env }),
    createUsersService: () => createUsersService({ rootDir, env }),
    createFilesService: () => createFilesService({ rootDir, env }),
    createWorkflowsService: () => createWorkflowsService({ rootDir, env }),
    createExecutionsService: () => createExecutionsService({ rootDir, env }),
    createExecutionQueryService: () => createExecutionQueryService({ rootDir, env }),
  };
}
