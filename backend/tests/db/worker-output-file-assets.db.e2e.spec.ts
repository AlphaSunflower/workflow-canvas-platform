import assert from "node:assert/strict";

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
import { DbExecutionsRepository } from "../../api/src/modules/executions/db-executions.repository.ts";
import { DbFilesRepository } from "../../api/src/modules/files/db-files.repository.ts";
import { createWorkerDependencies } from "../../worker/src/composition/create-worker-dependencies.ts";
import { WorkerFileAssetService } from "../../worker/src/modules/files/worker-file-asset.service.ts";
import type { QueueTaskExecutorInput } from "../../worker/src/modules/executors/queue-task-executor.types.ts";
import type { QueueTaskExecutorRegistry } from "../../worker/src/modules/executors/executor.registry.ts";
import { LocalStorageAdapter } from "../../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../../worker/src/modules/storage/storage.service.ts";

class WorkerOutputAssetExecutor {
  readonly nodeType = "aiImageHd";

  constructor(
    private readonly executionsRepository: DbExecutionsRepository,
    private readonly fileAssetService: WorkerFileAssetService,
    private readonly storageService: StorageService,
  ) {}

  async execute(input: QueueTaskExecutorInput): Promise<void> {
    const output = Buffer.concat([
      Buffer.from("worker-output-db-e2e:"),
      SAMPLE_PNG,
    ]);
    const saved = await this.storageService.saveBuffer({
      sourceType: "output",
      fileType: "image",
      originalName: `${input.task.taskNo}-worker-output.png`,
      mimeType: "image/png",
      buffer: output,
    });
    const resultFileId = await this.fileAssetService.registerStoredAsset({
      userId: input.task.userId,
      stored: saved,
      content: output,
      fileType: "image",
      sourceType: "output",
    });

    await this.executionsRepository.appendTaskEvent({
      taskId: input.task.id,
      attemptNo: input.task.currentAttemptNo,
      eventType: "step_final_started",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 70,
      message: "worker output started",
      payload: {
        storageKey: saved.storageKey,
      },
    });
    await this.executionsRepository.updateTaskResultFile(input.task.id, resultFileId);
    await this.executionsRepository.appendTaskEvent({
      taskId: input.task.id,
      attemptNo: input.task.currentAttemptNo,
      eventType: "step_final_completed",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 95,
      message: "worker output completed",
      payload: {
        resultFileId,
        storageKey: saved.storageKey,
      },
    });
  }
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("worker_output_assets");
  const api = await startDbApi(context);

  try {
    const owner = await registerAccount(api.baseUrl, {
      email: "worker-output-owner@example.com",
      password: "worker-output-owner-pass",
      displayName: "Worker Output Owner",
    });
    const sourceFile = await registerAndUploadFile(api.baseUrl, owner.accessToken, {
      originalName: "worker-output-source.png",
    });

    const workflowResponse = await requestJson<{ workflowId: string }>(
      api.baseUrl,
      "/api/v1/workflows",
      {
        method: "POST",
        headers: bearer(owner.accessToken),
        payload: {
          id: "workflow-worker-output-assets",
          projectId: "project-worker-output-assets",
          name: "Worker Output DB Workflow",
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
          timestamp: 1770000300000,
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
        workflowId: "workflow-worker-output-assets",
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "hd-node",
        nodeTitle: "HD Node",
        model: "gemini-3-pro-image-preview",
        groups: [
          {
            groupId: "group-output",
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

    const executionsRepository = new DbExecutionsRepository(context.databaseConfig);
    const filesRepository = new DbFilesRepository(context.databaseConfig, { rootDir: context.rootDir });
    const storageService = new StorageService(new LocalStorageAdapter(context.rootDir));
    const workerOutputExecutor = new WorkerOutputAssetExecutor(
      executionsRepository,
      new WorkerFileAssetService(filesRepository),
      storageService,
    );
    const worker = createWorkerDependencies({
      env: createDbTestEnv(context, "worker"),
      rootDir: context.rootDir,
      overrides: {
        queueTaskExecutor: workerOutputExecutor as unknown as QueueTaskExecutorRegistry,
      },
    });
    const pollResult = await worker.queueService.pollOnce();
    assert.equal(pollResult.claimedCount, 1);

    const runDetail = await requestJson<{
      status: string;
      completedTaskCount: number;
      tasks: Array<{
        taskId: string;
        status: string;
        resultFileId: string | null;
        resultFile: {
          fileId: string;
          sourceType: string;
          downloadUrl?: string;
          previewUrl?: string;
          thumbnailUrl?: string;
        } | null;
      }>;
    }>(api.baseUrl, `/api/v1/executions/${runId}`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(runDetail.status, 200);
    assert.equal(runDetail.body.data?.status, "completed");
    assert.equal(runDetail.body.data?.completedTaskCount, 1);
    assert.equal(runDetail.body.data?.tasks[0]?.taskId, taskId);
    assert.equal(runDetail.body.data?.tasks[0]?.status, "completed");
    assert.ok(runDetail.body.data?.tasks[0]?.resultFileId);
    assert.equal(runDetail.body.data?.tasks[0]?.resultFile?.sourceType, "output");
    assert.ok(runDetail.body.data?.tasks[0]?.resultFile?.downloadUrl);
    const resultFileId = runDetail.body.data!.tasks[0]!.resultFileId!;

    const outputRows = await context.pool.query<{
      source_type: string;
      status: string;
      user_id: string;
      blob_id: string;
      output_links: number;
      task_status: string;
    }>(
      `
        select
          fa.source_type,
          fa.status,
          fa.user_id,
          fa.blob_id::text,
          (
            select count(*)::int
            from task_file_links
            where task_id = $2::uuid
              and file_id = $1::uuid
              and role = 'output'
          ) as output_links,
          (
            select status
            from execution_tasks
            where id = $2::uuid
          ) as task_status
        from file_assets fa
        where fa.id = $1::uuid
      `,
      [resultFileId, taskId],
    );
    assert.equal(outputRows.rows[0]?.source_type, "output");
    assert.equal(outputRows.rows[0]?.status, "ready");
    assert.equal(outputRows.rows[0]?.user_id, owner.userId);
    assert.ok(outputRows.rows[0]?.blob_id);
    assert.equal(outputRows.rows[0]?.output_links, 1);
    assert.equal(outputRows.rows[0]?.task_status, "completed");

    const outputDownload = await requestBuffer(api.baseUrl, `/api/v1/files/${resultFileId}/download`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(outputDownload.status, 200);
    assert.match(outputDownload.buffer.toString("binary"), /^worker-output-db-e2e:/u);

    const taskEvents = await requestJson<{
      items: Array<{ eventType: string }>;
    }>(api.baseUrl, `/api/v1/tasks/${taskId}/events`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(taskEvents.status, 200);
    assert.ok(taskEvents.body.data?.items.some((event) => event.eventType === "step_final_started"));
    assert.ok(taskEvents.body.data?.items.some((event) => event.eventType === "step_final_completed"));
    assert.ok(taskEvents.body.data?.items.some((event) => event.eventType === "task_completed"));
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
