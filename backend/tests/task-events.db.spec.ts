import assert from "node:assert/strict";

import { DbExecutionsRepository } from "../api/src/modules/executions/db-executions.repository.ts";
import { WorkflowTaskHistoryRepository } from "../api/src/modules/workflows/workflow-task-history.repository.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { createAIImageGenRequest } from "./helpers/execution-request.fixture.ts";
import {
  InMemoryExecutionsDatabasePool,
  TEST_DATABASE_CONFIG,
} from "./helpers/in-memory-executions-db.ts";

async function run(): Promise<void> {
  const pool = new InMemoryExecutionsDatabasePool();
  const repository = new DbExecutionsRepository(TEST_DATABASE_CONFIG, { pool });
  const queueRepository = new QueueRepository(repository);
  const eventService = new ExecutionEventService(repository);
  const workflowHistory = new WorkflowTaskHistoryRepository("", {
    databaseConfig: TEST_DATABASE_CONFIG,
    pool,
    mode: "db",
  });
  const requestPayload = createAIImageGenRequest({
    userId: "user-events",
    workflowId: "workflow-events",
    nodeId: "node-events",
    nodeTitle: "Events Node",
    groups: [
      {
        groupId: "group-2",
        referenceFileIds: ["33333333-3333-4333-8333-333333333333"],
      },
      {
        groupId: "group-1",
        referenceFileIds: ["44444444-4444-4444-8444-444444444444"],
      },
    ],
  });
  const created = await repository.createExecution({
    run: {
      userId: "user-events",
      workflowId: "workflow-events",
      projectId: "project-events",
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-events",
      nodeTitle: "Events Node",
      provider: "laozhang",
      requestPayload,
    },
    tasks: [
      {
        workflowId: "workflow-events",
        projectId: "project-events",
        nodeType: "aiImageGen",
        nodeId: "node-events",
        nodeTitle: "Events Node",
        taskType: "image-gen",
        groupId: "group-2",
        groupOrder: 2,
        provider: "laozhang",
        model: "gemini-3-pro-image-preview",
        input: {
          prompt: "event prompt",
          referenceFileIds: ["33333333-3333-4333-8333-333333333333"],
        },
      },
      {
        workflowId: "workflow-events",
        projectId: "project-events",
        nodeType: "aiImageGen",
        nodeId: "node-events",
        nodeTitle: "Events Node",
        taskType: "image-gen",
        groupId: "group-1",
        groupOrder: 1,
        provider: "laozhang",
        model: "gemini-3-pro-image-preview",
        input: {
          prompt: "event prompt",
          referenceFileIds: ["44444444-4444-4444-8444-444444444444"],
        },
      },
    ],
  });
  const firstCreatedTaskId = created.tasks[0]!.taskId;
  const secondCreatedTaskId = created.tasks[1]!.taskId;
  const queuedTasks = await queueRepository.listQueuedTasks(10);

  assert.deepEqual(
    queuedTasks.map((task) => task.id),
    [secondCreatedTaskId, firstCreatedTaskId],
    "DB queue should dispatch lower groupOrder first",
  );

  const claimed = await queueRepository.claimQueuedTaskById(secondCreatedTaskId);
  assert.equal(claimed?.task.id, secondCreatedTaskId);
  assert.equal((await queueRepository.claimQueuedTaskById(secondCreatedTaskId)), null);

  await queueRepository.updateTaskAttempt({
    taskId: secondCreatedTaskId,
    attemptNo: 1,
    retryCount: 0,
    currentStep: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  });
  await eventService.recordProgress({
    taskId: secondCreatedTaskId,
    attemptNo: 1,
    eventType: "step_final_started",
    stepType: "final",
    progress: 10,
    message: "started final",
    payload: {
      marker: "first",
    },
  });
  await eventService.recordProgress({
    taskId: secondCreatedTaskId,
    attemptNo: 1,
    eventType: "task_progress",
    stepType: "final",
    progress: 60,
    message: "middle progress",
    payload: {
      marker: "second",
    },
  });

  const eventList = await repository.getTaskEvents(secondCreatedTaskId);
  assert.deepEqual(
    eventList.map((event) => event.eventType),
    ["task_queued", "task_started", "step_final_started", "task_progress"],
  );
  assert.equal(eventList[2]?.payload?.marker, "first");
  assert.equal(eventList[3]?.payload?.marker, "second");

  await queueRepository.requeueTask({
    taskId: secondCreatedTaskId,
    errorCode: "PROVIDER_BACKPRESSURE",
    errorMessage: "provider busy",
  });
  assert.equal((await repository.getTaskById(secondCreatedTaskId))?.status, "queued");
  assert.equal((await repository.getExecutionRun(created.runId))?.status, "queued");

  const stats = await queueRepository.getQueuedTaskStats();
  assert.equal(stats.total, 2);
  assert.equal(stats.byProvider.laozhang, 2);

  const historyList = await workflowHistory.listTasks("workflow-events", {
    page: 1,
    pageSize: 10,
    sortBy: "sequence",
    sortOrder: "asc",
  });
  assert.equal(historyList.total, 2);
  assert.deepEqual(
    historyList.items.map((item) => item.taskId),
    [firstCreatedTaskId, secondCreatedTaskId],
    "workflow history sequence should follow creation order",
  );

  const filteredHistory = await workflowHistory.listTasks("workflow-events", {
    status: "queued",
    nodeId: "node-events",
    taskType: "image-gen",
    page: 1,
    pageSize: 10,
    sortBy: "sequence",
    sortOrder: "desc",
  });
  assert.equal(filteredHistory.total, 2);
  assert.deepEqual(
    filteredHistory.items.map((item) => item.taskId),
    [secondCreatedTaskId, firstCreatedTaskId],
  );

  const historyDetail = await workflowHistory.getTaskById(
    "workflow-events",
    secondCreatedTaskId,
  );
  const historyEvents = await workflowHistory.getTaskEvents(
    "workflow-events",
    secondCreatedTaskId,
    {
      sortOrder: "asc",
      page: 1,
      pageSize: 10,
    },
  );

  assert.equal(historyDetail?.taskId, secondCreatedTaskId);
  assert.equal(historyDetail?.runNo, created.runNo);
  assert.equal(historyDetail?.status, "queued");
  assert.equal(historyEvents.total, 4);
  assert.equal(historyEvents.items[0]?.eventType, "task_queued");
}

void run();
