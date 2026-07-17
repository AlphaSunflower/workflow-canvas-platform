import type { ServiceEnv } from "@newworkflow/backend-shared";
import { PromptOptimizeController } from "../modules/ai/prompt-optimize.controller.ts";
import { PromptOptimizeService } from "../modules/ai/prompt-optimize.service.ts";
import { StoryboardArrangeController } from "../modules/ai/storyboard-arrange.controller.ts";
import { StoryboardArrangeService } from "../modules/ai/storyboard-arrange.service.ts";
import { LaozhangVisionClient } from "../modules/ai/providers/laozhang-vision.client.ts";
import type { AuthService } from "../modules/auth/auth.service.ts";
import type { FilesService } from "../modules/files/files.service.ts";
import type { ApiCompositionContext } from "./api-composition.context.ts";
import { createFilesService } from "./files.composition.ts";

export interface PromptOptimizeServiceFactoryInput {
  env: ServiceEnv;
  rootDir?: string;
  filesService?: FilesService;
  visionClient?: LaozhangVisionClient;
}

export interface StoryboardArrangeServiceFactoryInput {
  env: ServiceEnv;
  rootDir?: string;
  filesService?: FilesService;
  visionClient?: LaozhangVisionClient;
}

function createVisionClient(env: ServiceEnv): LaozhangVisionClient {
  return new LaozhangVisionClient({
    apiKey: env.laozhangApiKey,
    apiUrl: env.laozhangVisionApiUrl,
    model: env.laozhangVisionModel,
    timeoutMs: env.laozhangVisionTimeoutMs,
  });
}

export function createPromptOptimizeService(
  input: PromptOptimizeServiceFactoryInput,
): PromptOptimizeService {
  return new PromptOptimizeService(
    input.filesService ?? createFilesService({ env: input.env, rootDir: input.rootDir }),
    input.visionClient ?? createVisionClient(input.env),
  );
}

export function createStoryboardArrangeService(
  input: StoryboardArrangeServiceFactoryInput,
): StoryboardArrangeService {
  return new StoryboardArrangeService(
    input.filesService ?? createFilesService({ env: input.env, rootDir: input.rootDir }),
    input.visionClient ?? createVisionClient(input.env),
  );
}

export function composeAiModule(
  context: ApiCompositionContext,
  authService: AuthService,
  filesService: FilesService,
) {
  const env = context.requireEnv();
  const promptOptimizeService = context.resolve(
    "promptOptimizeService",
    () => createPromptOptimizeService({
      env,
      rootDir: context.rootDir,
      filesService,
    }),
  );
  const storyboardArrangeService = context.resolve(
    "storyboardArrangeService",
    () => createStoryboardArrangeService({
      env,
      rootDir: context.rootDir,
      filesService,
    }),
  );

  return {
    services: {
      promptOptimizeService,
      storyboardArrangeService,
    },
    controllers: {
      promptOptimizeController: context.resolve(
        "promptOptimizeController",
        () => new PromptOptimizeController(promptOptimizeService, authService),
      ),
      storyboardArrangeController: context.resolve(
        "storyboardArrangeController",
        () => new StoryboardArrangeController(storyboardArrangeService, authService),
      ),
    },
  };
}
