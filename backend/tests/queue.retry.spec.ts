import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { AIFloorplanColorizeTaskExecutor } from "../worker/src/modules/executors/ai-floorplan-colorize.executor.ts";
import { AIImageGenTaskExecutor } from "../worker/src/modules/executors/ai-image-gen.executor.ts";
import { AIImageHdTaskExecutor } from "../worker/src/modules/executors/ai-image-hd.executor.ts";
import { AIMultiViewRestoreTaskExecutor } from "../worker/src/modules/executors/ai-multi-view-restore.executor.ts";
import { AIImageToPlyTaskExecutor } from "../worker/src/modules/executors/ai-image-to-ply.executor.ts";
import { QueueTaskExecutorRegistry } from "../worker/src/modules/executors/executor.registry.ts";
import { MultiImageGenerateHelper } from "../worker/src/modules/executors/multi-image-generate.helper.ts";
import { SingleImageGenerateHelper } from "../worker/src/modules/executors/single-image-generate.helper.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";
import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";

async function registerReadyFile(
  filesRepository: FilesRepository,
  userId: string,
  originalName: string,
  content: string,
): Promise<string> {
  const buffer = Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const registerResult = await filesRepository.registerFile({
    userId,
    sha256,
    size: buffer.length,
    mimeType: "image/png",
    originalName,
    fileType: "image",
    sourceType: "input",
  });

  if (registerResult.uploadRequired && registerResult.uploadId) {
    await filesRepository.uploadFile(
      registerResult.uploadId,
      buffer.toString("base64"),
    );
  }

  return registerResult.file.fileId;
}

async function createWhiteModelExecution(input: {
  rootDir: string;
  title: string;
}): Promise<{
  executionsRepository: ExecutionsRepository;
  createResult: Awaited<ReturnType<ExecutionsService["createExecution"]>>;
}> {
  const filesRepository = new FilesRepository(input.rootDir);
  const executionsRepository = new ExecutionsRepository(input.rootDir);
  const executionsService = ExecutionsService.fromRoot(input.rootDir);

  const whiteModelFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "white-model.png",
    `${input.title}-white-model`,
  );
  const styleReferenceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "style.png",
    `${input.title}-style`,
  );

  const createResult = await executionsService.createExecution({
    userId: "user-a",
    workflowId: "workflow-white-model-retry",
    nodeType: "aiModelRenderTransfer",
    taskType: "model-render-transfer",
    executionMode: "legacy-grouped-task",
    nodeId: "node-retry",
    nodeTitle: input.title,
    groups: [
      {
        groupId: "group-1",
        whiteModelFileId,
        styleReferenceFileId,
      },
    ],
  });

  return {
    executionsRepository,
    createResult,
  };
}

async function runSuccessAfterRetriesScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-retry-success-"));

  try {
    const { executionsRepository, createResult } = await createWhiteModelExecution({
      rootDir,
      title: "重试成功测试",
    });

    let invocationCount = 0;
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute() {
          invocationCount += 1;

          if (invocationCount < 3) {
            throw {
              code: "PROVIDER_ERROR",
              message: `provider failed at attempt ${invocationCount}`,
              category: "provider_retryable",
              retryable: true,
            };
          }

          return {
            resultFileId: "result-success",
            resultStorageKey: "outputs/result-success.png",
            lineartFileId: "lineart-success",
            depthFileId: "depth-success",
            usedCachedLineart: false,
            usedCachedDepth: false,
          };
        },
      },
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
    );

    const pollResult = await queueService.pollOnce();
    const taskId = createResult.tasks[0]!.taskId;
    const task = await executionsRepository.getTaskById(taskId);
    const events = await executionsRepository.getTaskEvents(taskId);

    assert.equal(pollResult.claimedCount, 1);
    assert.equal(invocationCount, 3);
    assert.equal(task?.status, "completed");
    assert.equal(task?.currentAttemptNo, 3);
    assert.equal(task?.retryCount, 2);
    assert.equal(task?.lastErrorCode, null);
    assert.equal(task?.lastErrorMessage, null);
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_scheduled").length,
      2,
    );
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_started").length,
      2,
    );
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_progress").length,
      2,
    );
    assert.equal(
      events.filter((event) => event.eventType === "task_failed").length,
      0,
    );
    assert.ok(events.some((event) => event.eventType === "task_completed"));
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "task_retry_started")
        .map((event) => event.attemptNo),
      [2, 3],
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runFinalFailureScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-retry-fail-"));

  try {
    const { executionsRepository, createResult } = await createWhiteModelExecution({
      rootDir,
      title: "重试失败测试",
    });

    let invocationCount = 0;
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute() {
          invocationCount += 1;

          throw {
            code: "TIMEOUT",
            message: `timeout at attempt ${invocationCount}`,
            category: "provider_retryable",
            retryable: true,
          };
        },
      },
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
    );

    const pollResult = await queueService.pollOnce();
    const run = await executionsRepository.getExecutionRun(createResult.runId);
    const taskId = createResult.tasks[0]!.taskId;
    const task = await executionsRepository.getTaskById(taskId);
    const events = await executionsRepository.getTaskEvents(taskId);

    assert.equal(pollResult.claimedCount, 1);
    assert.equal(invocationCount, 3);
    assert.equal(task?.status, "failed");
    assert.equal(task?.currentAttemptNo, 3);
    assert.equal(task?.retryCount, 2);
    assert.equal(task?.lastErrorCode, "TIMEOUT");
    assert.equal(task?.lastErrorMessage, "timeout at attempt 3");
    assert.equal(run?.status, "failed");
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_scheduled").length,
      2,
    );
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_started").length,
      2,
    );
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_progress").length,
      3,
    );
    assert.equal(
      events.filter((event) => event.eventType === "task_failed").length,
      1,
    );

    const finalFailureEvent = [...events]
      .reverse()
      .find((event) => event.eventType === "task_failed");

    assert.equal(finalFailureEvent?.attemptNo, 3);
    assert.equal(finalFailureEvent?.payload?.errorCode, "TIMEOUT");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runSingleImageRetryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-single-image-retry-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const sourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "single-image-retry.png",
      "single-image-retry-content",
    );

    const imageHdCreateResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-image-hd-retry",
      nodeType: "aiImageHd",
      taskType: "image-hd",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-hd-retry",
      model: "gemini-3-pro-image-preview",
      nodeTitle: "图片高清化重试",
      groups: [
        {
          groupId: "group-hd-retry",
          sourceFileId,
          imageSize: "2K",
          aspectRatio: "1:1",
        },
      ],
    });
    const floorplanCreateResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-floorplan-retry",
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
      executionMode: "legacy-grouped-task",
      nodeId: "node-floorplan-retry",
      model: "gemini-3-pro-image-preview",
      nodeTitle: "彩平重试",
      groups: [
        {
          groupId: "group-floorplan-retry",
          sourceFileId,
          imageSize: "1K",
          aspectRatio: "4:5",
        },
      ],
    });

    const taskIdByTaskNo = new Map<string, string>();
    taskIdByTaskNo.set(imageHdCreateResult.tasks[0]!.taskNo, imageHdCreateResult.tasks[0]!.taskId);
    taskIdByTaskNo.set(
      floorplanCreateResult.tasks[0]!.taskNo,
      floorplanCreateResult.tasks[0]!.taskId,
    );

    const invocationCountByTaskId = new Map<string, number>();
    const helper = new SingleImageGenerateHelper(
      executionsRepository,
      filesRepository,
      {
        async generateImage(input) {
          const taskNo = input.snapshotLabel?.replace(/-single-image$/, "") ?? "unknown";
          const taskId = taskIdByTaskNo.get(taskNo);

          if (!taskId) {
            throw new Error("UNKNOWN_TASK_FOR_RETRY_TEST");
          }

          const task = await executionsRepository.getTaskById(taskId);

          if (!task) {
            throw new Error("TASK_NOT_FOUND_FOR_RETRY_TEST");
          }

          const nextCount = (invocationCountByTaskId.get(task.id) ?? 0) + 1;
          invocationCountByTaskId.set(task.id, nextCount);

          if (task.nodeType === "aiImageHd" && nextCount < 3) {
            throw {
              code: "PROVIDER_ERROR",
              message: `provider failed at attempt ${nextCount}`,
              category: "provider_retryable",
              retryable: true,
            };
          }

          if (task.nodeType === "aiFloorplanColorize") {
            throw {
              code: "TIMEOUT",
              message: `timeout at attempt ${nextCount}`,
              category: "provider_retryable",
              retryable: true,
            };
          }

          return {
            imageBase64: Buffer.from(`retry-success:${task.taskNo}`).toString("base64"),
            mimeType: "image/png",
          };
        },
      },
      storageService,
    );
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      new QueueTaskExecutorRegistry([
        new AIImageHdTaskExecutor(helper),
        new AIFloorplanColorizeTaskExecutor(helper),
      ]),
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
    );

    const [pollResultA, pollResultB] = await Promise.all([
      queueService.pollOnce(),
      queueService.pollOnce(),
    ]);

    assert.equal(pollResultA.claimedCount + pollResultB.claimedCount, 2);

    const imageHdTaskId = imageHdCreateResult.tasks[0]!.taskId;
    const floorplanTaskId = floorplanCreateResult.tasks[0]!.taskId;
    const imageHdTask = await executionsRepository.getTaskById(imageHdTaskId);
    const floorplanTask = await executionsRepository.getTaskById(floorplanTaskId);
    const imageHdEvents = await executionsRepository.getTaskEvents(imageHdTaskId);
    const floorplanEvents = await executionsRepository.getTaskEvents(floorplanTaskId);
    const imageHdRun = await executionsRepository.getExecutionRun(imageHdCreateResult.runId);
    const floorplanRun = await executionsRepository.getExecutionRun(floorplanCreateResult.runId);

    assert.equal(invocationCountByTaskId.get(imageHdTaskId), 3);
    assert.equal(invocationCountByTaskId.get(floorplanTaskId), 3);

    assert.equal(imageHdTask?.status, "completed");
    assert.equal(imageHdTask?.currentAttemptNo, 3);
    assert.equal(imageHdTask?.retryCount, 2);
    assert.equal(imageHdTask?.lastErrorCode, null);
    assert.equal(imageHdRun?.status, "completed");
    assert.ok(imageHdTask?.resultFileId);
    assert.equal(
      imageHdEvents.filter((event) => event.eventType === "task_retry_scheduled").length,
      2,
    );
    assert.equal(
      imageHdEvents.filter((event) => event.eventType === "task_retry_started").length,
      2,
    );
    assert.equal(
      imageHdEvents.filter((event) => event.eventType === "task_retry_progress").length,
      2,
    );
    assert.ok(imageHdEvents.some((event) => event.eventType === "step_final_started"));
    assert.ok(imageHdEvents.some((event) => event.eventType === "task_completed"));

    assert.equal(floorplanTask?.status, "failed");
    assert.equal(floorplanTask?.currentAttemptNo, 3);
    assert.equal(floorplanTask?.retryCount, 2);
    assert.equal(floorplanTask?.lastErrorCode, "TIMEOUT");
    assert.equal(floorplanTask?.lastErrorMessage, "timeout at attempt 3");
    assert.equal(floorplanRun?.status, "failed");
    assert.equal(
      floorplanEvents.filter((event) => event.eventType === "task_retry_scheduled").length,
      2,
    );
    assert.equal(
      floorplanEvents.filter((event) => event.eventType === "task_retry_started").length,
      2,
    );
    assert.equal(
      floorplanEvents.filter((event) => event.eventType === "task_retry_progress").length,
      3,
    );
    assert.equal(
      floorplanEvents.filter((event) => event.eventType === "task_failed").length,
      1,
    );
    assert.ok(floorplanEvents.some((event) => event.eventType === "step_final_started"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runAIImageGenRetryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-ai-image-gen-retry-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));

    const referenceFileId1 = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-1.png",
      "ai-image-gen-reference-1",
    );
    const referenceFileId2 = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-2.png",
      "ai-image-gen-reference-2",
    );

    const successCreateResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-ai-image-gen-retry-success",
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-image-gen-success",
      model: "gemini-3-pro-image-preview",
      nodeTitle: "AI 生图重试成功",
      prompt: "成功路径提示词",
      imageSize: "4K",
      aspectRatio: "16:9",
      groups: [
        {
          groupId: "group-ai-image-gen-success",
          referenceFileIds: [referenceFileId2, referenceFileId1],
        },
      ],
    });
    const failureCreateResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-ai-image-gen-retry-failure",
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-image-gen-failed",
      model: "gemini-3-pro-image-preview",
      nodeTitle: "AI 生图重试失败",
      prompt: "失败路径提示词",
      imageSize: "1K",
      aspectRatio: "auto",
      groups: [
        {
          groupId: "group-ai-image-gen-failed",
          referenceFileIds: [referenceFileId1],
        },
      ],
    });

    const taskIdByTaskNo = new Map<string, string>();
    taskIdByTaskNo.set(successCreateResult.tasks[0]!.taskNo, successCreateResult.tasks[0]!.taskId);
    taskIdByTaskNo.set(failureCreateResult.tasks[0]!.taskNo, failureCreateResult.tasks[0]!.taskId);

    const invocationCountByTaskId = new Map<string, number>();
    const helper = new MultiImageGenerateHelper(
      executionsRepository,
      filesRepository,
      {
        async generateImage(input) {
          const taskNo = input.snapshotLabel?.replace(/-multi-image$/, "") ?? "unknown";
          const taskId = taskIdByTaskNo.get(taskNo);

          if (!taskId) {
            throw new Error("UNKNOWN_AI_IMAGE_GEN_TASK_FOR_RETRY_TEST");
          }

          const task = await executionsRepository.getTaskById(taskId);

          if (!task) {
            throw new Error("AI_IMAGE_GEN_TASK_NOT_FOUND_FOR_RETRY_TEST");
          }

          const nextCount = (invocationCountByTaskId.get(task.id) ?? 0) + 1;
          invocationCountByTaskId.set(task.id, nextCount);

          if (task.id === successCreateResult.tasks[0]!.taskId && nextCount < 3) {
            throw {
              code: "PROVIDER_ERROR",
              message: `provider failed at attempt ${nextCount}`,
              category: "provider_retryable",
              retryable: true,
            };
          }

          if (task.id === failureCreateResult.tasks[0]!.taskId) {
            throw {
              code: "TIMEOUT",
              message: `timeout at attempt ${nextCount}`,
              category: "provider_retryable",
              retryable: true,
            };
          }

          return {
            imageBase64: Buffer.from(`ai-image-gen-retry-success:${task.taskNo}`).toString("base64"),
            mimeType: "image/png",
          };
        },
      },
      storageService,
    );
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      new QueueTaskExecutorRegistry([
        new AIImageGenTaskExecutor(helper),
      ]),
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
    );

    const [pollResultA, pollResultB] = await Promise.all([
      queueService.pollOnce(),
      queueService.pollOnce(),
    ]);

    assert.equal(pollResultA.claimedCount + pollResultB.claimedCount, 2);

    const successTaskId = successCreateResult.tasks[0]!.taskId;
    const failureTaskId = failureCreateResult.tasks[0]!.taskId;
    const successTask = await executionsRepository.getTaskById(successTaskId);
    const failureTask = await executionsRepository.getTaskById(failureTaskId);
    const successEvents = await executionsRepository.getTaskEvents(successTaskId);
    const failureEvents = await executionsRepository.getTaskEvents(failureTaskId);
    const successRun = await executionsRepository.getExecutionRun(successCreateResult.runId);
    const failureRun = await executionsRepository.getExecutionRun(failureCreateResult.runId);

    assert.equal(invocationCountByTaskId.get(successTaskId), 3);
    assert.equal(invocationCountByTaskId.get(failureTaskId), 3);

    assert.equal(successTask?.status, "completed");
    assert.equal(successTask?.currentAttemptNo, 3);
    assert.equal(successTask?.retryCount, 2);
    assert.equal(successTask?.lastErrorCode, null);
    assert.equal(successRun?.status, "completed");
    assert.ok(successTask?.resultFileId);
    assert.equal(
      successEvents.filter((event) => event.eventType === "task_retry_scheduled").length,
      2,
    );
    assert.equal(
      successEvents.filter((event) => event.eventType === "task_retry_started").length,
      2,
    );
    assert.equal(
      successEvents.filter((event) => event.eventType === "task_retry_progress").length,
      2,
    );
    assert.ok(successEvents.some((event) => event.eventType === "step_final_started"));
    assert.ok(successEvents.some((event) => event.eventType === "step_final_completed"));
    assert.ok(successEvents.some((event) => event.eventType === "task_completed"));

    const successFinalStartedEvents = successEvents.filter(
      (event) => event.eventType === "step_final_started",
    );

    assert.equal(successFinalStartedEvents.length, 3);
    assert.deepEqual(successFinalStartedEvents[0]?.payload?.referenceFileIds, [
      referenceFileId2,
      referenceFileId1,
    ]);
    assert.equal(successFinalStartedEvents[0]?.payload?.imageSize, "4K");
    assert.equal(successFinalStartedEvents[0]?.payload?.aspectRatio, "16:9");

    assert.equal(failureTask?.status, "failed");
    assert.equal(failureTask?.currentAttemptNo, 3);
    assert.equal(failureTask?.retryCount, 2);
    assert.equal(failureTask?.lastErrorCode, "TIMEOUT");
    assert.equal(failureTask?.lastErrorMessage, "timeout at attempt 3");
    assert.equal(failureRun?.status, "failed");
    assert.equal(
      failureEvents.filter((event) => event.eventType === "task_retry_scheduled").length,
      2,
    );
    assert.equal(
      failureEvents.filter((event) => event.eventType === "task_retry_started").length,
      2,
    );
    assert.equal(
      failureEvents.filter((event) => event.eventType === "task_retry_progress").length,
      3,
    );
    assert.equal(
      failureEvents.filter((event) => event.eventType === "task_failed").length,
      1,
    );
    assert.ok(failureEvents.some((event) => event.eventType === "step_final_started"));

    const failureFinalStartedEvents = failureEvents.filter(
      (event) => event.eventType === "step_final_started",
    );
    const failureEvent = [...failureEvents]
      .reverse()
      .find((event) => event.eventType === "task_failed");

    assert.equal(failureFinalStartedEvents.length, 3);
    assert.deepEqual(failureFinalStartedEvents[0]?.payload?.referenceFileIds, [
      referenceFileId1,
    ]);
    assert.equal(failureFinalStartedEvents[0]?.payload?.imageSize, "1K");
    assert.equal(failureFinalStartedEvents[0]?.payload?.aspectRatio, null);
    assert.equal(failureEvent?.attemptNo, 3);
    assert.equal(failureEvent?.payload?.errorCode, "TIMEOUT");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runSuccessAfterRetriesScenario();
  await runFinalFailureScenario();
  await runSingleImageRetryScenario();
  await runAIImageGenRetryScenario();
  await runAIMultiViewRestoreRetryScenario();
  await runAIImageToPlyRetryScenario();
}

