import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { createEnv } from "../shared/src/env.ts";
import { WorkerApp } from "../worker/src/app.ts";
import { ExecutionEventService } from "../worker/src/modules/execution-events/execution-event.service.ts";
import { WhiteModelRenderExecutor } from "../worker/src/modules/executors/white-model-render.executor.ts";
import { WhiteModelRenderTaskExecutor } from "../worker/src/modules/executors/white-model-render-task.executor.ts";
import { ExecutionRunService } from "../worker/src/modules/execution-run/execution-run.service.ts";
import { IntermediateArtifactRepository } from "../worker/src/modules/intermediate/intermediate-artifact.repository.ts";
import { IntermediateArtifactService } from "../worker/src/modules/intermediate/intermediate-artifact.service.ts";
import { IntermediateLockService } from "../worker/src/modules/intermediate/intermediate-lock.service.ts";
import { ProviderSnapshotCleanerService } from "../worker/src/modules/providers/provider-snapshot-cleaner.service.ts";
import { QueueRepository } from "../worker/src/modules/queue/queue.repository.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";
import { RetryPolicyService } from "../worker/src/modules/retry/retry-policy.service.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";
import { createWhiteModelRenderRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-execution-e2e";
const TEST_SLOW_WORKFLOW_ID = "workflow-execution-e2e-slow";

interface ProviderCallRecord {
  snapshotLabel?: string;
  imagesText: string[];
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

function createProviderClient(records: ProviderCallRecord[]) {
  return {
    async generateImage(input: {
      prompt: string;
      images: Array<{
        mimeType: string;
        dataBase64: string;
      }>;
      snapshotLabel?: string;
    }) {
      const imagesText = input.images.map((item) =>
        Buffer.from(item.dataBase64, "base64").toString("utf8")
      );
      records.push({
        snapshotLabel: input.snapshotLabel,
        imagesText,
      });

      if (
        input.snapshotLabel?.endsWith("-final")
        && imagesText[0] === "style-reference-2"
      ) {
        throw {
          code: "PROVIDER_ERROR",
          message: "final render failed for group-2",
          category: "provider_retryable",
          retryable: false,
        };
      }

      if (input.snapshotLabel?.endsWith("-lineart")) {
        return {
          imageBase64: Buffer.from(`lineart:${imagesText[0]}`).toString("base64"),
          mimeType: "image/png",
        };
      }

      if (input.snapshotLabel?.endsWith("-depth")) {
        return {
          imageBase64: Buffer.from(`depth:${imagesText[0]}`).toString("base64"),
          mimeType: "image/png",
        };
      }

      return {
        imageBase64: Buffer.from(`final:${imagesText.join("|")}`).toString("base64"),
        mimeType: "image/png",
      };
    },
  };
}

function createSlowIntermediateProviderClient(
  records: ProviderCallRecord[],
  intermediateDelayMs: number,
) {
  return {
    async generateImage(input: {
      prompt: string;
      images: Array<{
        mimeType: string;
        dataBase64: string;
      }>;
      snapshotLabel?: string;
    }) {
      const imagesText = input.images.map((item) =>
        Buffer.from(item.dataBase64, "base64").toString("utf8")
      );
      records.push({
        snapshotLabel: input.snapshotLabel,
        imagesText,
      });

      if (
        input.snapshotLabel?.endsWith("-lineart")
        || input.snapshotLabel?.endsWith("-depth")
      ) {
        await new Promise((resolve) => {
          setTimeout(resolve, intermediateDelayMs);
        });
      }

      if (input.snapshotLabel?.endsWith("-lineart")) {
        return {
          imageBase64: Buffer.from(`lineart:${imagesText[0]}`).toString("base64"),
          mimeType: "image/png",
        };
      }

      if (input.snapshotLabel?.endsWith("-depth")) {
        return {
          imageBase64: Buffer.from(`depth:${imagesText[0]}`).toString("base64"),
          mimeType: "image/png",
        };
      }

      return {
        imageBase64: Buffer.from(`final:${imagesText.join("|")}`).toString("base64"),
        mimeType: "image/png",
      };
    },
  };
}

async function waitForRunFinished(
  queryService: ExecutionQueryService,
  runId: string,
  timeoutMs: number,
) {
  const startedAt = Date.now();
  let lastObservedStatus: string | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const run = await queryService.getExecutionRun(runId);

    if (run?.status === "completed" || run?.status === "failed") {
      return run;
    }

    lastObservedStatus = run?.status ?? null;

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error(`RUN_WAIT_TIMEOUT:${runId}:${lastObservedStatus ?? "missing"}`);
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-execution-e2e-"));
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
    const providerRecords: ProviderCallRecord[] = [];
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const intermediateArtifactService = new IntermediateArtifactService(
      new IntermediateArtifactRepository(rootDir),
      filesRepository,
      new IntermediateLockService(),
    );
    const executor = new WhiteModelRenderExecutor(
      executionsRepository,
      filesRepository,
      intermediateArtifactService,
      createProviderClient(providerRecords),
      storageService,
    );
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      new WhiteModelRenderTaskExecutor(executor),
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
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

    const sharedWhiteModelFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "white-model-shared.png",
      "white-model-shared",
    );
    const styleFileId1 = await registerReadyFile(
      filesRepository,
      "user-a",
      "style-1.png",
      "style-reference-1",
    );
    const styleFileId2 = await registerReadyFile(
      filesRepository,
      "user-a",
      "style-2.png",
      "style-reference-2",
    );

    const createResult = await executionsService.createExecution(createWhiteModelRenderRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiModelRenderTransfer",
      taskType: "model-render-transfer",
      executionMode: "legacy-grouped-task",
      nodeId: "node-e2e",
      nodeTitle: "白模渲染端到端测试",
      groups: [
        {
          groupId: "group-1",
          whiteModelFileId: sharedWhiteModelFileId,
          styleReferenceFileId: styleFileId1,
        },
        {
          groupId: "group-2",
          whiteModelFileId: sharedWhiteModelFileId,
          styleReferenceFileId: styleFileId2,
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
      port: number;
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
    assert.equal(healthPayload.port, workerPort);
    assert.equal(healthPayload.execution.status, "running");
    assert.equal(healthPayload.scheduling.runninghub.max, 3);
    assert.ok(typeof healthPayload.scheduling.runninghub.active === "number");
    assert.ok(typeof healthPayload.scheduling.runninghub.queued === "number");

    const run = await waitForRunFinished(queryService, createResult.runId, 20_000);
    const task1 = await queryService.getTaskDetail(createResult.tasks[0]!.taskId);
    const task2 = await queryService.getTaskDetail(createResult.tasks[1]!.taskId);
    const task1Events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
    const task2Events = await executionsRepository.getTaskEvents(createResult.tasks[1]!.taskId);
    const allEvents = [...task1Events, ...task2Events];

    assert.ok(run);
    assert.equal(run?.status, "failed");
    assert.equal(run?.completedTaskCount, 1);
    assert.equal(run?.failedTaskCount, 1);
    assert.ok(run?.completedAt);

    assert.equal(task1?.status, "completed");
    assert.equal(task1?.resultFile?.sourceType, "output");
    assert.equal(task1?.currentStep, "final");
    assert.equal(task1?.lastErrorCode, null);
    assert.equal(task1?.maxAttempts, 3);
    assert.ok(task1?.resultFileId);

    assert.equal(task2?.status, "failed");
    assert.equal(task2?.resultFileId, null);
    assert.equal(task2?.lastErrorCode, "PROVIDER_ERROR");
    assert.equal(task2?.lastErrorMessage, "final render failed for group-2");
    assert.equal(task2?.currentAttemptNo, 1);
    assert.equal(task2?.retryCount, 0);

    assert.ok(task1Events.some((event) => event.eventType === "step_final_completed"));
    assert.ok(task1Events.some((event) => event.eventType === "task_completed"));

    assert.ok(task2Events.some((event) => event.eventType === "step_final_started"));
    assert.ok(task2Events.some((event) => event.eventType === "task_failed"));
    assert.equal(
      task2Events.filter((event) => event.eventType === "task_retry_scheduled").length,
      0,
    );
    assert.equal(
      allEvents.filter((event) => event.eventType === "step_lineart_started").length,
      1,
    );
    assert.equal(
      allEvents.filter((event) => event.eventType === "step_depth_started").length,
      1,
    );
    assert.equal(
      allEvents.filter((event) => event.eventType === "step_cache_hit").length,
      2,
    );

    const lineartCalls = providerRecords.filter((item) => item.snapshotLabel?.endsWith("-lineart"));
    const depthCalls = providerRecords.filter((item) => item.snapshotLabel?.endsWith("-depth"));
    const finalCalls = providerRecords.filter((item) => item.snapshotLabel?.endsWith("-final"));

    assert.equal(lineartCalls.length, 1);
    assert.equal(depthCalls.length, 1);
    assert.equal(finalCalls.length, 2);
    assert.ok(finalCalls.some((call) =>
      JSON.stringify(call.imagesText) === JSON.stringify([
        "style-reference-1",
        "lineart:white-model-shared",
        "depth:white-model-shared",
        "white-model-shared",
      ])
    ));
    assert.ok(finalCalls.some((call) =>
      JSON.stringify(call.imagesText) === JSON.stringify([
        "style-reference-2",
        "lineart:white-model-shared",
        "depth:white-model-shared",
        "white-model-shared",
      ])
    ));

    const savedResult = await filesRepository.readFileContent(task1!.resultFileId!);

    assert.ok(savedResult);
    assert.equal(
      savedResult?.buffer.toString("utf8"),
      "final:style-reference-1|lineart:white-model-shared|depth:white-model-shared|white-model-shared",
    );

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

async function runSlowIntermediateSharingScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-execution-e2e-slow-intermediate-"));
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
    const providerRecords: ProviderCallRecord[] = [];
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const intermediateArtifactService = new IntermediateArtifactService(
      new IntermediateArtifactRepository(rootDir),
      filesRepository,
      new IntermediateLockService({
        lockTimeoutMs: 100,
      }),
      {
        waitRetryDelayMs: 20,
        waitTimeoutMs: 2_000,
      },
    );
    const executor = new WhiteModelRenderExecutor(
      executionsRepository,
      filesRepository,
      intermediateArtifactService,
      createSlowIntermediateProviderClient(providerRecords, 250),
      storageService,
    );
    const queueService = new QueueService(
      new QueueRepository(executionsRepository),
      new WhiteModelRenderTaskExecutor(executor),
      new ExecutionEventService(executionsRepository),
      new RetryPolicyService({
        retryIntervalsMs: [5, 5],
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

    const sharedWhiteModelFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "white-model-shared-slow.png",
      "white-model-shared-slow",
    );

    const styleFileIds = await Promise.all(
      Array.from({ length: 10 }, async (_, index) =>
        registerReadyFile(
          filesRepository,
          "user-a",
          `style-${index + 1}.png`,
          `style-reference-${index + 1}`,
        )),
    );

    const createResult = await executionsService.createExecution(createWhiteModelRenderRequest({
      userId: "user-a",
      workflowId: TEST_SLOW_WORKFLOW_ID,
      nodeType: "aiModelRenderTransfer",
      taskType: "model-render-transfer",
      executionMode: "legacy-grouped-task",
      nodeId: "node-e2e-slow",
      nodeTitle: "white-model-render-slow-intermediate",
      groups: styleFileIds.map((styleReferenceFileId, index) => ({
        groupId: `group-${index + 1}`,
        whiteModelFileId: sharedWhiteModelFileId,
        styleReferenceFileId,
      })),
    }));

    await app.start();
    workerStarted = true;

    const run = await waitForRunFinished(queryService, createResult.runId, 20_000);
    assert.ok(run);
    assert.equal(run?.status, "completed");
    assert.equal(run?.completedTaskCount, 10);
    assert.equal(run?.failedTaskCount, 0);

    const lineartCalls = providerRecords.filter((item) => item.snapshotLabel?.endsWith("-lineart"));
    const depthCalls = providerRecords.filter((item) => item.snapshotLabel?.endsWith("-depth"));
    const finalCalls = providerRecords.filter((item) => item.snapshotLabel?.endsWith("-final"));

    assert.equal(lineartCalls.length, 1);
    assert.equal(depthCalls.length, 1);
    assert.equal(finalCalls.length, 10);

    for (const task of createResult.tasks) {
      const taskDetail = await queryService.getTaskDetail(task.taskId);
      const taskEvents = await executionsRepository.getTaskEvents(task.taskId);

      assert.equal(taskDetail?.status, "completed");
      assert.ok(taskEvents.every((event) => !String(event.message ?? "").includes("INTERMEDIATE_LOCK_TIMEOUT")));
    }
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

void (async () => {
  await run();
  await runSlowIntermediateSharingScenario();
})();
