import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  cleanupDbE2EContext,
  createDbE2EContext,
  registerAndUploadFile,
  registerAccount,
  startDbApi,
  closeDbApi,
} from "./bootstrap-db.ts";
import { DbExecutionsRepository } from "../../api/src/modules/executions/db-executions.repository.ts";
import { ExecutionStoreInputBuilder } from "../../api/src/modules/executions/execution-store-input.builder.ts";
import { DbFilesRepository } from "../../api/src/modules/files/db-files.repository.ts";
import { DbIntermediateArtifactRepository } from "../../worker/src/modules/intermediate/db-intermediate-artifact.repository.ts";
import { IntermediateArtifactService } from "../../worker/src/modules/intermediate/intermediate-artifact.service.ts";
import { IntermediateLockService } from "../../worker/src/modules/intermediate/intermediate-lock.service.ts";
import { WhiteModelRenderExecutor } from "../../worker/src/modules/executors/white-model-render.executor.ts";
import { LocalStorageAdapter } from "../../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../../worker/src/modules/storage/storage.service.ts";
import { createWhiteModelRenderRequest } from "../helpers/execution-request.fixture.ts";

interface ProviderCall {
  snapshotLabel?: string;
  imageText: string[];
}

interface ArtifactSummaryRow extends Record<string, unknown> {
  artifact_type: string;
  status: string;
  file_id: string | null;
}

interface IntermediateAssetCountRow extends Record<string, unknown> {
  count: number;
}

interface TaskLinkRow extends Record<string, unknown> {
  task_id: string;
  file_id: string;
  source_handle: string | null;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(
    () => true,
    () => false,
  );
}

