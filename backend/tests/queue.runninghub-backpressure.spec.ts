import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { ExecutionRunService } from "../worker/src/modules/execution-run/execution-run.service.ts";
import { createRunningHubBackpressureError } from "../worker/src/modules/providers/runninghub/runninghub.errors.ts";
import { ProviderConcurrencyService } from "../worker/src/modules/queue/provider-concurrency.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";
import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";
import { createAIImageToPlyRequest } from "./helpers/execution-request.fixture.ts";
import { createExecutionStoreInput } from "./helpers/execution-store.fixture.ts";

class QueueServiceStopStub {
  private dispatchKickHandler: (() => void) | null = null;
  public pollCalls = 0;

  setDispatchKickHandler(handler: (() => void) | null): void {
    this.dispatchKickHandler = handler;
  }

  async dispatchOnce() {
    this.pollCalls += 1;

    if (this.pollCalls === 1) {
      setTimeout(() => {
        this.dispatchKickHandler?.();
      }, 20);
    }

    return {
      claimedTasks: [],
      claimedCount: 0,
    };
  }
}

function createRunningHubTaskInput(taskSuffix: string) {
  return createExecutionStoreInput({
    run: {
      workflowId: `workflow-${taskSuffix}`,
      projectId: `project-${taskSuffix}`,
      nodeId: `node-${taskSuffix}`,
      nodeTitle: `node-${taskSuffix}`,
      provider: "runninghub",
      requestPayload: createAIImageToPlyRequest({
        workflowId: `workflow-${taskSuffix}`,
        nodeId: `node-${taskSuffix}`,
        nodeTitle: `node-${taskSuffix}`,
        groups: [
          {
            groupId: `group-${taskSuffix}`,
            sourceFileId: `file-${taskSuffix}`,
          },
        ],
      }),
    },
    tasks: [
      {
        workflowId: `workflow-${taskSuffix}`,
        projectId: `project-${taskSuffix}`,
        nodeId: `node-${taskSuffix}`,
        nodeTitle: `node-${taskSuffix}`,
        groupId: `group-${taskSuffix}`,
        groupOrder: 1,
        provider: "runninghub",
        model: null,
        input: {
          sourceFileId: `file-${taskSuffix}`,
        },
      },
    ],
  });
}

async function runBackpressureRequeueScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-runninghub-backpressure-"));

  try {
    const executionsRepository = new ExecutionsRepository(rootDir);
    const createResult = await executionsRepository.createExecution(
      createRunningHubTaskInput("backpressure"),
    );

    let executeCalls = 0;
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute() {
          executeCalls += 1;
          throw createRunningHubBackpressureError("RunningHub 队列繁忙，等待后端重新调度。");
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

    await queueService.pollOnce();

    const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    const health = queueService.getHealth();

    assert.equal(executeCalls, 1);
    assert.equal(task?.status, "queued");
    assert.equal(task?.lastErrorCode, "PROVIDER_ERROR");
    assert.equal(health.providerConcurrency.providers.runninghub?.active ?? 0, 0);
    assert.equal(health.providerConcurrency.providers.runninghub?.available ?? 0, 3);
    assert.equal(health.lastProviderBackpressure?.providerCode, "task_queue_maxed");

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    assert.ok(queueService.getHealth().lastDispatchKickScheduledAt);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runProviderSlotReleaseOnFailureAndThrowScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-runninghub-release-"));

  try {
    const executionsRepository = new ExecutionsRepository(rootDir);
    const firstCreateResult = await executionsRepository.createExecution(
      createRunningHubTaskInput("failure"),
    );
    const secondCreateResult = await executionsRepository.createExecution(
      createRunningHubTaskInput("throw"),
    );

    let executeCalls = 0;
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute(input) {
          executeCalls += 1;

          if (input.task.id === firstCreateResult.tasks[0]!.taskId) {
            throw {
              code: "PROVIDER_ERROR",
              message: "final failure",
              category: "provider_retryable",
              retryable: false,
              provider: "runninghub",
            };
          }

          throw new Error("UNEXPECTED_THROW");
        },
      },
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
      new ProviderConcurrencyService({
        maxConcurrencyByProvider: {
          runninghub: 1,
        },
      }),
      {
        maxConcurrency: 1,
        scanLimitMultiplier: 4,
      },
    );

    await queueService.pollOnce();
    let health = queueService.getHealth();
    assert.equal(executeCalls, 1);
    assert.equal(health.providerConcurrency.providers.runninghub?.active ?? 0, 0);
    assert.equal(health.providerConcurrency.providers.runninghub?.available ?? 0, 1);

    await queueService.pollOnce();
    health = queueService.getHealth();
    const secondTask = await executionsRepository.getTaskById(secondCreateResult.tasks[0]!.taskId);

    assert.equal(executeCalls, 2);
    assert.equal(secondTask?.status, "failed");
    assert.equal(secondTask?.lastErrorCode, "UNKNOWN_ERROR");
    assert.equal(health.providerConcurrency.providers.runninghub?.active ?? 0, 0);
    assert.equal(health.providerConcurrency.providers.runninghub?.available ?? 0, 1);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runStopPreventsFurtherDispatchScenario(): Promise<void> {
  const queueService = new QueueServiceStopStub();
  const executionRunService = new ExecutionRunService(
    queueService as unknown as QueueService,
    5_000,
  );

  await executionRunService.start();
  assert.equal(queueService.pollCalls, 1);

  await executionRunService.stop();

  await new Promise((resolve) => {
    setTimeout(resolve, 60);
  });

  assert.equal(queueService.pollCalls, 1);
  assert.equal(executionRunService.getHealth().status, "stopped");
  assert.equal(executionRunService.getHealth().pendingPoll, false);
}

async function run(): Promise<void> {
  await runBackpressureRequeueScenario();
  await runProviderSlotReleaseOnFailureAndThrowScenario();
  await runStopPreventsFurtherDispatchScenario();
}

void run();
