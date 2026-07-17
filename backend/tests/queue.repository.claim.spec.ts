import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { createAIImageToPlyRequest } from "./helpers/execution-request.fixture.ts";
import { createExecutionStoreInput } from "./helpers/execution-store.fixture.ts";

async function seedQueuedTasks(
  repository: ExecutionsRepository,
): Promise<{
  runId: string;
  firstTaskId: string;
  secondTaskId: string;
  thirdTaskId: string;
}> {
  const requestPayload = createAIImageToPlyRequest({
    nodeId: "node-queue-repo",
    nodeTitle: "queue repo claim",
    groups: [
      {
        groupId: "group-2",
        sourceFileId: "file-2",
      },
      {
        groupId: "group-1",
        sourceFileId: "file-1",
      },
      {
        groupId: "group-3",
        sourceFileId: "file-3",
      },
    ],
  });

  const created = await repository.createExecution(createExecutionStoreInput({
    run: {
      userId: "user-a",
      nodeType: requestPayload.nodeType,
      taskType: requestPayload.taskType,
      executionMode: requestPayload.executionMode,
      nodeId: "node-queue-repo",
      nodeTitle: "queue repo claim",
      provider: "runninghub",
      requestPayload,
    },
    tasks: [
      {
        nodeType: "aiImageToPly",
        taskType: "image-to-ply",
        groupId: "group-2",
        groupOrder: 2,
        provider: "runninghub",
        model: null,
        input: {
          sourceFileId: "file-2",
        },
      },
      {
        nodeType: "aiImageToPly",
        taskType: "image-to-ply",
        groupId: "group-1",
        groupOrder: 1,
        provider: "runninghub",
        model: null,
        input: {
          sourceFileId: "file-1",
        },
      },
      {
        nodeType: "aiImageToPly",
        taskType: "image-to-ply",
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

  return {
    runId: created.runId,
    firstTaskId: created.tasks[0]!.taskId,
    secondTaskId: created.tasks[1]!.taskId,
    thirdTaskId: created.tasks[2]!.taskId,
  };
}

async function runListQueuedTasksScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-repo-claim-"));

  try {
    const repository = new ExecutionsRepository(rootDir);
    const { secondTaskId, firstTaskId, thirdTaskId } = await seedQueuedTasks(repository);

    const queuedTasks = await repository.listQueuedTasks(10);

    assert.equal(queuedTasks.length, 3);
    assert.deepEqual(
      queuedTasks.map((task) => task.id),
      [secondTaskId, firstTaskId, thirdTaskId],
    );
    assert.deepEqual(
      queuedTasks.map((task) => task.groupOrder),
      [1, 2, 3],
    );
    assert.ok(queuedTasks.every((task) => task.status === "queued"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runClaimQueuedTaskByIdScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-queue-repo-claim-by-id-"));

  try {
    const repository = new ExecutionsRepository(rootDir);
    const { firstTaskId } = await seedQueuedTasks(repository);

    const claimed = await repository.claimQueuedTaskById(firstTaskId);
    const task = await repository.getTaskById(firstTaskId);
    const events = await repository.getTaskEvents(firstTaskId);
    const secondClaim = await repository.claimQueuedTaskById(firstTaskId);

    assert.ok(claimed);
    assert.equal(claimed?.task.id, firstTaskId);
    assert.equal(task?.status, "processing");
    assert.equal(task?.currentAttemptNo, 1);
    assert.ok(task?.startedAt);
    assert.equal(
      events.filter((event) => event.eventType === "task_started").length,
      1,
    );
    assert.equal(secondClaim, null);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runListQueuedTasksScenario();
  await runClaimQueuedTaskByIdScenario();
}

void run();
