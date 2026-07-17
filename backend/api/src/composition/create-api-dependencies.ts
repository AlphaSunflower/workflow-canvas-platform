import { composeAiModule, createPromptOptimizeService, createStoryboardArrangeService, type PromptOptimizeServiceFactoryInput, type StoryboardArrangeServiceFactoryInput } from "./ai.composition.ts";
import type { ApiCompositionContext } from "./api-composition.context.ts";
import { resolveApiRootDir } from "./api-composition.shared.ts";
import type {
  ApiDependencies,
  ApiDependencyOverrides,
  CreateApiDependenciesInput,
} from "./api-dependencies.types.ts";
import { composeAdminModule } from "./admin.composition.ts";
import { composeExecutionsModule, createExecutionQueryService, createExecutionsService, type ExecutionQueryServiceFactoryInput, type ExecutionsServiceFactoryInput } from "./executions.composition.ts";
import { composeFilesModule, createFilesService, type FilesServiceFactoryInput } from "./files.composition.ts";
import { composeAuthModule, createAuthService, createUsersService, type AuthServiceFactoryInput, type UsersServiceFactoryInput } from "./auth.composition.ts";
import { composeWorkflowsModule, createWorkflowsService, type WorkflowsServiceFactoryInput } from "./workflows.composition.ts";

function createApiCompositionContext(
  input: CreateApiDependenciesInput,
): ApiCompositionContext {
  const rootDir = resolveApiRootDir(input.rootDir);
  const overrides = input.overrides ?? {};

  return {
    env: input.env,
    rootDir,
    requireEnv() {
      if (!input.env) {
        throw new Error("API_COMPOSITION_ENV_REQUIRED");
      }

      return input.env;
    },
    resolve(key, factory) {
      return (overrides[key] ?? factory()) as NonNullable<ApiDependencyOverrides[typeof key]>;
    },
  };
}

export type {
  ApiDependencies,
  ApiDependencyOverrides,
  CreateApiDependenciesInput,
  AuthServiceFactoryInput,
  UsersServiceFactoryInput,
  FilesServiceFactoryInput,
  WorkflowsServiceFactoryInput,
  ExecutionsServiceFactoryInput,
  ExecutionQueryServiceFactoryInput,
  PromptOptimizeServiceFactoryInput,
  StoryboardArrangeServiceFactoryInput,
};

export {
  createAuthService,
  createUsersService,
  createFilesService,
  createWorkflowsService,
  createExecutionsService,
  createExecutionQueryService,
  createPromptOptimizeService,
  createStoryboardArrangeService,
};

export function createApiDependencies(
  input: CreateApiDependenciesInput,
): ApiDependencies {
  const context = createApiCompositionContext(input);
  const authModule = composeAuthModule(context);
  const adminModule = composeAdminModule(context, authModule.services.authService);
  const filesModule = composeFilesModule(context, authModule.services.authService);
  const workflowsModule = composeWorkflowsModule(context, authModule.services.authService);
  const executionsModule = composeExecutionsModule(context, authModule.services.authService);
  const aiModule = composeAiModule(
    context,
    authModule.services.authService,
    filesModule.services.filesService,
  );

  return {
    services: {
      ...authModule.services,
      ...adminModule.services,
      ...aiModule.services,
      ...filesModule.services,
      ...workflowsModule.services,
      ...executionsModule.services,
    },
    controllers: {
      ...authModule.controllers,
      ...adminModule.controllers,
      ...aiModule.controllers,
      ...filesModule.controllers,
      ...workflowsModule.controllers,
      ...executionsModule.controllers,
    },
  };
}
