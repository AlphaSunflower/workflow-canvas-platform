import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

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

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(
    () => true,
    () => false,
  );
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("task_history");
  const api = await startDbApi(context);
  const legacyHistoryRoot = path.join(context.rootDir, "data", "workflows", "workflow-task-history-db");

  try {
    await fs.rm(path.join(context.rootDir, "data", "workflows"), {
      recursive: true,
      force: true,
    });
    assert.equal(await exists(legacyHistoryRoot), false);

    const owner = await registerAccount(api.baseUrl, {
      email: "task-history-owner@example.com",
      password: "task-history-owner-pass",
      displayName: "Task History Owner",
    });
    const other = await registerAccount(api.baseUrl, {
      email: "task-history-other@example.com",
      password: "task-history-other-pass",
      displayName: "Task History Other",
    });
    const sourceFile = await registerAndUploadFile(api.baseUrl, owner.accessToken, {
      originalName: "task-history-source.png",
    });
    const resultFile = await registerAndUploadFile(api.baseUrl, owner.accessToken, {
      content: "task-history-result-content",
      originalName: "task-history-result.png",
      sourceType: "output",
    });

    const workflowResponse = await requestJson<{ workflowId: string }>(
      api.baseUrl,
      "/api/v1/workflows",
      {
        method: "POST",
        headers: bearer(owner.accessToken),
        payload: {
          id: "workflow-task-history-db",
          projectId: "project-task-history-db",
          name: "Task History DB Workflow",
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
          timestamp: 1770000400000,
        },
      },
    );
    assert.equal(workflowResponse.status, 201);

    const createExecutionResponse = await requestJson<{
      runId: string;
      tasks: Array<{ taskId: string; status: string }>;
    }>(api.baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        workflowId: "workflow-task-history-db",
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "hd-node",
        nodeTitle: "HD Node",
        groups: [
          {
            groupId: "group-history",
            sourceFileId: sourceFile.fileId,
            imageSize: "1K",
            aspectRatio: "1:1",
          },
        ],
      },
    });
    assert.equal(createExecutionResponse.status, 201);
    const runId = createExecutionResponse.body.data!.runId;
    const taskId = createExecutionResponse.body.data!.tasks[0]!.taskId;

    const repository = new DbExecutionsRepository(context.databaseConfig);
    assert.ok(await repository.claimQueuedTaskById(taskId));
    await repository.appendTaskEvent({
      taskId,
      attemptNo: 1,
      eventType: "step_final_started",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 50,
      message: "history started",
      payload: { runId },
    });
    await repository.updateTaskResultFile(taskId, resultFile.fileId);
    await repository.appendTaskEvent({
      taskId,
      attemptNo: 1,
      eventType: "step_final_completed",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 95,
      message: "history completed",
      payload: { resultFileId: resultFile.fileId },
    });
    await repository.markTaskCompleted(taskId);

    const listResponse = await requestJson<{
      items: Array<{
        sequence?: number;
        taskId: string;
        runId: string;
        workflowId: string | null;
        nodeId: string | null;
        status: string;
        resultFileId: string | null;
        resultFile: { fileId: string; sourceType: string } | null;
      }>;
      total: number;
    }>(
      api.baseUrl,
      "/api/v1/workflows/workflow-task-history-db/tasks?sortBy=sequence&sortOrder=asc&page=1&pageSize=10",
      {
        headers: bearer(owner.accessToken),
      },
    );
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.data?.total, 1);
    assert.equal(listResponse.body.data?.items[0]?.sequence, 1);
    assert.equal(listResponse.body.data?.items[0]?.taskId, taskId);
    assert.equal(listResponse.body.data?.items[0]?.runId, runId);
    assert.equal(listResponse.body.data?.items[0]?.workflowId, "workflow-task-history-db");
    assert.equal(listResponse.body.data?.items[0]?.nodeId, "hd-node");
    assert.equal(listResponse.body.data?.items[0]?.status, "completed");
    assert.equal(listResponse.body.data?.items[0]?.resultFileId, resultFile.fileId);
    assert.equal(listResponse.body.data?.items[0]?.resultFile?.fileId, resultFile.fileId);
    assert.equal(listResponse.body.data?.items[0]?.resultFile?.sourceType, "output");

    const detailResponse = await requestJson<{
      taskId: string;
      resultFileId: string | null;
      recentEvents: Array<{ eventType: string; taskId: string }>;
    }>(
      api.baseUrl,
      `/api/v1/workflows/workflow-task-history-db/tasks/${taskId}`,
      {
        headers: bearer(owner.accessToken),
      },
    );
    assert.equal(detailResponse.status, 200);
    assert.equal(detailResponse.body.data?.taskId, taskId);
    assert.equal(detailResponse.body.data?.resultFileId, resultFile.fileId);
    assert.ok(detailResponse.body.data?.recentEvents.some((event) => event.eventType === "task_completed"));

    const eventsResponse = await requestJson<{
      items: Array<{ eventType: string; taskId: string }>;
      total: number;
    }>(
      api.baseUrl,
      `/api/v1/workflows/workflow-task-history-db/tasks/${taskId}/events?sortOrder=asc&page=1&pageSize=20`,
      {
        headers: bearer(owner.accessToken),
      },
    );
    assert.equal(eventsResponse.status, 200);
    assert.deepEqual(
      eventsResponse.body.data?.items.map((event) => event.eventType),
      [
        "task_created",
        "task_started",
        "step_final_started",
        "step_final_completed",
        "task_completed",
      ],
    );

    const filteredResponse = await requestJson<{
      items: Array<{ taskId: string }>;
      total: number;
    }>(
      api.baseUrl,
      `/api/v1/workflows/workflow-task-history-db/tasks?status=completed&nodeId=hd-node&nodeType=aiImageHd&taskType=image-hd&runId=${encodeURIComponent(runId)}`,
      {
        headers: bearer(owner.accessToken),
      },
    );
    assert.equal(filteredResponse.status, 200);
    assert.equal(filteredResponse.body.data?.total, 1);
    assert.equal(filteredResponse.body.data?.items[0]?.taskId, taskId);

    const otherList = await requestJson(
      api.baseUrl,
      "/api/v1/workflows/workflow-task-history-db/tasks",
      {
        headers: bearer(other.accessToken),
      },
    );
    assert.equal(otherList.status, 404);

    assert.equal(await exists(legacyHistoryRoot), false);
    assert.equal(
      await exists(path.join(legacyHistoryRoot, "task-history", "index.json")),
      false,
    );
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
