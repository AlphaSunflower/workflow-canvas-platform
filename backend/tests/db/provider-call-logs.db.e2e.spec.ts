import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  type ExecutionError,
} from "../../shared/src/index.ts";
import { DbExecutionsRepository } from "../../api/src/modules/executions/db-executions.repository.ts";
import { ExecutionStoreInputBuilder } from "../../api/src/modules/executions/execution-store-input.builder.ts";
import { DbFilesRepository } from "../../api/src/modules/files/db-files.repository.ts";
import { WhiteModelRenderExecutor } from "../../worker/src/modules/executors/white-model-render.executor.ts";
import { DbIntermediateArtifactRepository } from "../../worker/src/modules/intermediate/db-intermediate-artifact.repository.ts";
import { IntermediateArtifactService } from "../../worker/src/modules/intermediate/intermediate-artifact.service.ts";
import { IntermediateLockService } from "../../worker/src/modules/intermediate/intermediate-lock.service.ts";
import { DbProviderCallLogRepository } from "../../worker/src/modules/provider-call-logs/provider-call-log.repository.ts";
import { LocalStorageAdapter } from "../../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../../worker/src/modules/storage/storage.service.ts";
import { createWhiteModelRenderRequest } from "../helpers/execution-request.fixture.ts";
import {
  cleanupDbE2EContext,
  closeDbApi,
  createDbE2EContext,
  registerAccount,
  registerAndUploadFile,
  startDbApi,
} from "./bootstrap-db.ts";

interface ProviderCallLogRow extends Record<string, unknown> {
  step_type: string;
  provider: string;
  model: string;
  success: boolean;
  error_code: string | null;
  error_message: string | null;
  http_status: number | null;
  request_summary: Record<string, unknown>;
  response_summary: Record<string, unknown>;
}

async function createSnapshot(rootDir: string, label: string): Promise<string> {
  const snapshotPath = path.join(rootDir, "provider-snapshots", `${label}.json`);
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(
    snapshotPath,
    JSON.stringify({
      label,
      savedAt: new Date().toISOString(),
    }),
    "utf8",
  );
  return snapshotPath;
}

function createSuccessfulProvider(rootDir: string) {
  return {
    async generateImage(input: {
      snapshotLabel?: string;
    }): Promise<{
      imageBase64: string;
      mimeType: string;
      snapshotPath: string;
    }> {
      const label = input.snapshotLabel ?? "success";
      return {
        imageBase64: Buffer.from(`provider-log-result:${label}`).toString("base64"),
        mimeType: "image/png",
        snapshotPath: await createSnapshot(rootDir, label),
      };
    },
  };
}

function createFailingFinalProvider(rootDir: string) {
  return {
    async generateImage(input: {
      snapshotLabel?: string;
    }): Promise<{
      imageBase64: string;
      mimeType: string;
      snapshotPath: string;
    }> {
      const label = input.snapshotLabel ?? "failed";
      if (label.endsWith("-final")) {
        const snapshotPath = await createSnapshot(rootDir, label);
        const error: ExecutionError = {
          code: ERROR_CODES.providerError,
          message: "Provider final call failed.",
          category: ERROR_CATEGORIES.provider,
          retryable: false,
          provider: "laozhang",
          providerCode: "PROVIDER_FINAL_FAILED",
          details: {
            httpStatus: 502,
            snapshotPath,
          },
        };
        throw error;
      }

      return {
        imageBase64: Buffer.from(`provider-log-result:${label}`).toString("base64"),
        mimeType: "image/png",
        snapshotPath: await createSnapshot(rootDir, label),
      };
    },
  };
}

async function createQueuedWhiteModelTask(input: {
  executionsRepository: DbExecutionsRepository;
  userId: string;
  workflowId: string;
  whiteModelFileId: string;
  styleReferenceFileId: string;
}) {
  const request = createWhiteModelRenderRequest({
    userId: input.userId,
    workflowId: input.workflowId,
    nodeType: "aiModelRenderTransfer",
    taskType: "model-render-transfer",
    executionMode: "legacy-grouped-task",
    nodeId: `node-${input.workflowId}`,
    nodeTitle: "Provider Call Log DB",
    model: "gemini-3-pro-image-preview",
    imageSize: "1K",
    aspectRatio: "1:1",
    groups: [
      {
        groupId: "group-1",
        whiteModelFileId: input.whiteModelFileId,
        styleReferenceFileId: input.styleReferenceFileId,
      },
    ],
  });
  const storeInput = new ExecutionStoreInputBuilder().build(request);
  const created = await input.executionsRepository.createExecution(storeInput);
  const claimed = await input.executionsRepository.claimQueuedTaskById(created.tasks[0]!.taskId);

  assert.ok(claimed);

  return {
    runId: created.runId,
    task: claimed.task,
  };
}

