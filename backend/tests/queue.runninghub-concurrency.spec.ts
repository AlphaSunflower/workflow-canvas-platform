import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { ProviderConcurrencyService } from "../worker/src/modules/queue/provider-concurrency.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";
import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";
import { createAIImageHdRequest } from "./helpers/execution-request.fixture.ts";
import {
  createRunningHubImageToPlyExecution,
  loadTasksByCreateResult,
  registerReadyImageFile,
} from "./helpers/runninghub-queue-test.utils.ts";

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

async function runRunningHubConcurrencyLimitScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-runninghub-concurrency-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

    const sourceFileIds = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        registerReadyImageFile(
          filesRepository,
          "user-a",
          `runninghub-source-${index + 1}.png`,
          `runninghub-source-${index + 1}`,
        )),
    );

    const runninghubCreateResult = await createRunningHubImageToPlyExecution({
      executionsService,
      nodeId: "node-runninghub-concurrency",
      nodeTitle: "runninghub concurrency",
      sourceFileIds: sourceFileIds.slice(0, 10),
    });

    const laozhangCreateResult = await executionsService.createExecution(createAIImageHdRequest({
      workflowId: "workflow-runninghub-concurrency-laozhang",
      nodeId: "node-laozhang-concurrency",
      nodeTitle: "laozhang concurrency",
      groups: [
        {
          groupId: "lz-group-1",
          sourceFileId: sourceFileIds[10]!,
          imageSize: "1K",
          aspectRatio: "1:1",
        },
      ],
    }));

    const startedTaskIds: string[] = [];
    const releaseBarriers: Array<() => void> = [];

    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute(input) {
          startedTaskIds.push(input.task.id);
          await new Promise<void>((resolve) => {
            releaseBarriers.push(resolve);
          });
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

    const runninghubTasks = await loadTasksByCreateResult(
      executionsRepository,
      runninghubCreateResult.tasks.map((task) => task.taskId),
    );
    const fourthRunningHubTask = runninghubTasks[3];
    const laozhangTask = await executionsRepository.getTaskById(
      laozhangCreateResult.tasks[0]!.taskId,
    );
    const queueHealth = queueService.getHealth();

    assert.equal(startedTaskIds.length, 4);
    assert.equal(
      runninghubTasks.filter((task) => task?.status === "processing").length,
      3,
    );
    assert.equal(fourthRunningHubTask?.status, "queued");
    assert.equal(laozhangTask?.status, "processing");
    assert.equal(queueHealth.providerConcurrency.providers.runninghub?.active, 3);
    assert.equal(queueHealth.providerConcurrency.providers.runninghub?.available, 0);
    assert.equal(queueHealth.maxConcurrency, null);
    assert.equal(queueHealth.queuedTaskCountByProvider.runninghub, 7);
    assert.equal(queueHealth.queuedTaskCountByProvider.laozhang ?? 0, 0);

    assert.equal(releaseBarriers.length, 4);
    for (const releaseBarrier of releaseBarriers.splice(0)) {
      releaseBarrier();
    }
    const pollResult = await pollPromise;
    const releasedHealth = queueService.getHealth();

    assert.equal(pollResult.claimedCount, 4);
    assert.equal(releasedHealth.providerConcurrency.providers.runninghub?.active ?? 0, 0);
    assert.equal(releasedHealth.providerConcurrency.providers.runninghub?.available ?? 0, 3);
    assert.ok(releasedHealth.lastDispatchKickScheduledAt);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runRunningHubConcurrencyLimitScenario();
}

void run();
