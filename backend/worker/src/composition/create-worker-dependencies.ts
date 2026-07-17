import {
  createWorkerCompositionContext,
} from "./worker-composition.context.ts";
import {
  resolveSnapshotDir,
  resolveWorkerRootDir,
} from "./worker-composition.shared.ts";
import type {
  CreateWorkerDependenciesInput,
  WorkerDependencies,
  WorkerDependencyOverrides,
} from "./worker-dependencies.types.ts";
import { composeWorkerCore } from "./worker-core.composition.ts";
import { composeWorkerExecutors } from "./worker-executor.composition.ts";
import { composeWorkerProviders } from "./worker-provider.composition.ts";
import { composeWorkerRunServices } from "./worker-run.composition.ts";

export type {
  CreateWorkerDependenciesInput,
  WorkerDependencies,
  WorkerDependencyOverrides,
};

export function createWorkerDependencies(
  input: CreateWorkerDependenciesInput,
): WorkerDependencies {
  const rootDir = resolveWorkerRootDir(input.rootDir);
  const snapshotDir = resolveSnapshotDir(input.env, rootDir);
  const context = createWorkerCompositionContext(input, rootDir, snapshotDir);
  const core = composeWorkerCore(context);
  const providers = composeWorkerProviders(context);
  const executors = composeWorkerExecutors({
    env: {
      laozhangVeoPollIntervalMs: input.env.laozhangVeoPollIntervalMs,
      laozhangVeoTimeoutMs: input.env.laozhangVeoTimeoutMs,
      persistenceMode: input.env.persistenceMode,
      database: input.env.database,
    },
    rootDir,
    executionsRepository: core.executionsRepository,
    filesRepository: core.filesRepository,
    storageService: core.storageService,
    laozhangClient: providers.laozhangClient,
    laozhangVeoClient: providers.laozhangVeoClient,
    runningHubClient: providers.runningHubClient,
    runningHubWorkflowTemplateService: providers.runningHubWorkflowTemplateService,
    overrides: {
      whiteModelRenderTaskExecutor: input.overrides?.whiteModelRenderTaskExecutor,
      aiImageGenTaskExecutor: input.overrides?.aiImageGenTaskExecutor,
      aiImageInpaintTaskExecutor: input.overrides?.aiImageInpaintTaskExecutor,
      aiImageHdTaskExecutor: input.overrides?.aiImageHdTaskExecutor,
      aiFloorplanColorizeTaskExecutor: input.overrides?.aiFloorplanColorizeTaskExecutor,
      aiVideoGenTaskExecutor: input.overrides?.aiVideoGenTaskExecutor,
      aiMultiViewRestoreTaskExecutor: input.overrides?.aiMultiViewRestoreTaskExecutor,
      aiImageToPlyTaskExecutor: input.overrides?.aiImageToPlyTaskExecutor,
      queueTaskExecutor: input.overrides?.queueTaskExecutor,
    },
  });
  const runServices = composeWorkerRunServices({
    context,
    executionsRepository: core.executionsRepository,
    executionEventService: core.executionEventService,
    retryPolicyService: core.retryPolicyService,
    providerConcurrencyService: providers.providerConcurrencyService,
    queueTaskExecutor: executors.queueTaskExecutor,
    workerId: providers.workerId,
  });

  return {
    env: input.env,
    queueService: runServices.queueService,
    executionRunService: runServices.executionRunService,
    providerSnapshotCleanerService: runServices.providerSnapshotCleanerService,
  };
}
