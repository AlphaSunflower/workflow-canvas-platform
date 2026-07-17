import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
  AI_VIDEO_GEN_MODEL,
  AI_VIDEO_GEN_PROVIDER,
} from "../shared/src/index.ts";
import type { ExecutionTaskRecord } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { ProviderConcurrencyService } from "../worker/src/modules/queue/provider-concurrency.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";
import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";
import { createAIImageHdRequest, createAIImageToPlyRequest } from "./helpers/execution-request.fixture.ts";

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

async function createVideoExecution(input: {
  executionsService: ExecutionsService;
  userId?: string;
  workflowId: string;
  nodeId: string;
  nodeTitle: string;
  referenceFileIdsByGroup: string[][];
}) {
  const userId = input.userId ?? "user-a";

  return input.executionsService.createExecution({
    userId,
    workflowId: input.workflowId,
    nodeType: "aiVideoGen",
    taskType: "video-gen",
    executionMode: "legacy-grouped-task",
    nodeId: input.nodeId,
    nodeTitle: input.nodeTitle,
    prompt: "Generate a smooth camera move around the subject.",
    model: AI_VIDEO_GEN_MODEL,
    duration: AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
    groups: input.referenceFileIdsByGroup.map((referenceFileIds, index) => ({
      groupId: `video-group-${index + 1}`,
      referenceFileIds,
    })),
  });
}

async function loadTasksByIds(
  executionsRepository: ExecutionsRepository,
  taskIds: string[],
) {
  return Promise.all(taskIds.map((taskId) => executionsRepository.getTaskById(taskId)));
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 1000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  throw new Error("WAIT_FOR_CONDITION_TIMEOUT");
}

class BlockingQueueTaskExecutor {
  readonly startedTaskIds: string[] = [];
  readonly completedTaskIds: string[] = [];
  private readonly releaseByTaskId = new Map<string, () => void>();

  async execute(input: { task: { id: string } }): Promise<{ resultFileId: string }> {
    this.startedTaskIds.push(input.task.id);

    await new Promise<void>((resolve) => {
      this.releaseByTaskId.set(input.task.id, resolve);
    });

    this.releaseByTaskId.delete(input.task.id);
    this.completedTaskIds.push(input.task.id);

    return {
      resultFileId: `result-${input.task.id}`,
    };
  }

  release(taskId: string): void {
    const release = this.releaseByTaskId.get(taskId);

    if (!release) {
      throw new Error(`TASK_NOT_BLOCKED:${taskId}`);
    }

    release();
  }

  releaseAll(): void {
    for (const release of [...this.releaseByTaskId.values()]) {
      release();
    }
  }

  getBlockedCount(): number {
    return this.releaseByTaskId.size;
  }
}

async function runProviderAwareSchedulingScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-provider-aware-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

    const sourceFileIds = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        registerReadyFile(
          filesRepository,
          "user-a",
          `source-${index + 1}.png`,
          `source-content-${index + 1}`,
        )),
    );

    const runninghubCreateResult = await executionsService.createExecution(createAIImageToPlyRequest({
      workflowId: "workflow-provider-aware-runninghub",
      nodeId: "node-runninghub-scheduler",
      nodeTitle: "runninghub scheduler",
      groups: sourceFileIds.slice(0, 6).map((sourceFileId, index) => ({
        groupId: `rh-group-${index + 1}`,
        sourceFileId,
      })),
    }));

    const laozhangCreateResult = await executionsService.createExecution(createAIImageHdRequest({
      workflowId: "workflow-provider-aware-laozhang",
      nodeId: "node-laozhang-scheduler",
      nodeTitle: "laozhang scheduler",
      groups: [
        {
          groupId: "lz-group-1",
          sourceFileId: sourceFileIds[6]!,
          imageSize: "1K",
          aspectRatio: "1:1",
        },
      ],
    }));

    const releaseBarriers: Array<() => void> = [];
    const startedTaskIds: string[] = [];
    const executeCallsByProvider = new Map<string, number>();

    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute(input) {
          startedTaskIds.push(input.task.id);
          const providerKey = input.task.provider ?? input.task.taskType;
          executeCallsByProvider.set(
            providerKey,
            (executeCallsByProvider.get(providerKey) ?? 0) + 1,
          );

          await new Promise<void>((resolve) => {
            releaseBarriers.push(resolve);
          });

          return {
            resultFileId: `result-${input.task.id}`,
          };
        },
      },
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
      new ProviderConcurrencyService({
        maxConcurrencyByProvider: {
          runninghub: 3,
        },
      }),
      {
        scanLimitMultiplier: 4,
      },
    );

    const pollPromise = queueService.pollOnce();
    await waitForCondition(() => startedTaskIds.length === 4);

    const runninghubTasks = await Promise.all(
      runninghubCreateResult.tasks.map((task) => executionsRepository.getTaskById(task.taskId)),
    );
    const laozhangTask = await executionsRepository.getTaskById(
      laozhangCreateResult.tasks[0]!.taskId,
    );
    const queueHealth = queueService.getHealth();

    assert.equal(startedTaskIds.length, 4);
    assert.equal(executeCallsByProvider.get("runninghub"), 3);
    assert.equal(executeCallsByProvider.get("laozhang"), 1);
    assert.equal(
      runninghubTasks.filter((task: ExecutionTaskRecord | null) => task?.status === "processing").length,
      3,
    );
    assert.equal(
      runninghubTasks.filter((task: ExecutionTaskRecord | null) => task?.status === "queued").length,
      3,
    );
    assert.equal(laozhangTask?.status, "processing");
    assert.equal(queueHealth.activeTaskCount, 4);
    assert.equal(queueHealth.maxConcurrency, null);
    assert.equal(queueHealth.queuedTaskCount, 3);
    assert.equal(queueHealth.queuedTaskCountByProvider.runninghub, 3);
    assert.equal(queueHealth.queuedTaskCountByProvider.laozhang ?? 0, 0);
    assert.equal(queueHealth.providerConcurrency.providers.runninghub?.active, 3);
    assert.equal(queueHealth.providerConcurrency.providers.runninghub?.max, 3);
    assert.equal(queueHealth.providerConcurrency.providers.runninghub?.available, 0);
    assert.equal(queueHealth.lastClaimedCount, 4);
    assert.ok(queueHealth.lastProviderSkippedCount >= 1);
    assert.equal(queueHealth.lastProviderSlotSkippedProvider, "runninghub");
    assert.ok(queueHealth.lastProviderSlotSkippedTaskId);
    assert.ok(queueHealth.lastProviderSlotSkippedTaskNo);
    assert.ok(queueHealth.lastProviderSlotSkippedAt);

    assert.equal(releaseBarriers.length, 4);
    for (const releaseBarrier of releaseBarriers.splice(0)) {
      releaseBarrier();
    }
    const pollResult = await pollPromise;
    const completedQueueHealth = queueService.getHealth();

    assert.equal(pollResult.claimedCount, 4);
    assert.equal(
      pollResult.claimedTasks.filter((item) => item.task.provider === "runninghub").length,
      3,
    );
    assert.equal(
      pollResult.claimedTasks.filter((item) => item.task.provider === "laozhang").length,
      1,
    );
    assert.equal(completedQueueHealth.lastClaimedCount, 4);
    assert.equal(completedQueueHealth.queuedTaskCount, 3);
    assert.ok(completedQueueHealth.lastDispatchKickScheduledAt);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runVideoProviderUnlimitedScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-video-unlimited-"));
  const previousVeoMaxConcurrency = process.env.LAOZHANG_VEO_MAX_CONCURRENCY;

  delete process.env.LAOZHANG_VEO_MAX_CONCURRENCY;

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

    const sourceFileIds = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        registerReadyFile(
          filesRepository,
          "user-a",
          `video-source-${index + 1}.png`,
          `video-source-content-${index + 1}`,
        )),
    );

    const createResult = await createVideoExecution({
      executionsService,
      workflowId: "workflow-video-unlimited",
      nodeId: "node-video-unlimited",
      nodeTitle: "video unlimited",
      referenceFileIdsByGroup: sourceFileIds.map((fileId) => [fileId]),
    });

    const executor = new BlockingQueueTaskExecutor();
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      executor,
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
      undefined,
      {
        scanLimitMultiplier: 4,
      },
    );

    const dispatchResult = await queueService.dispatchOnce();

    await waitForCondition(() => executor.getBlockedCount() === 3);

    const tasks = await loadTasksByIds(
      executionsRepository,
      createResult.tasks.map((task) => task.taskId),
    );
    const queueHealth = queueService.getHealth();

    assert.equal(dispatchResult.claimedCount, 3);
    assert.ok(dispatchResult.claimedTasks.every((item) => item.task.provider === AI_VIDEO_GEN_PROVIDER));
    assert.equal(executor.startedTaskIds.length, 3);
    assert.equal(tasks.filter((task) => task?.status === "processing").length, 3);
    assert.equal(tasks.filter((task) => task?.status === "queued").length, 0);
    assert.equal(queueHealth.queuedTaskCountByProvider[AI_VIDEO_GEN_PROVIDER] ?? 0, 0);
    assert.equal(queueHealth.providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.active, 3);
    assert.equal(queueHealth.providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.max, null);
    assert.equal(queueHealth.providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.available, null);

    executor.releaseAll();

    await waitForCondition(
      () => (queueService.getHealth().providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.active ?? 0) === 0,
    );

    const completedTasks = await loadTasksByIds(
      executionsRepository,
      createResult.tasks.map((task) => task.taskId),
    );

    assert.equal(completedTasks.filter((task) => task?.status === "completed").length, 3);
  } finally {
    if (typeof previousVeoMaxConcurrency === "string") {
      process.env.LAOZHANG_VEO_MAX_CONCURRENCY = previousVeoMaxConcurrency;
    } else {
      delete process.env.LAOZHANG_VEO_MAX_CONCURRENCY;
    }

    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runVideoProviderLimitedScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-video-limited-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

    const sourceFileIds = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        registerReadyFile(
          filesRepository,
          "user-a",
          `video-limited-source-${index + 1}.png`,
          `video-limited-source-content-${index + 1}`,
        )),
    );

    const createResult = await createVideoExecution({
      executionsService,
      workflowId: "workflow-video-limited",
      nodeId: "node-video-limited",
      nodeTitle: "video limited",
      referenceFileIdsByGroup: sourceFileIds.map((fileId) => [fileId]),
    });

    const executor = new BlockingQueueTaskExecutor();
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      executor,
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
      new ProviderConcurrencyService({
        maxConcurrencyByProvider: {
          [AI_VIDEO_GEN_PROVIDER]: 2,
        },
      }),
      {
        scanLimitMultiplier: 4,
      },
    );

    const firstDispatch = await queueService.dispatchOnce();

    await waitForCondition(() => executor.getBlockedCount() === 2);

    const firstRoundTasks = await loadTasksByIds(
      executionsRepository,
      createResult.tasks.map((task) => task.taskId),
    );
    const firstQueueHealth = queueService.getHealth();

    assert.equal(firstDispatch.claimedCount, 2);
    assert.equal(firstRoundTasks.filter((task) => task?.status === "processing").length, 2);
    assert.equal(firstRoundTasks.filter((task) => task?.status === "queued").length, 1);
    assert.equal(firstRoundTasks.filter((task) => task?.status === "failed").length, 0);
    assert.equal(firstQueueHealth.queuedTaskCountByProvider[AI_VIDEO_GEN_PROVIDER], 1);
    assert.equal(firstQueueHealth.providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.active, 2);
    assert.equal(firstQueueHealth.providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.max, 2);
    assert.equal(firstQueueHealth.providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.available, 0);
    assert.equal(firstQueueHealth.lastProviderSlotSkippedProvider, AI_VIDEO_GEN_PROVIDER);

    executor.release(firstDispatch.claimedTasks[0]!.task.id);

    await waitForCondition(
      () => (queueService.getHealth().providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.active ?? 0) === 1,
    );

    const secondDispatch = await queueService.dispatchOnce();

    await waitForCondition(() => executor.getBlockedCount() === 2);

    const secondRoundTasks = await loadTasksByIds(
      executionsRepository,
      createResult.tasks.map((task) => task.taskId),
    );
    const secondQueueHealth = queueService.getHealth();

    assert.equal(secondDispatch.claimedCount, 1);
    assert.equal(secondRoundTasks.filter((task) => task?.status === "processing").length, 2);
    assert.equal(secondRoundTasks.filter((task) => task?.status === "completed").length, 1);
    assert.equal(secondRoundTasks.filter((task) => task?.status === "queued").length, 0);
    assert.equal(secondRoundTasks.filter((task) => task?.status === "failed").length, 0);
    assert.equal(secondQueueHealth.queuedTaskCountByProvider[AI_VIDEO_GEN_PROVIDER] ?? 0, 0);
    assert.equal(secondQueueHealth.providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.active, 2);
    assert.equal(secondQueueHealth.providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.available, 0);

    executor.releaseAll();

    await waitForCondition(
      () => (queueService.getHealth().providerConcurrency.providers[AI_VIDEO_GEN_PROVIDER]?.active ?? 0) === 0,
    );

    const completedTasks = await loadTasksByIds(
      executionsRepository,
      createResult.tasks.map((task) => task.taskId),
    );

    assert.equal(completedTasks.filter((task) => task?.status === "completed").length, 3);
    assert.equal(completedTasks.filter((task) => task?.status === "failed").length, 0);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runProviderAwareSchedulingScenario();
  await runVideoProviderUnlimitedScenario();
  await runVideoProviderLimitedScenario();
}

void run();
