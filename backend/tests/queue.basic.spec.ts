import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { AIImageHdTaskExecutor } from "../worker/src/modules/executors/ai-image-hd.executor.ts";
import { AIFloorplanColorizeTaskExecutor } from "../worker/src/modules/executors/ai-floorplan-colorize.executor.ts";
import { QueueTaskExecutorRegistry } from "../worker/src/modules/executors/executor.registry.ts";
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

async function runWhiteModelQueueScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-test-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const executorCalls: string[] = [];
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute(input) {
          executorCalls.push(`start:${input.task.id}`);
          await new Promise((resolve) => {
            setTimeout(resolve, 40);
          });
          executorCalls.push(`end:${input.task.id}`);

          return {
            resultFileId: `result-${input.task.id}`,
            resultStorageKey: `outputs/${input.task.id}.png`,
            lineartFileId: `lineart-${input.task.id}`,
            depthFileId: `depth-${input.task.id}`,
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

    const whiteModelFileId1 = await registerReadyFile(
      filesRepository,
      "user-a",
      "white-model-1.png",
      "white-model-image-1",
    );
    const styleFileId1 = await registerReadyFile(
      filesRepository,
      "user-a",
      "style-1.png",
      "style-image-1",
    );
    const whiteModelFileId2 = await registerReadyFile(
      filesRepository,
      "user-a",
      "white-model-2.png",
      "white-model-image-2",
    );
    const styleFileId2 = await registerReadyFile(
      filesRepository,
      "user-a",
      "style-2.png",
      "style-image-2",
    );

    const createResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-queue-white-model",
      nodeType: "aiModelRenderTransfer",
      taskType: "model-render-transfer",
      executionMode: "legacy-grouped-task",
      nodeId: "node-queue",
      nodeTitle: "白模渲染队列测试",
      groups: [
        {
          groupId: "group-1",
          whiteModelFileId: whiteModelFileId1,
          styleReferenceFileId: styleFileId1,
        },
        {
          groupId: "group-2",
          whiteModelFileId: whiteModelFileId2,
          styleReferenceFileId: styleFileId2,
        },
      ],
    });

    const [pollResultA, pollResultB] = await Promise.all([
      queueService.pollOnce(),
      queueService.pollOnce(),
    ]);
    const totalClaimedCount = pollResultA.claimedCount + pollResultB.claimedCount;
    const claimedTaskIds = [...pollResultA.claimedTasks, ...pollResultB.claimedTasks].map(
      (item) => item.task.id,
    );

    assert.equal(totalClaimedCount, 2);
    assert.equal(claimedTaskIds.length, 2);
    assert.equal(new Set(claimedTaskIds).size, 2);
    assert.equal(executorCalls.length, 4);
    assert.ok(executorCalls.some((item) => item.startsWith("start:")));
    assert.ok(executorCalls.some((item) => item.startsWith("end:")));

    const run = await executionsRepository.getExecutionRun(createResult.runId);
    const tasks = await executionsRepository.getTasksByRunId(createResult.runId);
    const eventsTask1 = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
    const eventsTask2 = await executionsRepository.getTaskEvents(createResult.tasks[1]!.taskId);

    assert.ok(run);
    assert.equal(run?.status, "completed");
    assert.ok(run?.startedAt);
    assert.ok(run?.completedAt);
    assert.equal(run?.completedTaskCount, 2);
    assert.equal(run?.failedTaskCount, 0);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0]?.status, "completed");
    assert.equal(tasks[1]?.status, "completed");
    assert.ok(tasks[0]?.startedAt);
    assert.ok(tasks[0]?.completedAt);
    assert.ok(tasks[1]?.startedAt);
    assert.ok(tasks[1]?.completedAt);
    assert.equal(
      eventsTask1.filter((event) => event.eventType === "task_started").length,
      1,
    );
    assert.equal(
      eventsTask2.filter((event) => event.eventType === "task_started").length,
      1,
    );
    assert.ok(eventsTask1.some((event) => event.eventType === "task_completed"));
    assert.ok(eventsTask2.some((event) => event.eventType === "task_completed"));
    assert.ok(eventsTask1.some((event) => event.eventType === "task_progress"));
    assert.ok(eventsTask2.some((event) => event.eventType === "task_progress"));
    assert.equal(
      eventsTask1.filter((event) => event.eventType === "task_retry_started").length,
      0,
    );
    assert.equal(
      eventsTask2.filter((event) => event.eventType === "task_retry_started").length,
      0,
    );

    const secondPollResult = await queueService.pollOnce();

    assert.equal(secondPollResult.claimedCount, 0);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runSingleImageQueueScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-single-image-test-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const providerCalls: string[] = [];
    const helper = new SingleImageGenerateHelper(
      executionsRepository,
      filesRepository,
      {
        async generateImage(input) {
          providerCalls.push(
            `${input.snapshotLabel}:${input.imageSize ?? "none"}:${input.aspectRatio ?? "auto"}`,
          );

          return {
            imageBase64: Buffer.from(`generated:${input.snapshotLabel}`).toString("base64"),
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

    const imageHdSourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "source-hd.png",
      "source-hd-content",
    );
    const floorplanSourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "source-floorplan.png",
      "source-floorplan-content",
    );

    const createImageHdResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-queue-image-hd",
      nodeType: "aiImageHd",
      taskType: "image-hd",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-hd",
      nodeTitle: "图片高清化",
      model: "gemini-3-pro-image-preview",
      groups: [
        {
          groupId: "group-image-hd",
          sourceFileId: imageHdSourceFileId,
          imageSize: "4K",
          aspectRatio: "16:9",
        },
      ],
    });
    const createFloorplanResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-queue-floorplan",
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
      executionMode: "legacy-grouped-task",
      nodeId: "node-floorplan",
      nodeTitle: "平面图转彩平",
      model: "gemini-3-pro-image-preview",
      groups: [
        {
          groupId: "group-floorplan",
          sourceFileId: floorplanSourceFileId,
          imageSize: "2K",
          aspectRatio: "3:4",
        },
      ],
    });

    const [pollResultA, pollResultB] = await Promise.all([
      queueService.pollOnce(),
      queueService.pollOnce(),
    ]);

    assert.equal(pollResultA.claimedCount + pollResultB.claimedCount, 2);
    assert.equal(providerCalls.length, 2);
    assert.ok(providerCalls.some((call) => call.includes("-single-image:4K:16:9")));
    assert.ok(providerCalls.some((call) => call.includes("-single-image:2K:3:4")));

    const imageHdTask = await executionsRepository.getTaskById(createImageHdResult.tasks[0]!.taskId);
    const floorplanTask = await executionsRepository.getTaskById(createFloorplanResult.tasks[0]!.taskId);
    const imageHdEvents = await executionsRepository.getTaskEvents(createImageHdResult.tasks[0]!.taskId);
    const floorplanEvents = await executionsRepository.getTaskEvents(createFloorplanResult.tasks[0]!.taskId);

    assert.equal(imageHdTask?.status, "completed");
    assert.equal(floorplanTask?.status, "completed");
    assert.ok(imageHdTask?.resultFileId);
    assert.ok(floorplanTask?.resultFileId);
    assert.ok(imageHdEvents.some((event) => event.eventType === "step_final_started"));
    assert.ok(imageHdEvents.some((event) => event.eventType === "step_final_completed"));
    assert.ok(floorplanEvents.some((event) => event.eventType === "step_final_started"));
    assert.ok(floorplanEvents.some((event) => event.eventType === "step_final_completed"));

    const imageHdResultContent = await filesRepository.readFileContent(imageHdTask!.resultFileId!);
    const floorplanResultContent = await filesRepository.readFileContent(floorplanTask!.resultFileId!);
    const imageHdResultFile = await filesRepository.findFileById(imageHdTask!.resultFileId!);
    const floorplanResultFile = await filesRepository.findFileById(floorplanTask!.resultFileId!);

    assert.equal(
      imageHdResultContent?.buffer.toString("utf8"),
      `generated:${imageHdTask!.taskNo}-single-image`,
    );
    assert.equal(
      floorplanResultContent?.buffer.toString("utf8"),
      `generated:${floorplanTask!.taskNo}-single-image`,
    );
    assert.equal(imageHdResultFile?.userId, "user-a");
    assert.equal(imageHdResultFile?.sourceType, "output");
    assert.equal(floorplanResultFile?.userId, "user-a");
    assert.equal(floorplanResultFile?.sourceType, "output");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runWhiteModelQueueScenario();
  await runSingleImageQueueScenario();
}

void run();
