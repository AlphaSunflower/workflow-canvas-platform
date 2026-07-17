import { AIImageToPlyTaskExecutor } from "../modules/executors/ai-image-to-ply.executor.ts";
import { AIMultiViewRestoreTaskExecutor } from "../modules/executors/ai-multi-view-restore.executor.ts";
import { AIFloorplanColorizeTaskExecutor } from "../modules/executors/ai-floorplan-colorize.executor.ts";
import { AIImageGenTaskExecutor } from "../modules/executors/ai-image-gen.executor.ts";
import { AIImageHdTaskExecutor } from "../modules/executors/ai-image-hd.executor.ts";
import { AIImageInpaintTaskExecutor } from "../modules/executors/ai-image-inpaint.executor.ts";
import { AIVideoGenTaskExecutor } from "../modules/executors/ai-video-gen.executor.ts";
import { MultiImageGenerateHelper } from "../modules/executors/multi-image-generate.helper.ts";
import { QueueTaskExecutorRegistry } from "../modules/executors/executor.registry.ts";
import { SingleImageGenerateHelper } from "../modules/executors/single-image-generate.helper.ts";
import { VideoGenerateHelper } from "../modules/executors/video-generate.helper.ts";
import { WhiteModelRenderExecutor } from "../modules/executors/white-model-render.executor.ts";
import { WhiteModelRenderTaskExecutor } from "../modules/executors/white-model-render-task.executor.ts";
import { DbIntermediateArtifactRepository } from "../modules/intermediate/db-intermediate-artifact.repository.ts";
import { IntermediateArtifactRepository } from "../modules/intermediate/intermediate-artifact.repository.ts";
import { IntermediateArtifactService } from "../modules/intermediate/intermediate-artifact.service.ts";
import { IntermediateLockService } from "../modules/intermediate/intermediate-lock.service.ts";
import {
  DbProviderCallLogRepository,
  NoopProviderCallLogRepository,
} from "../modules/provider-call-logs/provider-call-log.repository.ts";

export interface WorkerExecutorCompositionInput {
  env: {
    laozhangVeoPollIntervalMs: number;
    laozhangVeoTimeoutMs: number;
    persistenceMode: "json" | "db";
    database: ConstructorParameters<typeof DbIntermediateArtifactRepository>[0];
  };
  rootDir: string;
  executionsRepository: ConstructorParameters<typeof WhiteModelRenderExecutor>[0];
  filesRepository: ConstructorParameters<typeof WhiteModelRenderExecutor>[1];
  storageService: ConstructorParameters<typeof WhiteModelRenderExecutor>[4];
  laozhangClient: ConstructorParameters<typeof WhiteModelRenderExecutor>[3];
  laozhangVeoClient: ConstructorParameters<typeof VideoGenerateHelper>[2];
  runningHubClient: ConstructorParameters<typeof AIMultiViewRestoreTaskExecutor>[2];
  runningHubWorkflowTemplateService: ConstructorParameters<typeof AIMultiViewRestoreTaskExecutor>[3];
  overrides: {
    whiteModelRenderTaskExecutor?: WhiteModelRenderTaskExecutor;
    aiImageGenTaskExecutor?: AIImageGenTaskExecutor;
    aiImageInpaintTaskExecutor?: AIImageInpaintTaskExecutor;
    aiImageHdTaskExecutor?: AIImageHdTaskExecutor;
    aiFloorplanColorizeTaskExecutor?: AIFloorplanColorizeTaskExecutor;
    aiVideoGenTaskExecutor?: AIVideoGenTaskExecutor;
    aiMultiViewRestoreTaskExecutor?: AIMultiViewRestoreTaskExecutor;
    aiImageToPlyTaskExecutor?: AIImageToPlyTaskExecutor;
    queueTaskExecutor?: QueueTaskExecutorRegistry;
  };
}

