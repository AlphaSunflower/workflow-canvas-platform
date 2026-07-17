import type { ApiDependencyOverrides } from "./api-dependencies.types.ts";

export interface BuildApiOverridesInput {
  overrides?: ApiDependencyOverrides;
  authServiceFactory?: () => NonNullable<ApiDependencyOverrides["authService"]>;
  promptOptimizeServiceFactory?: () => NonNullable<ApiDependencyOverrides["promptOptimizeService"]>;
  storyboardArrangeServiceFactory?: () => NonNullable<ApiDependencyOverrides["storyboardArrangeService"]>;
  usersServiceFactory?: () => NonNullable<ApiDependencyOverrides["usersService"]>;
  filesServiceFactory?: () => NonNullable<ApiDependencyOverrides["filesService"]>;
  workflowsServiceFactory?: () => NonNullable<ApiDependencyOverrides["workflowsService"]>;
  executionsServiceFactory?: () => NonNullable<ApiDependencyOverrides["executionsService"]>;
  executionQueryServiceFactory?: () => NonNullable<ApiDependencyOverrides["executionQueryService"]>;
  authController?: ApiDependencyOverrides["authController"];
  promptOptimizeController?: ApiDependencyOverrides["promptOptimizeController"];
  storyboardArrangeController?: ApiDependencyOverrides["storyboardArrangeController"];
  usersController?: ApiDependencyOverrides["usersController"];
  filesController?: ApiDependencyOverrides["filesController"];
  workflowsController?: ApiDependencyOverrides["workflowsController"];
  executionsController?: ApiDependencyOverrides["executionsController"];
  executionQueryController?: ApiDependencyOverrides["executionQueryController"];
}

export function buildApiOverrides(
  input?: BuildApiOverridesInput,
): ApiDependencyOverrides | undefined {
  if (!input) {
    return undefined;
  }

  return {
    authService: input.overrides?.authService ?? input.authServiceFactory?.(),
    promptOptimizeService:
      input.overrides?.promptOptimizeService ?? input.promptOptimizeServiceFactory?.(),
    storyboardArrangeService:
      input.overrides?.storyboardArrangeService ?? input.storyboardArrangeServiceFactory?.(),
    usersService: input.overrides?.usersService ?? input.usersServiceFactory?.(),
    filesService: input.overrides?.filesService ?? input.filesServiceFactory?.(),
    workflowsService: input.overrides?.workflowsService ?? input.workflowsServiceFactory?.(),
    executionsService: input.overrides?.executionsService ?? input.executionsServiceFactory?.(),
    executionQueryService:
      input.overrides?.executionQueryService ?? input.executionQueryServiceFactory?.(),
    authController: input.overrides?.authController ?? input.authController,
    promptOptimizeController:
      input.overrides?.promptOptimizeController ?? input.promptOptimizeController,
    storyboardArrangeController:
      input.overrides?.storyboardArrangeController ?? input.storyboardArrangeController,
    usersController: input.overrides?.usersController ?? input.usersController,
    filesController: input.overrides?.filesController ?? input.filesController,
    workflowsController: input.overrides?.workflowsController ?? input.workflowsController,
    executionsController: input.overrides?.executionsController ?? input.executionsController,
    executionQueryController:
      input.overrides?.executionQueryController ?? input.executionQueryController,
  };
}
