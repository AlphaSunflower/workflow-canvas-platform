import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  SAMPLE_PNG,
  bearer,
  cleanupDbE2EContext,
  closeDbApi,
  createDbE2EContext,
  createDbTestEnv,
  registerAccount,
  registerAndUploadFile,
  requestBuffer,
  requestJson,
  startDbApi,
} from "./bootstrap-db.ts";
import { createWorkerDependencies } from "../../worker/src/composition/create-worker-dependencies.ts";
import type { QueueTaskExecutorInput } from "../../worker/src/modules/executors/queue-task-executor.types.ts";
import type { QueueTaskExecutorRegistry } from "../../worker/src/modules/executors/executor.registry.ts";
import { DbFilesRepository } from "../../api/src/modules/files/db-files.repository.ts";
import { DbExecutionsRepository } from "../../api/src/modules/executions/db-executions.repository.ts";

class DbE2EFakeExecutor {
  readonly nodeType = "aiImageHd";

  constructor(
    private readonly filesRepository: DbFilesRepository,
    private readonly executionsRepository: DbExecutionsRepository,
  ) {}

  async execute(input: QueueTaskExecutorInput): Promise<void> {
    const output = Buffer.concat([
      Buffer.from("db-e2e-output:"),
      SAMPLE_PNG,
    ]);
    const sha256 = createHash("sha256").update(output).digest("hex");
    const registerResult = await this.filesRepository.registerFile({
      userId: input.task.userId ?? undefined,
      sha256,
      size: output.length,
      mimeType: "image/png",
      originalName: `${input.task.taskNo}-db-e2e-output.png`,
      fileType: "image",
      sourceType: "output",
    });
    const outputFileId = registerResult.uploadRequired && registerResult.uploadId
      ? (await this.filesRepository.uploadFile(registerResult.uploadId, output)).file.fileId
      : registerResult.file.fileId;

    await this.executionsRepository.appendTaskEvent({
      taskId: input.task.id,
      attemptNo: input.task.currentAttemptNo,
      eventType: "step_final_started",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 70,
      message: "DB E2E fake executor started",
      payload: {
        sourceFileId: input.task.input?.sourceFileId ?? null,
      },
    });
    await this.executionsRepository.updateTaskResultFile(input.task.id, outputFileId);
    await this.executionsRepository.appendTaskEvent({
      taskId: input.task.id,
      attemptNo: input.task.currentAttemptNo,
      eventType: "step_final_completed",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 95,
      message: "DB E2E fake executor completed",
      payload: {
        resultFileId: outputFileId,
      },
    });
  }
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("executions");
  const api = await startDbApi(context);

