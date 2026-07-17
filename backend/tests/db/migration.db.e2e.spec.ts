import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applySqlFile,
  cleanupDbE2EContext,
  createDbE2EContext,
  writeJsonFile,
} from "./bootstrap-db.ts";

interface MigrationReport {
  mode: string;
  counts: Record<string, number>;
  errors: Array<{ type: string }>;
  warnings: Array<{ type: string }>;
}

interface VerificationReport {
  status: "pass" | "fail";
  counts: Record<string, { expected: number; actual: number; pass: boolean }>;
  countMismatches: Array<{ type: string }>;
  missingFileReferences: Array<{ type: string; id: string }>;
  storageSamples: {
    checked: number;
    missing: unknown[];
  };
}

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const auditLogId = "33333333-3333-4333-8333-333333333333";
const blobId = "44444444-4444-4444-8444-444444444444";
const fileId = "55555555-5555-4555-8555-555555555555";
const workflowId = "66666666-6666-4666-8666-666666666666";
const bindingId = "77777777-7777-4777-8777-777777777777";
const runId = "88888888-8888-4888-8888-888888888888";
const taskId = "99999999-9999-4999-8999-999999999999";
const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const content = Buffer.from("migration-db-e2e-content");
const sha256 = createHash("sha256").update(content).digest("hex");
const storageKey = `blobs/${sha256.slice(0, 2)}/${sha256}.png`;

