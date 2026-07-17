import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";
import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";
import { createRunningHubBackpressureError } from "../worker/src/modules/providers/runninghub/runninghub.errors.ts";
import { ProviderConcurrencyService } from "../worker/src/modules/queue/provider-concurrency.service.ts";
import { createAIImageToPlyRequest } from "./helpers/execution-request.fixture.ts";
import { createExecutionStoreInput } from "./helpers/execution-store.fixture.ts";

async function runBackpressureRequeueScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "runninghub-task-queue-maxed-"));

  try {
    const executionsRepository = new ExecutionsRepository(rootDir);
    const createResult = await executionsRepository.createExecution(createExecutionStoreInput({
      run: {
        workflowId: "workflow-runninghub-backpressure",
        projectId: "project-runninghub-backpressure",
        nodeId: "node-runninghub-backpressure",
        nodeTitle: "runninghub backpressure",
        provider: "runninghub",
        requestPayload: createAIImageToPlyRequest({
          workflowId: "workflow-runninghub-backpressure",
          nodeId: "node-runninghub-backpressure",
          nodeTitle: "runninghub backpressure",
          groups: [
            {
              groupId: "group-1",
              sourceFileId: "file-1",
            },
          ],
        }),
      },
      tasks: [
        {
          workflowId: "workflow-runninghub-backpressure",
          projectId: "project-runninghub-backpressure",
          nodeId: "node-runninghub-backpressure",
          nodeTitle: "runninghub backpressure",
          groupId: "group-1",
          groupOrder: 1,
          provider: "runninghub",
          model: null,
          input: {
            sourceFileId: "file-1",
          },
        },
      ],
    }));

    const taskId = createResult.tasks[0]!.taskId;
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute() {
          throw createRunningHubBackpressureError(
            "RunningHub 队列繁忙，等待后端重新调度。",
          );
        },
      },
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
        providerBackpressureDelayMs: 10,
      }),
      new ProviderConcurrencyService({
        maxConcurrencyByProvider: {
          runninghub: 3,
        },
      }),
    );

    const pollResult = await queueService.pollOnce();
    const task = await executionsRepository.getTaskById(taskId);
    const events = await executionsRepository.getTaskEvents(taskId);

    assert.equal(pollResult.claimedCount, 1);
    assert.equal(task?.status, "queued");
    assert.equal(task?.currentAttemptNo, 1);
    assert.equal(task?.retryCount, 0);
    assert.equal(task?.lastErrorCode, "PROVIDER_ERROR");
    assert.equal(task?.lastErrorMessage, "RunningHub 队列繁忙，等待后端重新调度。");
    assert.equal(
      events.filter((event) => event.eventType === "task_failed").length,
      0,
    );
    assert.ok(
      events.some((event) =>
        event.eventType === "task_retry_scheduled"
        && event.message?.includes("RunningHub 队列繁忙"),
      ),
    );
    const queueHealth = queueService.getHealth();
    assert.equal(queueHealth.providerConcurrency.providers.runninghub?.active ?? 0, 0);
    assert.equal(queueHealth.providerConcurrency.providers.runninghub?.available ?? 0, 3);
    assert.equal(queueHealth.lastProviderBackpressure?.taskId, taskId);
    assert.equal(queueHealth.lastProviderBackpressure?.provider, "runninghub");
    assert.equal(queueHealth.lastProviderBackpressure?.providerCode, "task_queue_maxed");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runBackpressureRequeueScenario();
}

void run();
