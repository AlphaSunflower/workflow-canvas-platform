import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { ProviderConcurrencyService } from "../worker/src/modules/queue/provider-concurrency.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";
import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";
import { createAIImageToPlyRequest } from "./helpers/execution-request.fixture.ts";
import { createExecutionStoreInput } from "./helpers/execution-store.fixture.ts";

async function runCreatedAtFifoScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-runninghub-fifo-created-at-"));

  try {
    const executionsRepository = new ExecutionsRepository(rootDir);

    const firstCreateResult = await executionsRepository.createExecution(createExecutionStoreInput({
      run: {
        workflowId: "workflow-fifo-a",
        projectId: "project-fifo-a",
        nodeId: "node-fifo-a",
        nodeTitle: "fifo a",
        provider: "runninghub",
        requestPayload: createAIImageToPlyRequest({
          workflowId: "workflow-fifo-a",
          nodeId: "node-fifo-a",
          nodeTitle: "fifo a",
          groups: [{ groupId: "group-a", sourceFileId: "file-a" }],
        }),
      },
      tasks: [
        {
          workflowId: "workflow-fifo-a",
          projectId: "project-fifo-a",
          nodeId: "node-fifo-a",
          nodeTitle: "fifo a",
          groupId: "group-a",
          groupOrder: 1,
          provider: "runninghub",
          model: null,
          input: {
            sourceFileId: "file-a",
          },
        },
      ],
    }));

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    const secondCreateResult = await executionsRepository.createExecution(createExecutionStoreInput({
      run: {
        workflowId: "workflow-fifo-b",
        projectId: "project-fifo-b",
        nodeId: "node-fifo-b",
        nodeTitle: "fifo b",
        provider: "runninghub",
        requestPayload: createAIImageToPlyRequest({
          workflowId: "workflow-fifo-b",
          nodeId: "node-fifo-b",
          nodeTitle: "fifo b",
          groups: [{ groupId: "group-b", sourceFileId: "file-b" }],
        }),
      },
      tasks: [
        {
          workflowId: "workflow-fifo-b",
          projectId: "project-fifo-b",
          nodeId: "node-fifo-b",
          nodeTitle: "fifo b",
          groupId: "group-b",
          groupOrder: 1,
          provider: "runninghub",
          model: null,
          input: {
            sourceFileId: "file-b",
          },
        },
      ],
    }));

    const startedTaskIds: string[] = [];
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute(input) {
          startedTaskIds.push(input.task.id);
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
    await queueService.pollOnce();

    assert.deepEqual(startedTaskIds, [
      firstCreateResult.tasks[0]!.taskId,
      secondCreateResult.tasks[0]!.taskId,
    ]);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runGroupOrderFifoScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-runninghub-fifo-group-order-"));

  try {
    const executionsRepository = new ExecutionsRepository(rootDir);
    const createResult = await executionsRepository.createExecution(createExecutionStoreInput({
      run: {
        workflowId: "workflow-fifo-group-order",
        projectId: "project-fifo-group-order",
        nodeId: "node-fifo-group-order",
        nodeTitle: "fifo group order",
        provider: "runninghub",
        requestPayload: createAIImageToPlyRequest({
          workflowId: "workflow-fifo-group-order",
          nodeId: "node-fifo-group-order",
          nodeTitle: "fifo group order",
          groups: [
            { groupId: "group-2", sourceFileId: "file-2" },
            { groupId: "group-1", sourceFileId: "file-1" },
            { groupId: "group-3", sourceFileId: "file-3" },
          ],
        }),
      },
      tasks: [
        {
          workflowId: "workflow-fifo-group-order",
          projectId: "project-fifo-group-order",
          nodeId: "node-fifo-group-order",
          nodeTitle: "fifo group order",
          groupId: "group-2",
          groupOrder: 2,
          provider: "runninghub",
          model: null,
          input: {
            sourceFileId: "file-2",
          },
        },
        {
          workflowId: "workflow-fifo-group-order",
          projectId: "project-fifo-group-order",
          nodeId: "node-fifo-group-order",
          nodeTitle: "fifo group order",
          groupId: "group-1",
          groupOrder: 1,
          provider: "runninghub",
          model: null,
          input: {
            sourceFileId: "file-1",
          },
        },
        {
          workflowId: "workflow-fifo-group-order",
          projectId: "project-fifo-group-order",
          nodeId: "node-fifo-group-order",
          nodeTitle: "fifo group order",
          groupId: "group-3",
          groupOrder: 3,
          provider: "runninghub",
          model: null,
          input: {
            sourceFileId: "file-3",
          },
        },
      ],
    }));

    const startedTaskIds: string[] = [];
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      {
        async execute(input) {
          startedTaskIds.push(input.task.id);
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
    await queueService.pollOnce();
    await queueService.pollOnce();

    assert.deepEqual(startedTaskIds, [
      createResult.tasks[1]!.taskId,
      createResult.tasks[0]!.taskId,
      createResult.tasks[2]!.taskId,
    ]);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runCreatedAtFifoScenario();
  await runGroupOrderFifoScenario();
}

void run();