async function createLegacySourceRoot(rootDir: string): Promise<void> {
  await fs.mkdir(path.join(rootDir, "storage", "blobs", sha256.slice(0, 2)), { recursive: true });
  await fs.writeFile(path.join(rootDir, "storage", storageKey), content);

  await writeJsonFile(path.join(rootDir, "data", "files", "files-store.json"), {
    blobs: [
      {
        id: blobId,
        sha256,
        size: content.length,
        mimeType: "image/png",
        storageKey,
        storageProvider: "local",
        extension: "png",
        width: 2,
        height: 3,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    files: [
      {
        id: fileId,
        userId,
        blobId,
        originalName: "legacy-migration.png",
        displayName: "legacy-migration.png",
        mimeType: "image/png",
        fileType: "image",
        sourceType: "input",
        status: "ready",
        sha256,
        size: content.length,
        extension: "png",
        width: 2,
        height: 3,
        previewReady: false,
        thumbnailReady: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    pendingUploads: [],
  });
  await writeJsonFile(path.join(rootDir, "data", "storage-index.json"), {
    files: [
      {
        blobId,
        fileType: "image",
        sourceType: "input",
        originalName: "legacy-migration.png",
        mimeType: "image/png",
        sha256,
        size: content.length,
        extension: "png",
        width: 2,
        height: 3,
        storageProvider: "local",
        storageKey,
        absolutePath: path.join(rootDir, "storage", storageKey),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeJsonFile(path.join(rootDir, "data", "accounts-store.json"), {
    users: [
      {
        id: userId,
        email: "legacy-db-e2e@example.com",
        passwordHash: "scrypt:test",
        displayName: "Legacy DB E2E",
        role: "member",
        status: "enabled",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    sessions: [
      {
        id: sessionId,
        userId,
        tokenHash: "legacy-token-hash",
        status: "active",
        issuedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-02-01T00:00:00.000Z",
      },
    ],
    auditLogs: [
      {
        id: auditLogId,
        actorUserId: userId,
        actorRole: "member",
        action: "legacy_action",
        targetType: "file",
        targetId: fileId,
        payload: {
          source: "migration-db-e2e",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeJsonFile(path.join(rootDir, "data", "workflows", "index.json"), {
    items: [
      {
        workflowId,
        ownerUserId: userId,
        projectId: "project-legacy",
        name: "Legacy DB E2E Workflow",
        nodeCount: 1,
        connectionCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeJsonFile(path.join(rootDir, "data", "workflows", "groups-index.json"), {
    items: [],
  });
  await writeJsonFile(path.join(rootDir, "data", "workflows", workflowId, "workflow.json"), {
    workflowId,
    ownerUserId: userId,
    groupId: null,
    containerKey: "__ungrouped__",
    isAutoNamed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    workflow: {
      id: workflowId,
      projectId: "project-legacy",
      name: "Legacy DB E2E Workflow",
      nodes: {
        "file-node": {
          id: "file-node",
          type: "image",
          fileId,
        },
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {},
      timestamp: 1767225600000,
      version: 1,
    },
  });
  await writeJsonFile(path.join(rootDir, "data", "workflows", workflowId, "files.json"), {
    items: [
      {
        bindingId,
        ownerUserId: userId,
        nodeId: "file-node",
        fileId,
        role: "file-node",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeJsonFile(path.join(rootDir, "data", "executions-store.json"), {
    runs: [
      {
        id: runId,
        runNo: "RUN-20260101-000001",
        userId,
        workflowId,
        projectId: "project-legacy",
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "hd-node",
        nodeTitle: "Legacy HD",
        provider: "legacy",
        status: "completed",
        totalTaskCount: 1,
        completedTaskCount: 1,
        failedTaskCount: 0,
        requestPayload: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.500Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      },
    ],
    tasks: [
      {
        id: taskId,
        taskNo: "TASK-20260101-000001",
        runId,
        userId,
        workflowId,
        projectId: "project-legacy",
        nodeType: "aiImageHd",
        nodeId: "hd-node",
        nodeTitle: "Legacy HD",
        taskType: "image-hd",
        groupId: "group-1",
        groupOrder: 1,
        provider: "legacy",
        model: "legacy-model",
        input: {
          sourceFileId: fileId,
        },
        status: "completed",
        currentStep: "final",
        currentAttemptNo: 1,
        retryCount: 0,
        maxRetries: 2,
        resultFileId: fileId,
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.500Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      },
    ],
    events: [
      {
        id: eventId,
        runId,
        taskId,
        workflowId,
        attemptNo: 1,
        eventType: "task_completed",
        status: "completed",
        phase: "completed",
        stepType: "final",
        progress: 100,
        message: "legacy completed",
        payload: {},
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ],
  });
}

function runNodeScript(
  scriptPath: string,
  args: string[],
  cwd: string,
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("migration");
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "migration-db-e2e-source-"));
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-db-e2e-output-"));
  const verifyOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-db-e2e-verify-"));

  try {
    await createLegacySourceRoot(sourceRoot);

    const migrateScript = path.join(context.sourceRoot, "scripts", "migrate-json-store-to-db.mjs");
    const migrateRun = runNodeScript(migrateScript, [
      "--source-root",
      sourceRoot,
      "--output-dir",
      outputDir,
      "--label",
      "migration-db-e2e",
    ], context.sourceRoot);
    assert.equal(migrateRun.status, 0, String(migrateRun.stderr));

    const migrationReport = await readJson<MigrationReport>(path.join(outputDir, "report.json"));
    assert.equal(migrationReport.mode, "dry-run");
    assert.equal(migrationReport.errors.length, 0);
    assert.equal(migrationReport.warnings.length, 0);
    assert.equal(migrationReport.counts.fileBlobs, 1);
    assert.equal(migrationReport.counts.fileAssets, 1);
    assert.equal(migrationReport.counts.workflows, 1);
    assert.equal(migrationReport.counts.workflowFileBindings, 1);
    assert.equal(migrationReport.counts.executionRuns, 1);
    assert.equal(migrationReport.counts.executionTasks, 1);
    assert.equal(migrationReport.counts.taskEvents, 1);
    assert.equal(migrationReport.counts.users, 1);
    assert.equal(migrationReport.counts.refreshTokens, 1);
    assert.equal(migrationReport.counts.auditLogs, 1);

    await applySqlFile(context, path.join(outputDir, "migration.sql"));
    await applySqlFile(context, path.join(outputDir, "migration.sql"));

    const importedCounts = await context.pool.query<{
      file_blobs: number;
      file_assets: number;
      workflows: number;
      workflow_file_bindings: number;
      execution_runs: number;
      execution_tasks: number;
      task_events: number;
      users: number;
      refresh_tokens: number;
      audit_logs: number;
    }>(
      `
        select
          (select count(*)::int from file_blobs) as file_blobs,
          (select count(*)::int from file_assets) as file_assets,
          (select count(*)::int from workflows) as workflows,
          (select count(*)::int from workflow_file_bindings) as workflow_file_bindings,
          (select count(*)::int from execution_runs) as execution_runs,
          (select count(*)::int from execution_tasks) as execution_tasks,
          (select count(*)::int from task_events) as task_events,
          (select count(*)::int from users) as users,
          (select count(*)::int from refresh_tokens) as refresh_tokens,
          (select count(*)::int from audit_logs) as audit_logs
      `,
    );
    assert.deepEqual(importedCounts.rows[0], {
      file_blobs: 1,
      file_assets: 1,
      workflows: 1,
      workflow_file_bindings: 1,
      execution_runs: 1,
      execution_tasks: 1,
      task_events: 1,
      users: 1,
      refresh_tokens: 1,
      audit_logs: 1,
    });

    const verifyScript = path.join(context.sourceRoot, "scripts", "verify-json-store-db-migration.mjs");
    const verifyRun = runNodeScript(verifyScript, [
      "--source-root",
      sourceRoot,
      "--output-dir",
      verifyOutputDir,
      "--label",
      "migration-db-e2e",
      "--database-url",
      context.databaseUrl,
      "--sample-size",
      "1",
    ], context.sourceRoot);
    assert.equal(verifyRun.status, 0, String(verifyRun.stderr));

    const verificationReport = await readJson<VerificationReport>(
      path.join(verifyOutputDir, "verification-report.json"),
    );
    assert.equal(verificationReport.status, "pass");
    assert.equal(verificationReport.counts.fileBlobs.pass, true);
    assert.equal(verificationReport.counts.fileAssets.pass, true);
    assert.equal(verificationReport.counts.workflows.pass, true);
    assert.equal(verificationReport.counts.workflowFileBindings.pass, true);
    assert.equal(verificationReport.counts.executionRuns.pass, true);
    assert.equal(verificationReport.counts.executionTasks.pass, true);
    assert.equal(verificationReport.counts.users.pass, true);
    assert.deepEqual(verificationReport.countMismatches, []);
    assert.deepEqual(verificationReport.missingFileReferences, []);
    assert.equal(verificationReport.storageSamples.checked, 1);
    assert.deepEqual(verificationReport.storageSamples.missing, []);
  } finally {
    await fs.rm(sourceRoot, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(verifyOutputDir, { recursive: true, force: true });
    await cleanupDbE2EContext(context);
  }
}

await run();