export function composeWorkerExecutors(input: WorkerExecutorCompositionInput) {
  const intermediateArtifactRepository = input.env.persistenceMode === "db"
    ? new DbIntermediateArtifactRepository(input.env.database)
    : new IntermediateArtifactRepository(input.rootDir);
  const intermediateArtifactService = new IntermediateArtifactService(
    intermediateArtifactRepository,
    input.filesRepository,
    new IntermediateLockService(),
  );
  const providerCallLogRepository = input.env.persistenceMode === "db"
    ? new DbProviderCallLogRepository(input.env.database)
    : new NoopProviderCallLogRepository();
  const whiteModelRenderTaskExecutor = input.overrides.whiteModelRenderTaskExecutor
    ?? new WhiteModelRenderTaskExecutor(
      new WhiteModelRenderExecutor(
        input.executionsRepository,
        input.filesRepository,
        intermediateArtifactService,
        input.laozhangClient,
        input.storageService,
        providerCallLogRepository,
      ),
    );
  const multiImageGenerateHelper = new MultiImageGenerateHelper(
    input.executionsRepository,
    input.filesRepository,
    input.laozhangClient,
    input.storageService,
    providerCallLogRepository,
  );
  const singleImageGenerateHelper = new SingleImageGenerateHelper(
    input.executionsRepository,
    input.filesRepository,
    input.laozhangClient,
    input.storageService,
    providerCallLogRepository,
  );
  const videoGenerateHelper = new VideoGenerateHelper(
    input.executionsRepository,
    input.filesRepository,
    input.laozhangVeoClient,
    input.storageService,
    {
      pollIntervalMs: input.env.laozhangVeoPollIntervalMs,
      timeoutMs: input.env.laozhangVeoTimeoutMs,
      providerCallLogRepository,
    },
  );
  const aiImageGenTaskExecutor = input.overrides.aiImageGenTaskExecutor
    ?? new AIImageGenTaskExecutor(multiImageGenerateHelper);
  const aiImageInpaintTaskExecutor = input.overrides.aiImageInpaintTaskExecutor
    ?? new AIImageInpaintTaskExecutor(multiImageGenerateHelper);
  const aiImageHdTaskExecutor = input.overrides.aiImageHdTaskExecutor
    ?? new AIImageHdTaskExecutor(singleImageGenerateHelper);
  const aiFloorplanColorizeTaskExecutor = input.overrides.aiFloorplanColorizeTaskExecutor
    ?? new AIFloorplanColorizeTaskExecutor(singleImageGenerateHelper);
  const aiVideoGenTaskExecutor = input.overrides.aiVideoGenTaskExecutor
    ?? new AIVideoGenTaskExecutor(
      videoGenerateHelper,
      {
        pollIntervalMs: input.env.laozhangVeoPollIntervalMs,
        timeoutMs: input.env.laozhangVeoTimeoutMs,
      },
    );
  const aiMultiViewRestoreTaskExecutor = input.overrides.aiMultiViewRestoreTaskExecutor
    ?? new AIMultiViewRestoreTaskExecutor(
      input.executionsRepository,
      input.filesRepository,
      input.runningHubClient,
      input.runningHubWorkflowTemplateService,
      input.storageService,
      fetch,
      undefined,
      providerCallLogRepository,
    );
  const aiImageToPlyTaskExecutor = input.overrides.aiImageToPlyTaskExecutor
    ?? new AIImageToPlyTaskExecutor(
      input.executionsRepository,
      input.filesRepository,
      input.runningHubClient,
      input.runningHubWorkflowTemplateService,
      input.storageService,
      fetch,
      undefined,
      providerCallLogRepository,
    );
  const queueTaskExecutor = input.overrides.queueTaskExecutor
    ?? new QueueTaskExecutorRegistry([
      whiteModelRenderTaskExecutor,
      aiImageGenTaskExecutor,
      aiImageInpaintTaskExecutor,
      aiImageHdTaskExecutor,
      aiFloorplanColorizeTaskExecutor,
      aiVideoGenTaskExecutor,
      aiMultiViewRestoreTaskExecutor,
      aiImageToPlyTaskExecutor,
    ]);

  return {
    queueTaskExecutor,
  };
}