function createProvider(providerCalls: ProviderCall[]) {
  return {
    async generateImage(input: {
      snapshotLabel?: string;
      images: Array<{ dataBase64: string }>;
    }): Promise<{
      imageBase64: string;
      mimeType: string;
    }> {
      providerCalls.push({
        snapshotLabel: input.snapshotLabel,
        imageText: input.images.map((item) =>
          Buffer.from(item.dataBase64, "base64").toString("utf8")
        ),
      });

      if (input.snapshotLabel?.endsWith("-lineart")) {
        return {
          imageBase64: Buffer.from("db-lineart-result").toString("base64"),
          mimeType: "image/png",
        };
      }

      if (input.snapshotLabel?.endsWith("-depth")) {
        return {
          imageBase64: Buffer.from("db-depth-result").toString("base64"),
          mimeType: "image/png",
        };
      }

      return {
        imageBase64: Buffer.from(`db-final-result:${input.snapshotLabel ?? "unknown"}`).toString("base64"),
        mimeType: "image/png",
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
    nodeId: "node-white-model-db",
    nodeTitle: "White Model DB",
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

async function run(): Promise<void> {
  const context = await createDbE2EContext("intermediate_artifacts");
  const api = await startDbApi(context);
  const legacyStorePath = path.join(context.rootDir, "data", "intermediate-artifacts-store.json");

  try {
    await fs.rm(path.join(context.rootDir, "data"), { recursive: true, force: true });
    assert.equal(await exists(legacyStorePath), false);

    const user = await registerAccount(api.baseUrl, {
      email: "intermediate-db-owner@example.com",
      password: "intermediate-db-owner-pass",
      displayName: "Intermediate DB Owner",
    });
    const whiteModel = await registerAndUploadFile(api.baseUrl, user.accessToken, {
      content: "white-model-db-content",
      originalName: "white-model-db.png",
      sourceType: "input",
    });
    const styleReference = await registerAndUploadFile(api.baseUrl, user.accessToken, {
      content: "style-reference-db-content",
      originalName: "style-reference-db.png",
      sourceType: "input",
    });

    const filesRepository = new DbFilesRepository(context.databaseConfig, { rootDir: context.rootDir });
    const executionsRepository = new DbExecutionsRepository(context.databaseConfig);
    const intermediateArtifactService = new IntermediateArtifactService(
      new DbIntermediateArtifactRepository(context.databaseConfig),
      filesRepository,
      new IntermediateLockService(),
      {
        waitRetryDelayMs: 5,
        waitTimeoutMs: 5_000,
      },
    );
    const storageService = new StorageService(new LocalStorageAdapter(context.rootDir));
    const providerCalls: ProviderCall[] = [];
    const executor = new WhiteModelRenderExecutor(
      executionsRepository,
      filesRepository,
      intermediateArtifactService,
      createProvider(providerCalls),
      storageService,
    );

    const first = await createQueuedWhiteModelTask({
      executionsRepository,
      userId: user.userId,
      workflowId: "workflow-intermediate-db-first",
      whiteModelFileId: whiteModel.fileId,
      styleReferenceFileId: styleReference.fileId,
    });
    const firstResult = await executor.execute({
      userId: user.userId,
      runId: first.runId,
      taskId: first.task.id,
      taskNo: first.task.taskNo,
      whiteModelFileId: whiteModel.fileId,
      styleReferenceFileId: styleReference.fileId,
      model: "gemini-3-pro-image-preview",
      imageSize: "1K",
      aspectRatio: "1:1",
    });
    await executionsRepository.markTaskCompleted(first.task.id);

    assert.equal(firstResult.usedCachedLineart, false);
    assert.equal(firstResult.usedCachedDepth, false);
    assert.notEqual(firstResult.lineartFileId, firstResult.depthFileId);
    assert.ok(firstResult.resultFileId);
    assert.equal(providerCalls.length, 3);
    assert.deepEqual(providerCalls.map((call) => call.snapshotLabel), [
      `${first.task.taskNo}-lineart`,
      `${first.task.taskNo}-depth`,
      `${first.task.taskNo}-final`,
    ]);
    assert.equal(await exists(legacyStorePath), false);

    const artifactRows = await context.pool.query<ArtifactSummaryRow>(
      `
        select artifact_type, status, file_id::text
        from intermediate_artifacts
        order by artifact_type asc
      `,
    );
    assert.deepEqual(artifactRows.rows.map((row) => row.artifact_type), ["depth", "lineart"]);
    assert.ok(artifactRows.rows.every((row) => row.status === "ready" && row.file_id));
    assert.ok(artifactRows.rows.some((row) => row.artifact_type === "lineart" && row.file_id === firstResult.lineartFileId));
    assert.ok(artifactRows.rows.some((row) => row.artifact_type === "depth" && row.file_id === firstResult.depthFileId));

    const intermediateAssets = await context.pool.query<IntermediateAssetCountRow>(
      "select count(*)::int from file_assets where source_type = 'intermediate'",
    );
    assert.equal(intermediateAssets.rows[0]?.count, 2);

    const firstLinks = await context.pool.query<TaskLinkRow>(
      `
        select task_id::text, file_id::text, source_handle
        from task_file_links
        where task_id = $1::uuid and role = 'intermediate'
        order by source_handle asc
      `,
      [first.task.id],
    );
    assert.deepEqual(firstLinks.rows.map((row) => row.source_handle), [
      "intermediate.depth",
      "intermediate.lineart",
    ]);

    const second = await createQueuedWhiteModelTask({
      executionsRepository,
      userId: user.userId,
      workflowId: "workflow-intermediate-db-second",
      whiteModelFileId: whiteModel.fileId,
      styleReferenceFileId: styleReference.fileId,
    });
    const secondResult = await executor.execute({
      userId: user.userId,
      runId: second.runId,
      taskId: second.task.id,
      taskNo: second.task.taskNo,
      whiteModelFileId: whiteModel.fileId,
      styleReferenceFileId: styleReference.fileId,
      model: "gemini-3-pro-image-preview",
      imageSize: "1K",
      aspectRatio: "1:1",
    });
    await executionsRepository.markTaskCompleted(second.task.id);

    assert.equal(secondResult.usedCachedLineart, true);
    assert.equal(secondResult.usedCachedDepth, true);
    assert.equal(secondResult.lineartFileId, firstResult.lineartFileId);
    assert.equal(secondResult.depthFileId, firstResult.depthFileId);
    assert.ok(secondResult.resultFileId);
    assert.notEqual(secondResult.resultFileId, firstResult.resultFileId);
    assert.equal(providerCalls.length, 4);
    assert.equal(providerCalls.at(-1)?.snapshotLabel, `${second.task.taskNo}-final`);

    const finalArtifactCount = await context.pool.query<IntermediateAssetCountRow>(
      "select count(*)::int from intermediate_artifacts",
    );
    assert.equal(finalArtifactCount.rows[0]?.count, 2);
    const finalIntermediateAssetCount = await context.pool.query<IntermediateAssetCountRow>(
      "select count(*)::int from file_assets where source_type = 'intermediate'",
    );
    assert.equal(finalIntermediateAssetCount.rows[0]?.count, 2);

    const cacheHitEvents = await context.pool.query<{ count: number }>(
      "select count(*)::int from task_events where task_id = $1::uuid and event_type = 'step_cache_hit'",
      [second.task.id],
    );
    assert.equal(cacheHitEvents.rows[0]?.count, 2);

    const secondLinks = await context.pool.query<TaskLinkRow>(
      `
        select task_id::text, file_id::text, source_handle
        from task_file_links
        where task_id = $1::uuid and role = 'intermediate'
        order by source_handle asc
      `,
      [second.task.id],
    );
    assert.deepEqual(secondLinks.rows.map((row) => row.file_id), [
      firstResult.depthFileId,
      firstResult.lineartFileId,
    ]);
    assert.equal(await exists(legacyStorePath), false);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
