import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
  AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
} from "../shared/src/index.ts";
import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { createEnv } from "../shared/src/env.ts";
import { WorkerApp } from "../worker/src/app.ts";
import { AIMultiViewRestoreTaskExecutor } from "../worker/src/modules/executors/ai-multi-view-restore.executor.ts";
import { QueueTaskExecutorRegistry } from "../worker/src/modules/executors/executor.registry.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { ExecutionRunService } from "../worker/src/modules/execution-run/execution-run.service.ts";
import { ProviderSnapshotCleanerService } from "../worker/src/modules/providers/provider-snapshot-cleaner.service.ts";
import { ProviderConcurrencyService } from "../worker/src/modules/queue/provider-concurrency.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";
import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";
import { createAIMultiViewRestoreRequest } from "./helpers/execution-request.fixture.ts";

interface ProviderRecord {
  stage: "upload" | "create" | "query" | "download";
  key: string;
}

const TEST_WORKFLOW_ID = "workflow-ai-multi-view-restore-e2e";

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function registerReadyFile(
  filesRepository: FilesRepository,
  userId: string,
  originalName: string,
  content: string,
): Promise<string> {
  const buffer = Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const registerResult = await filesRepository.registerFile({
    userId,
    sha256,
    size: buffer.length,
    mimeType: "image/png",
    originalName,
    fileType: "image",
    sourceType: "input",
  });

  if (registerResult.uploadRequired && registerResult.uploadId) {
    await filesRepository.uploadFile(
      registerResult.uploadId,
      buffer.toString("base64"),
    );
  }

  return registerResult.file.fileId;
}

async function waitForRunFinished(
  queryService: ExecutionQueryService,
  runId: string,
  timeoutMs: number,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const run = await queryService.getExecutionRun(runId);

    if (run?.status === "completed" || run?.status === "failed") {
      return run;
    }

    await delay(20);
  }

  throw new Error("RUN_WAIT_TIMEOUT");
}

