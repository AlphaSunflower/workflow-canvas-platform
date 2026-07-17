import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface MigrationReport {
  migrationId: string;
  label: string;
  mode: string;
  counts: Record<string, number>;
  warnings: Array<{ type: string; [key: string]: unknown }>;
  errors: Array<{ type: string; [key: string]: unknown }>;
  files: Record<string, string | null>;
}

function resolveBackendRoot(): string {
  let currentDir = process.cwd();

  while (true) {
    const scriptCandidate = path.join(currentDir, "scripts", "migrate-json-store-to-db.mjs");
    if (existsSync(scriptCandidate)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("BACKEND_ROOT_NOT_FOUND");
    }

    currentDir = parentDir;
  }
}

const backendRoot = resolveBackendRoot();
const scriptPath = path.join(backendRoot, "scripts", "migrate-json-store-to-db.mjs");
const userId = "11111111-1111-4111-8111-111111111111";
const blobId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const uploadId = "44444444-4444-4444-8444-444444444444";
const workflowId = "55555555-5555-4555-8555-555555555555";
const runId = "66666666-6666-4666-8666-666666666666";
const taskId = "77777777-7777-4777-8777-777777777777";
const content = Buffer.from("legacy-image-content");
const sha256 = createHash("sha256").update(content).digest("hex");

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function createLegacyStore(rootDir: string): Promise<void> {
  const storageKey = `blobs/${sha256.slice(0, 2)}/${sha256}.png`;

  await fs.mkdir(path.join(rootDir, "storage", "blobs", sha256.slice(0, 2)), { recursive: true });
  await fs.writeFile(path.join(rootDir, "storage", storageKey), content);
  await writeJson(path.join(rootDir, "data", "files", "files-store.json"), {
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
        originalName: "legacy.png",
        displayName: "legacy.png",
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
    pendingUploads: [
      {
        uploadId,
        fileId,
        userId,
        sha256,
        size: content.length,
        mimeType: "image/png",
        originalName: "legacy.png",
        displayName: "legacy.png",
        fileType: "image",
        sourceType: "input",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeJson(path.join(rootDir, "data", "storage-index.json"), {
    files: [
      {
        blobId,
        fileType: "image",
        sourceType: "input",
        originalName: "legacy.png",
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
  await writeJson(path.join(rootDir, "data", "accounts-store.json"), {
    users: [
      {
        id: userId,
        email: "legacy@example.com",
        passwordHash: "scrypt:test",
        displayName: "Legacy User",
        role: "member",
        status: "enabled",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    sessions: [],
    auditLogs: [],
  });
  await writeJson(path.join(rootDir, "data", "workflows", "index.json"), {
    items: [
      {
        workflowId,
        ownerUserId: userId,
        name: "Legacy Workflow",
        projectId: "default",
        nodeCount: 1,
        connectionCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeJson(path.join(rootDir, "data", "workflows", "groups-index.json"), {
    items: [],
  });
  await writeJson(path.join(rootDir, "data", "workflows", workflowId, "workflow.json"), {
    ownerUserId: userId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    workflow: {
      id: workflowId,
      projectId: "default",
      name: "Legacy Workflow",
      version: 1,
      timestamp: 1767225600000,
      nodes: [],
      connections: [],
    },
  });
  await writeJson(path.join(rootDir, "data", "workflows", workflowId, "files.json"), {
    items: [
      {
        bindingId: "88888888-8888-4888-8888-888888888888",
        ownerUserId: userId,
        nodeId: "node-1",
        fileId,
        role: "file-node",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeJson(path.join(rootDir, "data", "executions-store.json"), {
    runs: [
      {
        id: runId,
        runNo: "RUN-20260101-000001",
        userId,
        workflowId,
        projectId: "default",
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        status: "completed",
        totalTaskCount: 1,
        completedTaskCount: 1,
        failedTaskCount: 0,
        requestPayload: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    tasks: [
      {
        id: taskId,
        taskNo: "TASK-20260101-000001",
        runId,
        userId,
        workflowId,
        projectId: "default",
        nodeType: "aiImageGen",
        taskType: "image-gen",
        groupId: "group-1",
        groupOrder: 0,
        provider: "legacy",
        model: "legacy-model",
        input: {
          fileIds: [fileId],
        },
        status: "completed",
        resultFileId: fileId,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    events: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        runId,
        taskId,
        workflowId,
        eventType: "task_completed",
        status: "completed",
        progress: 100,
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ],
  });
}

function runMigration(sourceRoot: string, outputDir: string, extraArgs: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      "--source-root",
      sourceRoot,
      "--output-dir",
      outputDir,
      "--label",
      "task07-test",
      ...extraArgs,
    ],
    {
      cwd: backendRoot,
      encoding: "utf8",
      shell: false,
    },
  );
}

async function readReport(outputDir: string): Promise<MigrationReport> {
  return JSON.parse(
    await fs.readFile(path.join(outputDir, "report.json"), "utf8"),
  ) as MigrationReport;
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-migration-source-"));
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-migration-output-"));

  try {
    await createLegacyStore(rootDir);

    const dryRun = runMigration(rootDir, outputDir);
    assert.equal(dryRun.status, 0, dryRun.stderr);

    const report = await readReport(outputDir);
    const sql = await fs.readFile(path.join(outputDir, "migration.sql"), "utf8");
    const generatedReadme = await fs.readFile(path.join(outputDir, "README.md"), "utf8");

    assert.equal(report.mode, "dry-run");
    assert.equal(report.errors.length, 0);
    assert.equal(report.warnings.length, 0);
    assert.equal(report.counts.fileBlobs, 1);
    assert.equal(report.counts.fileAssets, 1);
    assert.equal(report.counts.fileBlobVariants, 1);
    assert.equal(report.counts.fileUploads, 1);
    assert.equal(report.counts.storageObjects, 1);
    assert.equal(report.counts.users, 1);
    assert.equal(report.counts.workflows, 1);
    assert.equal(report.counts.workflowFileBindings, 1);
    assert.equal(report.counts.executionRuns, 1);
    assert.equal(report.counts.executionTasks, 1);
    assert.equal(report.counts.taskEvents, 1);
    assert.equal(report.counts.taskFileLinks, 2);
    assert.match(sql, /on conflict \("blob_id", "variant", "variant_key"\) do update set/u);
    assert.match(sql, /insert into "legacy_migration_runs"/u);
    assert.match(generatedReadme, /errors\.length === 0/u);

    const rerunOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-migration-rerun-"));
    const rerun = runMigration(rootDir, rerunOutputDir);
    assert.equal(rerun.status, 0, rerun.stderr);
    const rerunReport = await readReport(rerunOutputDir);
    assert.equal(rerunReport.migrationId, report.migrationId);

    const applySentinelPath = path.join(outputDir, "apply-called.txt");
    const fakePsqlPath = path.join(outputDir, "fake-psql.mjs");
    await fs.writeFile(
      fakePsqlPath,
      `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(applySentinelPath)}, process.argv.join("\\n"));\n`,
      "utf8",
    );
    const applyProbe = runMigration(rootDir, outputDir, [
      "--apply",
      "--psql",
      process.execPath,
      "--database-url",
      fakePsqlPath,
    ]);
    assert.equal(applyProbe.status, 0, applyProbe.stderr);
    assert.match(await fs.readFile(applySentinelPath, "utf8"), /ON_ERROR_STOP=1/u);

    await fs.rm(path.join(rootDir, "storage", `blobs/${sha256.slice(0, 2)}/${sha256}.png`), {
      force: true,
    });
    const missingOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-migration-missing-"));
    const missingRun = runMigration(rootDir, missingOutputDir);
    assert.equal(missingRun.status, 0, missingRun.stderr);
    const missingReport = await readReport(missingOutputDir);
    assert.equal(
      missingReport.warnings.some((warning) => warning.type === "storage_file_missing"),
      true,
    );

    const filesStorePath = path.join(rootDir, "data", "files", "files-store.json");
    const filesStore = JSON.parse(await fs.readFile(filesStorePath, "utf8")) as {
      blobs: Array<Record<string, unknown>>;
    };
    filesStore.blobs.push({
      ...filesStore.blobs[0],
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    await writeJson(filesStorePath, filesStore);

    const duplicateOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-migration-duplicate-"));
    const duplicateRun = runMigration(rootDir, duplicateOutputDir);
    assert.equal(duplicateRun.status, 0, duplicateRun.stderr);
    const duplicateReport = await readReport(duplicateOutputDir);
    assert.equal(
      duplicateReport.errors.some((error) => error.type === "duplicate_file_blob_sha256"),
      true,
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

void run();