async function readProviderLogs(
  taskId: string,
  context: Awaited<ReturnType<typeof createDbE2EContext>>,
): Promise<ProviderCallLogRow[]> {
  const logs = await context.pool.query<ProviderCallLogRow>(
    `
      select
        step_type,
        provider,
        model,
        success,
        error_code,
        error_message,
        http_status,
        request_summary,
        response_summary
      from provider_call_logs
      where task_id = $1::uuid
      order by started_at asc, id asc
    `,
    [taskId],
  );

  return logs.rows;
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("provider_call_logs");
  const api = await startDbApi(context);

  try {
    const user = await registerAccount(api.baseUrl, {
      email: "provider-log-owner@example.com",
      password: "provider-log-owner-pass",
      displayName: "Provider Log Owner",
    });
    const whiteModel = await registerAndUploadFile(api.baseUrl, user.accessToken, {
      content: "provider-log-white-model",
      originalName: "provider-log-white-model.png",
      sourceType: "input",
    });
    const styleReference = await registerAndUploadFile(api.baseUrl, user.accessToken, {
      content: "provider-log-style-reference",
      originalName: "provider-log-style-reference.png",
      sourceType: "input",
    });

    const filesRepository = new DbFilesRepository(context.databaseConfig, {
      rootDir: context.rootDir,
    });
    const executionsRepository = new DbExecutionsRepository(context.databaseConfig);
    const storageService = new StorageService(new LocalStorageAdapter(context.rootDir));
    const createIntermediateService = () =>
      new IntermediateArtifactService(
        new DbIntermediateArtifactRepository(context.databaseConfig),
        filesRepository,
        new IntermediateLockService(),
        {
          waitRetryDelayMs: 5,
          waitTimeoutMs: 5_000,
        },
      );
    const providerCallLogRepository = new DbProviderCallLogRepository(context.databaseConfig);

    const successTask = await createQueuedWhiteModelTask({
      executionsRepository,
      userId: user.userId,
      workflowId: "workflow-provider-log-success",
      whiteModelFileId: whiteModel.fileId,
      styleReferenceFileId: styleReference.fileId,
    });
    const successExecutor = new WhiteModelRenderExecutor(
      executionsRepository,
      filesRepository,
      createIntermediateService(),
      createSuccessfulProvider(context.rootDir),
      storageService,
      providerCallLogRepository,
    );

    const successResult = await successExecutor.execute({
      userId: user.userId,
      runId: successTask.runId,
      taskId: successTask.task.id,
      taskNo: successTask.task.taskNo,
      whiteModelFileId: whiteModel.fileId,
      styleReferenceFileId: styleReference.fileId,
      model: "gemini-3-pro-image-preview",
      imageSize: "1K",
      aspectRatio: "1:1",
    });
    await executionsRepository.markTaskCompleted(successTask.task.id);

    assert.ok(successResult.resultFileId);
    const successLogs = await readProviderLogs(successTask.task.id, context);
    assert.deepEqual(successLogs.map((row) => row.step_type), ["lineart", "depth", "final"]);
    assert.equal(successLogs.every((row) => row.success), true);
    assert.equal(successLogs.every((row) => row.provider === "laozhang"), true);
    assert.equal(
      successLogs.every((row) => row.model === "gemini-3-pro-image-preview"),
      true,
    );

    for (const log of successLogs) {
      assert.equal(typeof log.request_summary.snapshotLabel, "string");
      const snapshotPath = log.response_summary.snapshotPath;
      assert.equal(typeof snapshotPath, "string");
      await fs.stat(snapshotPath as string);
    }

    await context.pool.query("delete from intermediate_artifacts");
    const failedTask = await createQueuedWhiteModelTask({
      executionsRepository,
      userId: user.userId,
      workflowId: "workflow-provider-log-failed",
      whiteModelFileId: whiteModel.fileId,
      styleReferenceFileId: styleReference.fileId,
    });
    const failedExecutor = new WhiteModelRenderExecutor(
      executionsRepository,
      filesRepository,
      createIntermediateService(),
      createFailingFinalProvider(context.rootDir),
      storageService,
      providerCallLogRepository,
    );

    await assert.rejects(
      () =>
        failedExecutor.execute({
          userId: user.userId,
          runId: failedTask.runId,
          taskId: failedTask.task.id,
          taskNo: failedTask.task.taskNo,
          whiteModelFileId: whiteModel.fileId,
          styleReferenceFileId: styleReference.fileId,
          model: "gemini-3-pro-image-preview",
          imageSize: "1K",
          aspectRatio: "1:1",
        }),
      /Provider final call failed/u,
    );

    const failedLogs = await readProviderLogs(failedTask.task.id, context);
    assert.deepEqual(failedLogs.map((row) => row.step_type), ["lineart", "depth", "final"]);
    const failedFinalLog = failedLogs.find((row) => row.step_type === "final");
    assert.ok(failedFinalLog);
    assert.equal(failedFinalLog.success, false);
    assert.equal(failedFinalLog.error_code, "PROVIDER_FINAL_FAILED");
    assert.match(failedFinalLog.error_message ?? "", /Provider final call failed/u);
    assert.equal(failedFinalLog.http_status, 502);
    assert.equal(typeof failedFinalLog.response_summary.snapshotPath, "string");
    await fs.stat(failedFinalLog.response_summary.snapshotPath as string);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
