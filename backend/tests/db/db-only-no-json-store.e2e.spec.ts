import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  SAMPLE_PNG,
  bearer,
  cleanupDbE2EContext,
  closeDbApi,
  createDbE2EContext,
  createDbTestEnv,
  promoteUserToAdmin,
  registerAccount,
  registerAndUploadFile,
  requestBuffer,
  requestJson,
  startDbApi,
} from "./bootstrap-db.ts";
import { DbExecutionsRepository } from "../../api/src/modules/executions/db-executions.repository.ts";
import { DbFilesRepository } from "../../api/src/modules/files/db-files.repository.ts";
import { createWorkerDependencies } from "../../worker/src/composition/create-worker-dependencies.ts";
import { DbIntermediateArtifactRepository } from "../../worker/src/modules/intermediate/db-intermediate-artifact.repository.ts";
import type { QueueTaskExecutorInput } from "../../worker/src/modules/executors/queue-task-executor.types.ts";
import type { QueueTaskExecutorRegistry } from "../../worker/src/modules/executors/executor.registry.ts";
import { WorkerFileAssetService } from "../../worker/src/modules/files/worker-file-asset.service.ts";
import { LocalStorageAdapter } from "../../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../../worker/src/modules/storage/storage.service.ts";

class DbOnlyOutputExecutor {
  readonly nodeType = "aiImageHd";

  constructor(
    private readonly executionsRepository: DbExecutionsRepository,
    private readonly fileAssetService: WorkerFileAssetService,
    private readonly storageService: StorageService,
  ) {}

  async execute(input: QueueTaskExecutorInput): Promise<void> {
    const output = Buffer.concat([
      Buffer.from("db-only-no-json-output:"),
      SAMPLE_PNG,
    ]);
    const stored = await this.storageService.saveBuffer({
      sourceType: "output",
      fileType: "image",
      originalName: `${input.task.taskNo}-db-only-output.png`,
      mimeType: "image/png",
      buffer: output,
    });
    const resultFileId = await this.fileAssetService.registerStoredAsset({
      userId: input.task.userId,
      stored,
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
      message: "DB Only output started",
      payload: {
        storageKey: stored.storageKey,
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
      message: "DB Only output completed",
      payload: {
        resultFileId,
      },
    });
  }
}

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(
    () => true,
    () => false,
  );
}

function explicitLegacyStorePaths(rootDir: string): string[] {
  return [
    path.join(rootDir, "data", "accounts-store.json"),
    path.join(rootDir, "data", "accounts-store.lock"),
    path.join(rootDir, "data", "files-store.json"),
    path.join(rootDir, "data", "files", "files-store.json"),
    path.join(rootDir, "data", "files", "files-store.lock"),
    path.join(rootDir, "data", "storage-index.json"),
    path.join(rootDir, "data", "executions-store.json"),
    path.join(rootDir, "data", "executions-store.lock"),
    path.join(rootDir, "data", "intermediate-artifacts-store.json"),
    path.join(rootDir, "data", "intermediate-artifacts-store.lock"),
    path.join(rootDir, "data", "workflows", "index.json"),
    path.join(rootDir, "data", "workflows", "index.lock"),
    path.join(rootDir, "data", "workflows", "accounts-index.json"),
    path.join(rootDir, "data", "workflows", "groups-index.json"),
    path.join(rootDir, "data", "workflows", "groups-index.lock"),
  ];
}

const topLevelLegacyDataFiles = new Set([
  "accounts-store.json",
  "accounts-store.lock",
  "executions-store.json",
  "executions-store.lock",
  "files-store.json",
  "files-store.lock",
  "intermediate-artifacts-store.json",
  "intermediate-artifacts-store.lock",
  "storage-index.json",
]);

const workflowIndexFiles = new Set([
  "workflows/accounts-index.json",
  "workflows/groups-index.json",
  "workflows/groups-index.lock",
  "workflows/index.json",
  "workflows/index.lock",
]);

const workflowRecordFiles = new Set([
  "files.json",
  "files.lock",
  "history.lock",
  "workflow.json",
  "workflow.lock",
]);