  try {
    const owner = await registerAccount(api.baseUrl, {
      email: "execution-owner@example.com",
      password: "execution-owner-pass",
      displayName: "Execution Owner",
    });
    const other = await registerAccount(api.baseUrl, {
      email: "execution-other@example.com",
      password: "execution-other-pass",
      displayName: "Execution Other",
    });
    const sourceFile = await registerAndUploadFile(api.baseUrl, owner.accessToken, {
      originalName: "execution-source.png",
    });

    const workflowResponse = await requestJson<{ workflowId: string }>(api.baseUrl, "/api/v1/workflows", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        id: "workflow-execution-db-e2e",
        projectId: "project-execution-db-e2e",
        name: "Execution DB E2E Workflow",
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
        timestamp: 1770000100000,
      },
    });
    assert.equal(workflowResponse.status, 201);

    const createExecutionResponse = await requestJson<{
      runId: string;
      tasks: Array<{ taskId: string; status: string }>;
    }>(api.baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        workflowId: "workflow-execution-db-e2e",
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "hd-node",
        nodeTitle: "HD Node",
        groups: [
          {
            groupId: "group-1",
            sourceFileId: sourceFile.fileId,
            imageSize: "1K",
            aspectRatio: "1:1",
          },
        ],
      },
    });
    assert.equal(createExecutionResponse.status, 201);
    assert.equal(createExecutionResponse.body.data?.tasks[0]?.status, "queued");
    const runId = createExecutionResponse.body.data!.runId;
    const taskId = createExecutionResponse.body.data!.tasks[0]!.taskId;

    const filesRepository = new DbFilesRepository(context.databaseConfig, { rootDir: context.rootDir });
    const executionsRepository = new DbExecutionsRepository(context.databaseConfig);
    const fakeExecutor = new DbE2EFakeExecutor(filesRepository, executionsRepository);
    const workerDependencies = createWorkerDependencies({
      env: createDbTestEnv(context, "worker"),
      rootDir: context.rootDir,
      overrides: {
        queueTaskExecutor: fakeExecutor as unknown as QueueTaskExecutorRegistry,
      },
    });

    const pollResult = await workerDependencies.queueService.pollOnce();
    assert.equal(pollResult.claimedCount, 1);

    const runDetail = await requestJson<{
      runId: string;
      status: string;
      completedTaskCount: number;
      tasks: Array<{
        taskId: string;
        status: string;
        sourceFileId: string | null;
        resultFileId: string | null;
      }>;
    }>(api.baseUrl, `/api/v1/executions/${runId}`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(runDetail.status, 200);
    assert.equal(runDetail.body.data?.runId, runId);
    assert.equal(runDetail.body.data?.status, "completed");
    assert.equal(runDetail.body.data?.completedTaskCount, 1);
    assert.equal(runDetail.body.data?.tasks[0]?.status, "completed");
    assert.equal(runDetail.body.data?.tasks[0]?.sourceFileId, sourceFile.fileId);
    assert.ok(runDetail.body.data?.tasks[0]?.resultFileId);
    const resultFileId = runDetail.body.data!.tasks[0]!.resultFileId!;

    const taskDetail = await requestJson<{
      taskId: string;
      status: string;
      resultFile: { fileId: string } | null;
      recentEvents: Array<{ eventType: string }>;
    }>(api.baseUrl, `/api/v1/tasks/${taskId}`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(taskDetail.status, 200);
    assert.equal(taskDetail.body.data?.taskId, taskId);
    assert.equal(taskDetail.body.data?.resultFile?.fileId, resultFileId);
    assert.ok(taskDetail.body.data?.recentEvents.some((event) => event.eventType === "task_completed"));

    const taskEvents = await requestJson<{
      items: Array<{ eventType: string; taskId: string }>;
      total: number;
    }>(api.baseUrl, `/api/v1/tasks/${taskId}/events`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(taskEvents.status, 200);
    assert.ok((taskEvents.body.data?.total ?? 0) >= 5);
    assert.ok(taskEvents.body.data?.items.some((event) => event.eventType === "step_final_completed"));

    const workflowTasks = await requestJson<{
      items: Array<{ taskId: string; resultFileId: string | null }>;
      total: number;
    }>(api.baseUrl, "/api/v1/workflows/workflow-execution-db-e2e/tasks", {
      headers: bearer(owner.accessToken),
    });
    assert.equal(workflowTasks.status, 200);
    assert.equal(workflowTasks.body.data?.total, 1);
    assert.equal(workflowTasks.body.data?.items[0]?.taskId, taskId);
    assert.equal(workflowTasks.body.data?.items[0]?.resultFileId, resultFileId);

    const outputDownload = await requestBuffer(api.baseUrl, `/api/v1/files/${resultFileId}/download`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(outputDownload.status, 200);
    assert.match(outputDownload.buffer.toString("binary"), /^db-e2e-output:/u);

    const fileLinks = await context.pool.query<{ role: string; file_id: string }>(
      "select role, file_id::text from task_file_links where task_id = $1::uuid order by role asc",
      [taskId],
    );
    assert.deepEqual(
      fileLinks.rows.map((row) => row.role).sort(),
      ["input", "output"],
    );
    assert.ok(fileLinks.rows.some((row) => row.file_id === sourceFile.fileId && row.role === "input"));
    assert.ok(fileLinks.rows.some((row) => row.file_id === resultFileId && row.role === "output"));

    const otherRun = await requestJson(api.baseUrl, `/api/v1/executions/${runId}`, {
      headers: bearer(other.accessToken),
    });
    assert.equal(otherRun.status, 404);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