void run();

async function runAIMultiViewRestoreRetryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-ai-multi-view-restore-retry-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));

    const renderFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "multi-view-render.png",
      "multi-view-render-content",
    );
    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "multi-view-reference.png",
      "multi-view-reference-content",
    );

    const createResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-ai-multi-view-restore-retry",
      nodeType: "aiMultiViewRestore",
      taskType: "multi-view-restore",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-multi-view-restore-retry",
      nodeTitle: "多视角修复重试",
      groups: [
        {
          groupId: "group-multi-view-retry",
          renderFileId,
          referenceFileId,
        },
      ],
    });

    const taskId = createResult.tasks[0]!.taskId;
    let renderUploadCount = 0;
    let queryCount = 0;

    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      new QueueTaskExecutorRegistry([
        new AIMultiViewRestoreTaskExecutor(
          executionsRepository,
          filesRepository,
          {
            async uploadFile(input) {
              if (input.snapshotLabel?.includes("upload-render")) {
                renderUploadCount += 1;

                if (renderUploadCount < 3) {
                  throw {
                    code: "NETWORK_ERROR",
                    message: `render upload failed at attempt ${renderUploadCount}`,
                    category: "provider_retryable",
                    retryable: true,
                  };
                }

                return {
                  fileName: "retry-render-uploaded.png",
                };
              }

              return {
                fileName: "retry-reference-uploaded.png",
              };
            },
            async createWorkflowTask() {
              return {
                taskId: "rh-task-mvr-retry-success",
                taskStatus: "QUEUED",
                clientId: "rh-client-mvr-retry-success",
                promptTips: "{\"result\": true}",
                promptTipsSummary: {
                  parseStatus: "parsed",
                  result: true,
                },
              };
            },
            async queryTaskResultV2() {
              queryCount += 1;

              if (queryCount === 1) {
                return {
                  taskId: "rh-task-mvr-retry-success",
                  taskStatus: "RUNNING",
                  clientId: "rh-client-mvr-retry-success",
                  promptTips: null,
                  errorCode: null,
                  errorMessage: null,
                  results: [],
                };
              }

              return {
                taskId: "rh-task-mvr-retry-success",
                taskStatus: "SUCCESS",
                clientId: "rh-client-mvr-retry-success",
                promptTips: null,
                errorCode: null,
                errorMessage: null,
                results: [
                  {
                    fileUrl: "https://example.test/retry-success/multi-view.png",
                    fileType: "png",
                    nodeId: "127",
                    taskCostTime: 11,
                  },
                ],
              };
            },
          },
          {
            async buildNodeInfoList() {
              return {
                workflowId: "2014516111097729025",
                nodeInfoList: [
                  {
                    nodeId: "124",
                    fieldName: "image",
                    fieldValue: "retry-render-uploaded.png",
                  },
                  {
                    nodeId: "102",
                    fieldName: "image",
                    fieldValue: "retry-reference-uploaded.png",
                  },
                ],
                snapshotPath: path.join(rootDir, "multi-view-retry-node-info-list.json"),
              };
            },
          },
          storageService,
          async () =>
            new Response(Buffer.from("multi-view-retry-result"), {
              status: 200,
              headers: {
                "Content-Type": "image/png",
              },
            }),
          {
            pollIntervalMs: 1,
            maxPollAttempts: 4,
            sleepImpl: async () => {},
          },
        ),
      ]),
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
    );

    const pollResult = await queueService.pollOnce();
    const task = await executionsRepository.getTaskById(taskId);
    const events = await executionsRepository.getTaskEvents(taskId);
    const run = await executionsRepository.getExecutionRun(createResult.runId);

    assert.equal(pollResult.claimedCount, 1);
    assert.equal(renderUploadCount, 3);
    assert.equal(task?.status, "completed");
    assert.equal(task?.currentAttemptNo, 3);
    assert.equal(task?.retryCount, 2);
    assert.equal(task?.lastErrorCode, null);
    assert.equal(run?.status, "completed");
    assert.ok(task?.resultFileId);
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_scheduled").length,
      2,
    );
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_started").length,
      2,
    );
    assert.ok(events.some((event) => event.eventType === "step_final_started"));
    assert.ok(events.some((event) => event.eventType === "step_final_completed"));
    assert.ok(events.some((event) => event.eventType === "task_artifact_received"));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("渲染图")
    ));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("参考图")
    ));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("任务已创建")
    ));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("开始创建")
    ));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("开始轮询")
    ));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("任务处理中")
    ));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("下载并保存")
    ));
    assert.ok(events.some((event) => event.eventType === "task_completed"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runAIImageToPlyRetryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-ai-image-to-ply-retry-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));

    const sourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "image-to-ply-retry.png",
      "image-to-ply-retry-content",
    );

    const createResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-ai-image-to-ply-retry",
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-image-to-ply-retry",
      nodeTitle: "图片转模型重试",
      groups: [
        {
          groupId: "group-image-to-ply-retry",
          sourceFileId,
        },
      ],
    });

    const taskId = createResult.tasks[0]!.taskId;
    let invocationCount = 0;
    let queryCount = 0;

    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      new QueueTaskExecutorRegistry([
        new AIImageToPlyTaskExecutor(
          executionsRepository,
          filesRepository,
          {
            async uploadFile() {
              invocationCount += 1;

              if (invocationCount < 3) {
                throw {
                  code: "NETWORK_ERROR",
                  message: `upload failed at attempt ${invocationCount}`,
                  category: "provider_retryable",
                  retryable: true,
                };
              }

              return {
                fileName: "retry-success-uploaded.png",
              };
            },
            async createWorkflowTask() {
              return {
                taskId: "rh-task-retry-success",
                taskStatus: "QUEUED",
                clientId: "rh-client-retry-success",
                promptTips: "{\"result\": true}",
                promptTipsSummary: {
                  parseStatus: "parsed",
                  result: true,
                },
              };
            },
            async queryTaskResultV2() {
              queryCount += 1;

              if (queryCount === 1) {
                return {
                  taskId: "rh-task-retry-success",
                  taskStatus: "QUEUED",
                  clientId: "rh-client-retry-success",
                  promptTips: null,
                  errorCode: null,
                  errorMessage: null,
                  results: [],
                };
              }

              if (queryCount === 2) {
                return {
                  taskId: "rh-task-retry-success",
                  taskStatus: "RUNNING",
                  clientId: "rh-client-retry-success",
                  promptTips: null,
                  errorCode: null,
                  errorMessage: null,
                  results: [],
                };
              }

              return {
                taskId: "rh-task-retry-success",
                taskStatus: "SUCCESS",
                clientId: "rh-client-retry-success",
                promptTips: null,
                errorCode: null,
                errorMessage: null,
                results: [
                  {
                    fileUrl: "https://example.test/retry-success/output.ply",
                    fileType: "ply",
                    nodeId: "5",
                    taskCostTime: 9,
                  },
                ],
              };
            },
          },
          {
            async buildNodeInfoList() {
              return {
                workflowId: "2014519004714508290",
                nodeInfoList: [
                  {
                    nodeId: "1",
                    fieldName: "image",
                    fieldValue: "retry-success-uploaded.png",
                  },
                ],
                snapshotPath: path.join(rootDir, "retry-node-info-list.json"),
              };
            },
          },
          storageService,
          async () =>
            new Response(Buffer.from("ply\nformat ascii 1.0\nend_header\n"), {
              status: 200,
              headers: {
                "Content-Type": "application/octet-stream",
              },
            }),
          {
            pollIntervalMs: 1,
            maxPollAttempts: 4,
            sleepImpl: async () => {},
          },
        ),
      ]),
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
    );

    const pollResult = await queueService.pollOnce();
    const task = await executionsRepository.getTaskById(taskId);
    const events = await executionsRepository.getTaskEvents(taskId);
    const run = await executionsRepository.getExecutionRun(createResult.runId);

    assert.equal(pollResult.claimedCount, 1);
    assert.equal(invocationCount, 3);
    assert.equal(task?.status, "completed");
    assert.equal(task?.currentAttemptNo, 3);
    assert.equal(task?.retryCount, 2);
    assert.equal(task?.lastErrorCode, null);
    assert.equal(run?.status, "completed");
    assert.ok(task?.resultFileId);
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_scheduled").length,
      2,
    );
    assert.equal(
      events.filter((event) => event.eventType === "task_retry_started").length,
      2,
    );
    assert.ok(events.some((event) => event.eventType === "step_final_started"));
    assert.ok(events.some((event) => event.eventType === "step_final_completed"));
    assert.ok(events.some((event) => event.eventType === "task_artifact_received"));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("上传"),
    ));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("创建"),
    ));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("处理中"),
    ));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message?.includes("下载并保存"),
    ));
    assert.ok(events.some((event) => event.eventType === "task_completed"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}