function isLegacyStoreDataPath(relativeDataPath: string): boolean {
  const normalized = relativeDataPath.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized);

  if (topLevelLegacyDataFiles.has(normalized) || workflowIndexFiles.has(normalized)) {
    return true;
  }

  if (normalized.startsWith("files/") && topLevelLegacyDataFiles.has(basename)) {
    return true;
  }

  if (!normalized.startsWith("workflows/")) {
    return false;
  }

  if (workflowRecordFiles.has(basename)) {
    return true;
  }

  return normalized.includes("/task-history/") && basename === "index.json";
}

async function collectLegacyStoreFiles(rootDir: string): Promise<string[]> {
  const found = new Set<string>();

  for (const storePath of explicitLegacyStorePaths(rootDir)) {
    if (await exists(storePath)) {
      found.add(storePath);
    }
  }

  const dataDir = path.join(rootDir, "data");
  if (!(await exists(dataDir))) {
    return [...found].sort((left, right) => left.localeCompare(right));
  }

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativeDataPath = path.relative(dataDir, absolutePath);
      if (isLegacyStoreDataPath(relativeDataPath)) {
        found.add(absolutePath);
      }
    }
  }

  await walk(dataDir);
  return [...found].sort((left, right) => left.localeCompare(right));
}

async function assertLegacyStoresMissing(rootDir: string): Promise<void> {
  const found = await collectLegacyStoreFiles(rootDir);
  assert.deepEqual(found, [], `Legacy JSON stores should stay absent:\n${found.join("\n")}`);
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("db_only_no_json_store");
  const api = await startDbApi(context);

  try {
    await fs.rm(path.join(context.rootDir, "data"), { recursive: true, force: true });
    await assertLegacyStoresMissing(context.rootDir);

    const admin = await registerAccount(api.baseUrl, {
      email: "db-only-admin@example.com",
      password: "db-only-admin-pass",
      displayName: "DB Only Admin",
    });
    const member = await registerAccount(api.baseUrl, {
      email: "db-only-member@example.com",
      password: "db-only-member-pass",
      displayName: "DB Only Member",
    });
    const other = await registerAccount(api.baseUrl, {
      email: "db-only-other@example.com",
      password: "db-only-other-pass",
      displayName: "DB Only Other",
    });
    await promoteUserToAdmin(context, admin.userId);

    const refreshedMember = await requestJson<{
      tokens: { accessToken: string; refreshToken: string };
      user: { userId: string };
    }>(api.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      payload: {
        refreshToken: member.refreshToken,
      },
    });
    assert.equal(refreshedMember.status, 200);
    assert.equal(refreshedMember.body.data?.user.userId, member.userId);
    const memberHeaders = bearer(refreshedMember.body.data!.tokens.accessToken);
    const otherHeaders = bearer(other.accessToken);

    const adminLogin = await requestJson<{
      tokens: { accessToken: string };
      user: { role: string };
    }>(api.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "db-only-admin@example.com",
        password: "db-only-admin-pass",
      },
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.body.data?.user.role, "admin");
    const adminHeaders = bearer(adminLogin.body.data!.tokens.accessToken);
    await assertLegacyStoresMissing(context.rootDir);

    const sourceFile = await registerAndUploadFile(api.baseUrl, refreshedMember.body.data!.tokens.accessToken, {
      originalName: "db-only-source.png",
      displayName: "DB Only Source",
      sourceType: "input",
    });
    const sourceDownload = await requestBuffer(api.baseUrl, `/api/v1/files/${sourceFile.fileId}/download`, {
      headers: memberHeaders,
    });
    assert.equal(sourceDownload.status, 200);
    assert.equal(Buffer.compare(sourceDownload.buffer, sourceFile.content), 0);

    const forbiddenDownload = await requestBuffer(api.baseUrl, `/api/v1/files/${sourceFile.fileId}/download`, {
      headers: otherHeaders,
    });
    assert.equal(forbiddenDownload.status, 403);
    await assertLegacyStoresMissing(context.rootDir);

    const sourceBlob = await context.pool.query<{ blob_id: string }>(
      "select blob_id::text from file_assets where id = $1::uuid",
      [sourceFile.fileId],
    );
    const intermediateCache = new DbIntermediateArtifactRepository(context.databaseConfig);
    const intermediateReservation = await intermediateCache.findOrCreateProcessing({
      sourceBlobId: sourceBlob.rows[0]!.blob_id,
      artifactType: "lineart",
      provider: "db-only-test",
      model: "db-only-model",
      pipelineVersion: "db-only-pipeline",
      promptVersion: "db-only-prompt",
      imageSize: "1K",
      aspectRatio: "1:1",
    }, null);
    assert.equal(intermediateReservation.created, true);
    assert.equal(intermediateReservation.owner, true);
    const readyIntermediate = await intermediateCache.markReady({
      id: intermediateReservation.record.id,
      fileId: sourceFile.fileId,
      lastTaskId: null,
    });
    assert.equal(readyIntermediate.status, "ready");
    assert.equal((await intermediateCache.findByKey({
      sourceBlobId: sourceBlob.rows[0]!.blob_id,
      artifactType: "lineart",
      provider: "db-only-test",
      model: "db-only-model",
      pipelineVersion: "db-only-pipeline",
      promptVersion: "db-only-prompt",
    }))?.fileId, sourceFile.fileId);
    await assertLegacyStoresMissing(context.rootDir);

    const workflowId = "workflow-db-only-no-json";
    const workflowResponse = await requestJson<{ workflowId: string }>(
      api.baseUrl,
      "/api/v1/workflows",
      {
        method: "POST",
        headers: memberHeaders,
        payload: {
          id: workflowId,
          projectId: "project-db-only-no-json",
          name: "DB Only No JSON Workflow",
          nodes: {
            "source-node": {
              id: "source-node",
              type: "image",
              fileId: sourceFile.fileId,
            },
            "hd-node": {
              id: "hd-node",
              type: "aiImageHd",
              references: [
                {
                  id: "ref-source",
                  fileId: sourceFile.fileId,
                },
              ],
            },
          },
          connections: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          metadata: { source: "db-only-no-json-store" },
          timestamp: 1770000600000,
        },
      },
    );
    assert.equal(workflowResponse.status, 201);
    assert.equal(workflowResponse.body.data?.workflowId, workflowId);

    const loadedWorkflow = await requestJson<{
      workflowId: string;
      workflow: {
        nodes: Record<string, Record<string, unknown>>;
      };
    }>(api.baseUrl, `/api/v1/workflows/${workflowId}`, {
      headers: memberHeaders,
    });
    assert.equal(loadedWorkflow.status, 200);
    assert.equal(loadedWorkflow.body.data?.workflow.nodes["source-node"]?.fileId, sourceFile.fileId);
    assert.equal(
      loadedWorkflow.body.data?.workflow.nodes["source-node"]?.previewUrl,
      `/api/v1/files/${sourceFile.fileId}/preview`,
    );
    await assertLegacyStoresMissing(context.rootDir);

    const executionResponse = await requestJson<{
      runId: string;
      tasks: Array<{ taskId: string; status: string }>;
    }>(api.baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: memberHeaders,
      payload: {
        workflowId,
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "hd-node",
        nodeTitle: "HD Node",
        groups: [
          {
            groupId: "group-db-only",
            sourceFileId: sourceFile.fileId,
            imageSize: "1K",
            aspectRatio: "1:1",
          },
        ],
      },
    });
    assert.equal(executionResponse.status, 201);
    assert.equal(executionResponse.body.data?.tasks[0]?.status, "queued");
    const runId = executionResponse.body.data!.runId;
    const taskId = executionResponse.body.data!.tasks[0]!.taskId;

    const executionsRepository = new DbExecutionsRepository(context.databaseConfig);
    const filesRepository = new DbFilesRepository(context.databaseConfig, { rootDir: context.rootDir });
    const storageService = new StorageService(new LocalStorageAdapter(context.rootDir));
    const outputExecutor = new DbOnlyOutputExecutor(
      executionsRepository,
      new WorkerFileAssetService(filesRepository),
      storageService,
    );
    const worker = createWorkerDependencies({
      env: createDbTestEnv(context, "worker"),
      rootDir: context.rootDir,
      overrides: {
        queueTaskExecutor: outputExecutor as unknown as QueueTaskExecutorRegistry,
      },
    });
    const pollResult = await worker.queueService.pollOnce();
    assert.equal(pollResult.claimedCount, 1);

    const runDetail = await requestJson<{
      runId: string;
      status: string;
      tasks: Array<{
        taskId: string;
        status: string;
        resultFileId: string | null;
        resultFile: { fileId: string; sourceType: string; downloadUrl?: string } | null;
      }>;
    }>(api.baseUrl, `/api/v1/executions/${runId}`, {
      headers: memberHeaders,
    });
    assert.equal(runDetail.status, 200);
    assert.equal(runDetail.body.data?.runId, runId);
    assert.equal(runDetail.body.data?.status, "completed");
    assert.equal(runDetail.body.data?.tasks[0]?.taskId, taskId);
    assert.equal(runDetail.body.data?.tasks[0]?.status, "completed");
    assert.equal(runDetail.body.data?.tasks[0]?.resultFile?.sourceType, "output");
    assert.ok(runDetail.body.data?.tasks[0]?.resultFile?.downloadUrl);
    const outputFileId = runDetail.body.data!.tasks[0]!.resultFileId!;

    const outputDownload = await requestBuffer(api.baseUrl, `/api/v1/files/${outputFileId}/download`, {
      headers: memberHeaders,
    });
    assert.equal(outputDownload.status, 200);
    assert.match(outputDownload.buffer.toString("binary"), /^db-only-no-json-output:/u);

    const taskHistory = await requestJson<{
      items: Array<{ taskId: string; resultFileId: string | null }>;
      total: number;
    }>(api.baseUrl, `/api/v1/workflows/${workflowId}/tasks`, {
      headers: memberHeaders,
    });
    assert.equal(taskHistory.status, 200);
    assert.equal(taskHistory.body.data?.total, 1);
    assert.equal(taskHistory.body.data?.items[0]?.taskId, taskId);
    assert.equal(taskHistory.body.data?.items[0]?.resultFileId, outputFileId);
    await assertLegacyStoresMissing(context.rootDir);

    const memberAdminOverview = await requestJson(api.baseUrl, "/api/v1/admin/overview", {
      headers: memberHeaders,
    });
    assert.equal(memberAdminOverview.status, 403);

    const overview = await requestJson<{
      files: { total: number; ready: number };
      workflows: { total: number };
      executions: { totalRuns: number };
      users: { admins: number; members: number };
      storage: { issueCount: number };
    }>(api.baseUrl, "/api/v1/admin/overview", {
      headers: adminHeaders,
    });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data?.files.total, 2);
    assert.equal(overview.body.data?.files.ready, 2);
    assert.equal(overview.body.data?.workflows.total, 1);
    assert.equal(overview.body.data?.executions.totalRuns, 1);
    assert.equal(overview.body.data?.users.admins, 1);
    assert.equal(overview.body.data?.users.members, 2);
    assert.equal(overview.body.data?.storage.issueCount, 0);

    const fileUsage = await requestJson<{
      file: { fileId: string };
      workflows: Array<{ workflowId: string; role: string }>;
      tasks: Array<{ taskId: string; role: string }>;
    }>(api.baseUrl, `/api/v1/admin/files/${sourceFile.fileId}`, {
      headers: adminHeaders,
    });
    assert.equal(fileUsage.status, 200);
    assert.equal(fileUsage.body.data?.file.fileId, sourceFile.fileId);
    assert.ok(fileUsage.body.data?.workflows.some((item) => item.workflowId === workflowId));
    assert.ok(fileUsage.body.data?.tasks.some((item) => item.taskId === taskId && item.role === "input"));

    const executionDetail = await requestJson<{
      runId: string;
      inputFiles: Array<{ fileId: string }>;
      outputFiles: Array<{ fileId: string }>;
    }>(api.baseUrl, `/api/v1/admin/executions/${runId}`, {
      headers: adminHeaders,
    });
    assert.equal(executionDetail.status, 200);
    assert.equal(executionDetail.body.data?.runId, runId);
    assert.ok(executionDetail.body.data?.inputFiles.some((file) => file.fileId === sourceFile.fileId));
    assert.ok(executionDetail.body.data?.outputFiles.some((file) => file.fileId === outputFileId));

    const workflowDetail = await requestJson<{
      workflowId: string;
      files: Array<{ fileId: string }>;
      tasks: Array<{ taskId: string; resultFileId: string | null }>;
    }>(api.baseUrl, `/api/v1/admin/workflows/${workflowId}`, {
      headers: adminHeaders,
    });
    assert.equal(workflowDetail.status, 200);
    assert.equal(workflowDetail.body.data?.workflowId, workflowId);
    assert.ok(workflowDetail.body.data?.files.some((file) => file.fileId === sourceFile.fileId));
    assert.ok(workflowDetail.body.data?.tasks.some((task) =>
      task.taskId === taskId && task.resultFileId === outputFileId));

    const users = await requestJson<{
      items: Array<{ userId: string; role: string }>;
      total: number;
    }>(api.baseUrl, "/api/v1/admin/read/users?page=1&pageSize=10", {
      headers: adminHeaders,
    });
    assert.equal(users.status, 200);
    assert.equal(users.body.data?.total, 3);
    assert.ok(users.body.data?.items.some((user) => user.userId === admin.userId && user.role === "admin"));
    assert.ok(users.body.data?.items.some((user) => user.userId === member.userId && user.role === "member"));
    assert.ok(users.body.data?.items.some((user) => user.userId === other.userId && user.role === "member"));

    const dbCounts = await context.pool.query<{
      users: number;
      refresh_tokens: number;
      audit_logs: number;
      file_assets: number;
      file_blobs: number;
      workflows: number;
      workflow_bindings: number;
      runs: number;
      tasks: number;
      task_events: number;
      task_file_links: number;
      output_assets: number;
      intermediate_artifacts: number;
    }>(
      `
        select
          (select count(*)::int from users) as users,
          (select count(*)::int from refresh_tokens) as refresh_tokens,
          (select count(*)::int from audit_logs) as audit_logs,
          (select count(*)::int from file_assets) as file_assets,
          (select count(*)::int from file_blobs) as file_blobs,
          (select count(*)::int from workflows) as workflows,
          (select count(*)::int from workflow_file_bindings where workflow_id = $1) as workflow_bindings,
          (select count(*)::int from execution_runs) as runs,
          (select count(*)::int from execution_tasks) as tasks,
          (select count(*)::int from task_events) as task_events,
          (select count(*)::int from task_file_links) as task_file_links,
          (select count(*)::int from file_assets where source_type = 'output') as output_assets,
          (select count(*)::int from intermediate_artifacts where status = 'ready') as intermediate_artifacts
      `,
      [workflowId],
    );
    assert.equal(dbCounts.rows[0]?.users, 3);
    assert.ok((dbCounts.rows[0]?.refresh_tokens ?? 0) >= 5);
    assert.ok((dbCounts.rows[0]?.audit_logs ?? 0) >= 8);
    assert.equal(dbCounts.rows[0]?.file_assets, 2);
    assert.equal(dbCounts.rows[0]?.file_blobs, 2);
    assert.equal(dbCounts.rows[0]?.workflows, 1);
    assert.equal(dbCounts.rows[0]?.workflow_bindings, 2);
    assert.equal(dbCounts.rows[0]?.runs, 1);
    assert.equal(dbCounts.rows[0]?.tasks, 1);
    assert.ok((dbCounts.rows[0]?.task_events ?? 0) >= 5);
    assert.equal(dbCounts.rows[0]?.task_file_links, 2);
    assert.equal(dbCounts.rows[0]?.output_assets, 1);
    assert.equal(dbCounts.rows[0]?.intermediate_artifacts, 1);

    await assertLegacyStoresMissing(context.rootDir);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
