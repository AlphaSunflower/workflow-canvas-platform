import type { ServiceEnv } from "@newworkflow/backend-shared";
import type { ExecutionsRepository } from "../../../api/src/modules/executions/executions.repository.types.ts";
import type { FilesRepository } from "../../../api/src/modules/files/files.repository.types.ts";
import type { ExecutionEventService } from "../modules/execution-events/execution-event.service.ts";
import type { AIImageToPlyTaskExecutor } from "../modules/executors/ai-image-to-ply.executor.ts";
import type { AIMultiViewRestoreTaskExecutor } from "../modules/executors/ai-multi-view-restore.executor.ts";
import type { AIFloorplanColorizeTaskExecutor } from "../modules/executors/ai-floorplan-colorize.executor.ts";
import type { AIImageGenTaskExecutor } from "../modules/executors/ai-image-gen.executor.ts";
import type { AIImageHdTaskExecutor } from "../modules/executors/ai-image-hd.executor.ts";
import type { AIImageInpaintTaskExecutor } from "../modules/executors/ai-image-inpaint.executor.ts";
import type { AIVideoGenTaskExecutor } from "../modules/executors/ai-video-gen.executor.ts";
import type { QueueTaskExecutorRegistry } from "../modules/executors/executor.registry.ts";
import type { WhiteModelRenderTaskExecutor } from "../modules/executors/white-model-render-task.executor.ts";
import type { ExecutionRunService } from "../modules/execution-run/execution-run.service.ts";
import type { ProviderSnapshotCleanerService } from "../modules/providers/provider-snapshot-cleaner.service.ts";
import type { ProviderConcurrencyServiceLike } from "../modules/queue/provider-concurrency.types.ts";
import type { QueueRepository } from "../modules/queue/queue.repository.ts";
import type { QueueService } from "../modules/queue/queue.service.ts";
import type { RetryPolicyService } from "../modules/retry/retry-policy.service.ts";
import type { StorageService } from "../modules/storage/storage.service.ts";

export interface WorkerDependencyOverrides {
  executionsRepository?: ExecutionsRepository;
  filesRepository?: FilesRepository;
  storageService?: StorageService;
  queueRepository?: QueueRepository;
  executionEventService?: ExecutionEventService;
  retryPolicyService?: RetryPolicyService;
  providerConcurrencyService?: ProviderConcurrencyServiceLike;
  queueTaskExecutor?: QueueTaskExecutorRegistry;
  queueService?: QueueService;
  executionRunService?: ExecutionRunService;
  providerSnapshotCleanerService?: ProviderSnapshotCleanerService;
  whiteModelRenderTaskExecutor?: WhiteModelRenderTaskExecutor;
  aiImageGenTaskExecutor?: AIImageGenTaskExecutor;
  aiImageInpaintTaskExecutor?: AIImageInpaintTaskExecutor;
  aiImageHdTaskExecutor?: AIImageHdTaskExecutor;
  aiFloorplanColorizeTaskExecutor?: AIFloorplanColorizeTaskExecutor;
  aiVideoGenTaskExecutor?: AIVideoGenTaskExecutor;
  aiMultiViewRestoreTaskExecutor?: AIMultiViewRestoreTaskExecutor;
  aiImageToPlyTaskExecutor?: AIImageToPlyTaskExecutor;
}

export interface WorkerDependencies {
  env: ServiceEnv;
  queueService: QueueService;
  executionRunService: ExecutionRunService;
  providerSnapshotCleanerService: ProviderSnapshotCleanerService;
}

export interface CreateWorkerDependenciesInput {
  env: ServiceEnv;
  rootDir?: string;
  overrides?: WorkerDependencyOverrides;
}
