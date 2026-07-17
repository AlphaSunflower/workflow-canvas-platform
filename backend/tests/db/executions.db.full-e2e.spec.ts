import assert from "node:assert/strict";

import {
  bearer,
  cleanupDbE2EContext,
  closeDbApi,
  createDbE2EContext,
  registerAccount,
  registerAndUploadFile,
  requestJson,
  startDbApi,
} from "./bootstrap-db.ts";
import { DbExecutionsRepository } from "../../api/src/modules/executions/db-executions.repository.ts";

async function run(): Promise<void> {
  const context = await createDbE2EContext("executions_full");
  const api = await startDbApi(context);

  try {
    const owner = await registerAccount(api.baseUrl, {
      email: "executions-full-owner@example.com",
      password: "executions-full-owner-pass",
      displayName: "Executions Full Owner",
    });
    const sourceFile = await registerAndUploadFile(api.baseUrl, owner.accessToken, {
      originalName: "executions-full-source.png",
    });

    const workflowResponse = await requestJson<{ workflowId: string }>(
      api.baseUrl,
      "/api/v1/workflows",
      {
        method: "POST",
        headers: bearer(owner.accessToken),
        payload: {
          id: "workflow-executions-full",
          projectId: "project-executions-full",
          name: "Executions Full DB Workflow",
          nodes: {
            "source-node": {
              id: "source-node",
              type: "image",
              fileId: sourceFile.fileId,
            },
            "hd-node": {
              id: "hd-node",
              type: "aiImageHd",
            },
          },
          connections: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          metadata: {},
          timestamp: 1770000200000,
        },
      },
    );
    assert.equal(workflowResponse.status, 201);

    const createExecutionResponse = await requestJson<{
      runId: string;
      runNo: string;
      status: string;
      tasks: Array<{ taskId: string; taskNo: string; status: string }>;
    }>(api.baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        workflowId: "workflow-executions-full",
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "hd-node",
        nodeTitle: "HD Node",
        groups: [
          {
            groupId: "group-a",
            sourceFileId: sourceFile.fileId,
            imageSize: "1K",
            aspectRatio: "1:1",
          },
          {
            groupId: "group-b",
            sourceFileId: sourceFile.fileId,
            imageSize: "1K",
            aspectRatio: "1:1",
          },
        ],
      },
    });
    assert.equal(createExecutionResponse.status, 201);
    assert.equal(createExecutionResponse.body.data?.status, "queued");
    assert.equal(createExecutionResponse.body.data?.tasks.length, 2);
    assert.ok(createExecutionResponse.body.data?.runId);
    const runId = createExecutionResponse.body.data!.runId;
    const firstTaskId = createExecutionResponse.body.data!.tasks[0]!.taskId;
    const secondTaskId = createExecutionResponse.body.data!.tasks[1]!.taskId;

    const createdRows = await context.pool.query<{
      runs: number;
      tasks: number;
      created_events: number;
      input_links: number;
    }>(
      `
        select
          (select count(*)::int from execution_runs where id = $1::uuid) as runs,
          (select count(*)::int from execution_tasks where run_id = $1::uuid) as tasks,
          (select count(*)::int from task_events where run_id = $1::uuid and event_type = 'task_created') as created_events,
          (select count(*)::int from task_file_links where role = 'input' and task_id in (
            select id from execution_tasks where run_id = $1::uuid
          )) as input_links
      `,
      [runId],
    );
    assert.equal(createdRows.rows[0]?.runs, 1);
    assert.equal(createdRows.rows[0]?.tasks, 2);
    assert.equal(createdRows.rows[0]?.created_events, 2);
    assert.equal(createdRows.rows[0]?.input_links, 2);

    const repository = new DbExecutionsRepository(context.databaseConfig);
    const queuedBeforeClaim = await repository.listQueuedTasks(10);
    assert.deepEqual(
      queuedBeforeClaim.map((task) => task.id),
      [firstTaskId, secondTaskId],
    );

    const claimed = await repository.claimQueuedTaskById(firstTaskId);
    assert.ok(claimed);
    assert.equal(claimed.task.id, firstTaskId);
    assert.equal(claimed.task.status, "processing");
    assert.equal(claimed.task.currentAttemptNo, 1);
    assert.equal(await repository.claimQueuedTaskById(firstTaskId), null);

    await repository.appendTaskEvent({
      taskId: firstTaskId,
      attemptNo: 1,
      eventType: "step_lineart_started",
      status: "processing",
      phase: "processing",
      stepType: "lineart",
      progress: 10,
      message: "lineart started",
      payload: { sourceFileId: sourceFile.fileId },
    });
    await repository.appendTaskEvent({
      taskId: firstTaskId,
      attemptNo: 1,
      eventType: "step_lineart_completed",
      status: "processing",
      phase: "processing",
      stepType: "lineart",
      progress: 30,
      message: "lineart completed",
      payload: { sourceFileId: sourceFile.fileId },
    });

    const firstEvents = await requestJson<{
      items: Array<{ eventType: string; taskId: string; timestamp: string }>;
      total: number;
    }>(api.baseUrl, `/api/v1/tasks/${firstTaskId}/events`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(firstEvents.status, 200);
    assert.deepEqual(
      firstEvents.body.data?.items.map((event) => event.eventType),
      [
        "task_created",
        "task_started",
        "step_lineart_started",
        "step_lineart_completed",
      ],
    );

    const statusRows = await context.pool.query<{
      run_status: string;
      first_task_status: string;
      second_task_status: string;
    }>(
      `
        select
          (select status from execution_runs where id = $1::uuid) as run_status,
          (select status from execution_tasks where id = $2::uuid) as first_task_status,
          (select status from execution_tasks where id = $3::uuid) as second_task_status
      `,
      [runId, firstTaskId, secondTaskId],
    );
    assert.equal(statusRows.rows[0]?.run_status, "processing");
    assert.equal(statusRows.rows[0]?.first_task_status, "processing");
    assert.equal(statusRows.rows[0]?.second_task_status, "queued");
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