function createSlug(input: string): string {
  return input.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-ai-multi-view-restore-e2e-"));
  const originalHost = process.env.BACKEND_HOST;
  const originalPort = process.env.BACKEND_WORKER_PORT;
  const originalPollInterval = process.env.BACKEND_WORKER_POLL_INTERVAL_MS;
  const originalPersistenceMode = process.env.BACKEND_PERSISTENCE_MODE;
  let app: WorkerApp | null = null;
  let workerStarted = false;

  try {
    process.env.BACKEND_HOST = "127.0.0.1";
    process.env.BACKEND_WORKER_PORT = "0";
    process.env.BACKEND_WORKER_POLL_INTERVAL_MS = "20";
    process.env.BACKEND_PERSISTENCE_MODE = "json";

    const env = createEnv("worker");
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const providerRecords: ProviderRecord[] = [];
    const queryCountByTaskId = new Map<string, number>();

    async function withTrackedProviderOperation<T>(
      stage: ProviderRecord["stage"],
      key: string,
      callback: () => Promise<T>,
    ): Promise<T> {
      providerRecords.push({ stage, key });
      await delay(10);
      return callback();
    }

    const executor = new AIMultiViewRestoreTaskExecutor(
      executionsRepository,
      filesRepository,
      {
        async uploadFile(input) {
          const sourceText = input.fileBuffer.toString("utf8");
          const slug = createSlug(sourceText);
          const suffix = input.snapshotLabel?.includes("render") ? "render" : "reference";

          return withTrackedProviderOperation("upload", `${slug}-${suffix}`, async () => ({
            fileName: `uploaded-${slug}-${suffix}.png`,
          }));
        },
        async createWorkflowTask(input) {
          const renderUploadedFileName = input.nodeInfoList.find((item) => item.nodeId === "124")
            ?.fieldValue ?? "unknown";
          const slug = renderUploadedFileName
            .replace(/^uploaded-/, "")
            .replace(/-render\.[^.]+$/, "");

          return withTrackedProviderOperation("create", slug, async () => ({
            taskId: `rh-task-${slug}`,
            taskStatus: "QUEUED",
            clientId: `rh-client-${slug}`,
            promptTips: "{\"result\": true}",
            promptTipsSummary: {
              parseStatus: "parsed",
              result: true,
            },
          }));
        },
        async queryTaskResultV2(input) {
          const slug = input.taskId.replace(/^rh-task-/, "");
          const nextCount = (queryCountByTaskId.get(input.taskId) ?? 0) + 1;
          queryCountByTaskId.set(input.taskId, nextCount);

          return withTrackedProviderOperation("query", `${slug}-${nextCount}`, async () => {
            if (slug === "render-failed") {
              return {
                taskId: input.taskId,
                taskStatus: "SUCCESS",
                clientId: `rh-client-${slug}`,
                promptTips: null,
                errorCode: null,
                errorMessage: null,
                results: [
                  {
                    fileUrl: `https://example.test/${slug}/result-a.png`,
                    fileType: "png",
                    nodeId: "888",
                    taskCostTime: 9,
                  },
                  {
                    fileUrl: `https://example.test/${slug}/result-b.png`,
                    fileType: "png",
                    nodeId: "999",
                    taskCostTime: 9,
                  },
                ],
              };
            }

            if (nextCount === 1) {
              return {
                taskId: input.taskId,
                taskStatus: "RUNNING",
                clientId: `rh-client-${slug}`,
                promptTips: null,
                errorCode: null,
                errorMessage: null,
                results: [],
              };
            }

            return {
              taskId: input.taskId,
              taskStatus: "SUCCESS",
              clientId: `rh-client-${slug}`,
              promptTips: null,
              errorCode: null,
              errorMessage: null,
              results: [
                {
                  fileUrl: `https://example.test/${slug}/output.png`,
                  fileType: "png",
                  nodeId: "127",
                  taskCostTime: 18,
                },
              ],
            };
          });
        },
      },
      {
        async buildNodeInfoList(input) {
          return {
            workflowId: AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
            nodeInfoList: [
              {
                nodeId: "124",
                fieldName: "image",
                fieldValue: input.uploadedFileNames?.render ?? "",
              },
              {
                nodeId: "102",
                fieldName: "image",
                fieldValue: input.uploadedFileNames?.reference ?? "",
              },
            ],
            snapshotPath: path.join(
              rootDir,
              `snapshot-${(input.uploadedFileNames?.render ?? "unknown").replace(/[^a-z0-9.-]+/gi, "-")}.json`,
            ),
          };
        },
      },
      storageService,
      async (input) =>
        withTrackedProviderOperation("download", String(input), async () => {
          const url = String(input);

          if (url.includes("render-success-1")) {
            return new Response(Buffer.from("multi-view-success-1-content"), {
              status: 200,
              headers: {
                "Content-Type": "image/png",
              },
            });
          }

          if (url.includes("render-success-2")) {
            return new Response(Buffer.from("multi-view-success-2-content"), {
              status: 200,
              headers: {
                "Content-Type": "image/png",
              },
            });
          }

          return new Response("missing", { status: 404 });
        }),
      {
        pollIntervalMs: 5,
        maxPollAttempts: 5,
      },
    );
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      new QueueTaskExecutorRegistry([executor]),
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
      }),
      new ProviderConcurrencyService({
        maxConcurrencyByProvider: {
          runninghub: env.runninghubMaxConcurrency,
        },
      }),
    );
    const executionRunService = new ExecutionRunService(queueService, 20);
    app = new WorkerApp({
      env,
      queueService,
      executionRunService,
      providerSnapshotCleanerService: new ProviderSnapshotCleanerService({
        snapshotDir: path.join(rootDir, "provider-snapshots"),
      }),
    });

    const renderFileId1 = await registerReadyFile(
      filesRepository,
      "user-a",
      "render-success-1.png",
      "render-success-1",
    );
    const referenceFileId1 = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-success-1.png",
      "reference-success-1",
    );
    const renderFileId2 = await registerReadyFile(
      filesRepository,
      "user-a",
      "render-success-2.png",
      "render-success-2",
    );
    const referenceFileId2 = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-success-2.png",
      "reference-success-2",
    );
    const renderFileIdFailed = await registerReadyFile(
      filesRepository,
      "user-a",
      "render-failed.png",
      "render-failed",
    );
    const referenceFileIdFailed = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-failed.png",
      "reference-failed",
    );

    const createResult = await executionsService.createExecution(createAIMultiViewRestoreRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiMultiViewRestore",
      taskType: "multi-view-restore",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-multi-view-restore-e2e",
      nodeTitle: "多视角修复端到端",
      groups: [
        {
          groupId: "group-success-1",
          renderFileId: renderFileId1,
          referenceFileId: referenceFileId1,
        },
        {
          groupId: "group-success-2",
          renderFileId: renderFileId2,
          referenceFileId: referenceFileId2,
        },
        {
          groupId: "group-failed",
          renderFileId: renderFileIdFailed,
          referenceFileId: referenceFileIdFailed,
        },
      ],
    }));

    await app.start();
    workerStarted = true;

    const workerPort = app.getListeningPort();
    assert.ok(workerPort);

    const healthResponse = await fetch(`http://127.0.0.1:${workerPort}/healthz`);
    const healthPayload = await healthResponse.json() as {
      service: string;
      status: string;
      scheduling: {
        runninghub: {
          active: number;
          max: number | null;
          available: number | null;
          queued: number;
          lastBackpressureAt: string | null;
          lastBackpressureCode: string | null;
          lastDispatchKickAt: string | null;
        };
      };
      execution: {
        status: string;
      };
    };

    assert.equal(healthResponse.status, 200);
    assert.equal(healthPayload.service, "backend-worker");
    assert.equal(healthPayload.status, "ok");
    assert.equal(healthPayload.execution.status, "running");
    assert.equal(healthPayload.scheduling.runninghub.max, 3);
    assert.ok(typeof healthPayload.scheduling.runninghub.active === "number");
    assert.ok(typeof healthPayload.scheduling.runninghub.queued === "number");

    const run = await waitForRunFinished(queryService, createResult.runId, 5_000);
    const taskSuccess1 = await queryService.getTaskDetail(createResult.tasks[0]!.taskId);
    const taskSuccess2 = await queryService.getTaskDetail(createResult.tasks[1]!.taskId);
    const taskFailed = await queryService.getTaskDetail(createResult.tasks[2]!.taskId);
    const success1Events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
    const success2Events = await executionsRepository.getTaskEvents(createResult.tasks[1]!.taskId);
    const failedEvents = await executionsRepository.getTaskEvents(createResult.tasks[2]!.taskId);

    assert.ok(run);
    assert.equal(run?.status, "failed");
    assert.equal(run?.completedTaskCount, 2);
    assert.equal(run?.failedTaskCount, 1);
    assert.equal(run?.tasks.length, 3);
    assert.deepEqual(
      run?.tasks.map((task) => task.groupId),
      ["group-success-1", "group-success-2", "group-failed"],
    );

    assert.equal(taskSuccess1?.status, "completed");
    assert.equal(taskSuccess1?.groupId, "group-success-1");
    assert.equal(taskSuccess1?.renderFileId, renderFileId1);
    assert.equal(taskSuccess1?.referenceFileId, referenceFileId1);
    assert.equal(taskSuccess1?.provider, "runninghub");
    assert.equal(taskSuccess1?.workflowId, TEST_WORKFLOW_ID);
    assert.equal(
      taskSuccess1?.workflowTemplateKey,
      AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
    );
    assert.equal(taskSuccess1?.providerTaskId, "rh-task-render-success-1");
    assert.equal(taskSuccess1?.providerClientId, "rh-client-render-success-1");
    assert.equal(taskSuccess1?.resultFile?.fileType, "image");
    assert.equal(taskSuccess1?.resultFile?.sourceType, "output");
    assert.ok(taskSuccess1?.resultFileId);

    assert.equal(taskSuccess2?.status, "completed");
    assert.equal(taskSuccess2?.groupId, "group-success-2");
    assert.equal(taskSuccess2?.renderFileId, renderFileId2);
    assert.equal(taskSuccess2?.referenceFileId, referenceFileId2);
    assert.equal(taskSuccess2?.providerTaskId, "rh-task-render-success-2");
    assert.equal(taskSuccess2?.providerClientId, "rh-client-render-success-2");
    assert.equal(taskSuccess2?.resultFile?.fileType, "image");
    assert.ok(taskSuccess2?.resultFileId);

    assert.equal(taskFailed?.status, "failed");
    assert.equal(taskFailed?.groupId, "group-failed");
    assert.equal(taskFailed?.renderFileId, renderFileIdFailed);
    assert.equal(taskFailed?.referenceFileId, referenceFileIdFailed);
    assert.equal(taskFailed?.resultFileId, null);
    assert.equal(taskFailed?.lastErrorCode, "INVALID_RESPONSE");
    assert.equal(taskFailed?.providerTaskId, "rh-task-render-failed");
    assert.equal(taskFailed?.providerClientId, "rh-client-render-failed");
    assert.ok(taskFailed?.lastErrorMessage?.includes("127"));

    assert.ok(success1Events.some((event) => event.eventType === "step_final_started"));
    assert.ok(success1Events.some((event) => event.eventType === "task_artifact_received"));
    assert.ok(success1Events.some((event) => event.eventType === "step_final_completed"));
    assert.ok(success1Events.some((event) => event.eventType === "task_completed"));

    assert.ok(success2Events.some((event) => event.eventType === "step_final_started"));
    assert.ok(success2Events.some((event) => event.eventType === "task_artifact_received"));
    assert.ok(success2Events.some((event) => event.eventType === "step_final_completed"));
    assert.ok(success2Events.some((event) => event.eventType === "task_completed"));

    assert.ok(failedEvents.some((event) => event.eventType === "step_final_started"));
    assert.ok(failedEvents.some((event) => event.eventType === "task_failed"));
    assert.equal(
      failedEvents.filter((event) => event.eventType === "task_retry_scheduled").length,
      2,
    );

    const success1Result = await filesRepository.readFileContent(taskSuccess1!.resultFileId!);
    const success2Result = await filesRepository.readFileContent(taskSuccess2!.resultFileId!);

    assert.equal(success1Result?.buffer.toString("utf8"), "multi-view-success-1-content");
    assert.equal(success2Result?.buffer.toString("utf8"), "multi-view-success-2-content");

    const uploadRecords = providerRecords.filter((item) => item.stage === "upload");
    const createRecords = providerRecords.filter((item) => item.stage === "create");
    const queryRecords = providerRecords.filter((item) => item.stage === "query");
    const downloadRecords = providerRecords.filter((item) => item.stage === "download");

    assert.equal(uploadRecords.length, 10);
    assert.equal(createRecords.length, 5);
    assert.ok(queryRecords.length >= 7);
    assert.equal(downloadRecords.length, 2);

    await app.stop();
    workerStarted = false;
  } finally {
    if (app && workerStarted) {
      await app.stop();
    }

    if (originalHost === undefined) {
      delete process.env.BACKEND_HOST;
    } else {
      process.env.BACKEND_HOST = originalHost;
    }

    if (originalPort === undefined) {
      delete process.env.BACKEND_WORKER_PORT;
    } else {
      process.env.BACKEND_WORKER_PORT = originalPort;
    }

    if (originalPollInterval === undefined) {
      delete process.env.BACKEND_WORKER_POLL_INTERVAL_MS;
    } else {
      process.env.BACKEND_WORKER_POLL_INTERVAL_MS = originalPollInterval;
    }

    if (originalPersistenceMode === undefined) {
      delete process.env.BACKEND_PERSISTENCE_MODE;
    } else {
      process.env.BACKEND_PERSISTENCE_MODE = originalPersistenceMode;
    }

    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
