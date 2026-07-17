import type { ServiceEnv } from "@newworkflow/backend-shared";
import type { PromptOptimizeController } from "../modules/ai/prompt-optimize.controller.ts";
import type { PromptOptimizeService } from "../modules/ai/prompt-optimize.service.ts";
import type { StoryboardArrangeController } from "../modules/ai/storyboard-arrange.controller.ts";
import type { StoryboardArrangeService } from "../modules/ai/storyboard-arrange.service.ts";
import type { AdminController } from "../modules/admin/admin.controller.ts";
import type { AdminService } from "../modules/admin/admin.service.ts";
import type { AuthController } from "../modules/auth/auth.controller.ts";
import type { AuthService } from "../modules/auth/auth.service.ts";
import type { ExecutionQueryController } from "../modules/executions/execution-query.controller.ts";
import type { ExecutionQueryService } from "../modules/executions/execution-query.service.ts";
import type { ExecutionsController } from "../modules/executions/executions.controller.ts";
import type { ExecutionsService } from "../modules/executions/executions.service.ts";
import type { FilesController } from "../modules/files/files.controller.ts";
import type { FilesRepository } from "../modules/files/files.repository.types.ts";
import type { FilesService } from "../modules/files/files.service.ts";
import type { UsersController } from "../modules/users/users.controller.ts";
import type { UsersService } from "../modules/users/users.service.ts";
import type { WorkflowsController } from "../modules/workflows/workflows.controller.ts";
import type { WorkflowsService } from "../modules/workflows/workflows.service.ts";

export interface ApiDependencyOverrides {
  authService?: AuthService;
  adminService?: AdminService;
  promptOptimizeService?: PromptOptimizeService;
  storyboardArrangeService?: StoryboardArrangeService;
  usersService?: UsersService;
  filesRepository?: FilesRepository;
  filesService?: FilesService;
  workflowsService?: WorkflowsService;
  executionsService?: ExecutionsService;
  executionQueryService?: ExecutionQueryService;
  authController?: AuthController;
  adminController?: AdminController;
  promptOptimizeController?: PromptOptimizeController;
  storyboardArrangeController?: StoryboardArrangeController;
  usersController?: UsersController;
  filesController?: FilesController;
  workflowsController?: WorkflowsController;
  executionsController?: ExecutionsController;
  executionQueryController?: ExecutionQueryController;
}

export interface ApiDependencies {
  services: {
    authService: AuthService;
    adminService: AdminService;
    promptOptimizeService: PromptOptimizeService;
    storyboardArrangeService: StoryboardArrangeService;
    usersService: UsersService;
    filesService: FilesService;
    workflowsService: WorkflowsService;
    executionsService: ExecutionsService;
    executionQueryService: ExecutionQueryService;
  };
  controllers: {
    authController: AuthController;
    adminController: AdminController;
    promptOptimizeController: PromptOptimizeController;
    storyboardArrangeController: StoryboardArrangeController;
    usersController: UsersController;
    filesController: FilesController;
    workflowsController: WorkflowsController;
    executionsController: ExecutionsController;
    executionQueryController: ExecutionQueryController;
  };
}

export interface CreateApiDependenciesInput {
  env: ServiceEnv;
  rootDir?: string;
  overrides?: ApiDependencyOverrides;
}
