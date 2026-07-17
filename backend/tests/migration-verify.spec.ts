import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface VerificationReport {
  status: "pass" | "fail";
  counts: Record<string, { expected: number; actual: number; pass: boolean }>;
  countMismatches: Array<{ type: string; expected: number; actual: number }>;
  missingIds: Record<string, string[]>;
  missingFileReferences: Array<{ type: string; id: string }>;
  storageSamples: {
    checked: number;
    missing: Array<{ blobId: string; storageKey: string | null }>;
  };
}

function resolveBackendRoot(): string {
  let currentDir = process.cwd();

  while (true) {
    const scriptCandidate = path.join(currentDir, "scripts", "verify-json-store-db-migration.mjs");
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
const scriptPath = path.join(backendRoot, "scripts", "verify-json-store-db-migration.mjs");
const userId = "11111111-1111-4111-8111-111111111111";
const blobId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const auditLogId = "55555555-5555-4555-8555-555555555555";
const workflowId = "66666666-6666-4666-8666-666666666666";
const bindingId = "77777777-7777-4777-8777-777777777777";
const runId = "88888888-8888-4888-8888-888888888888";
const taskId = "99999999-9999-4999-8999-999999999999";
const content = Buffer.from("verify-storage-content");
const sha256 = createHash("sha256").update(content).digest("hex");
const storageKey = `blobs/${sha256.slice(0, 2)}/${sha256}.png`;

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function createSourceRoot(rootDir: string): Promise<void> {
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
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    files: [
      {
        id: fileId,
        userId,
        blobId,
        originalName: "verify.png",
        displayName: "verify.png",
        mimeType: "image/png",
        fileType: "image",
        sourceType: "input",
        status: "ready",
        sha256,
        size: content.length,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeJson(path.join(rootDir, "data", "accounts-store.json"), {
    users: [
      {
        id: userId,
        email: "verify@example.com",
        passwordHash: "scrypt:test",
        displayName: "Verify User",
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
        tokenHash: "token-hash",
        status: "active",
        issuedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-02-01T00:00:00.000Z",
      },
    ],
    auditLogs: [
      {
        id: auditLogId,
        actorUserId: userId,
        action: "verify",
        targetType: "file",
        targetId: fileId,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeJson(path.join(rootDir, "data", "workflows", "index.json"), {
    items: [
      {
        workflowId,
        ownerUserId: userId,
        name: "Verify Workflow",
      },
    ],
  });
  await writeJson(path.join(rootDir, "data", "workflows", workflowId, "workflow.json"), {
    ownerUserId: userId,
    workflow: {
      id: workflowId,
      name: "Verify Workflow",
    },
  });
  await writeJson(path.join(rootDir, "data", "workflows", workflowId, "files.json"), {
    items: [
      {
        bindingId,
        fileId,
        ownerUserId: userId,
        nodeId: "node-1",
        role: "file-node",
      },
    ],
  });
  await writeJson(path.join(rootDir, "data", "executions-store.json"), {
    runs: [
      {
        id: runId,
        runNo: "RUN-VERIFY",
        status: "completed",
        requestPayload: {},
      },
    ],
    tasks: [
      {
        id: taskId,
        taskNo: "TASK-VERIFY",
        runId,
        status: "completed",
      },
    ],
  });
}

async function createFakePgModule(modulePath: string): Promise<void> {
  await fs.writeFile(
    modulePath,
    `
const scenario = JSON.parse(process.env.MIGRATION_VERIFY_FAKE_PG_SCENARIO ?? "{}");
const data = scenario.data ?? {};
const tableByKey = {
  fileBlobs: "file_blobs",
  fileAssets: "file_assets",
  workflows: "workflows",
  workflowFileBindings: "workflow_file_bindings",
  executionRuns: "execution_runs",
  executionTasks: "execution_tasks",
  users: "users",
  refreshTokens: "refresh_tokens",
  auditLogs: "audit_logs",
};
const keyByTable = Object.fromEntries(Object.entries(tableByKey).map(([key, table]) => [table, key]));

function extractTable(sql) {
  const countMatch = sql.match(/from "([^"]+)"/);
  if (countMatch) return countMatch[1];
  const idMatch = sql.match(/from "([^"]+)" where id/);
  if (idMatch) return idMatch[1];
  return null;
}

export class Pool {
  async query(sql, values = []) {
    if (sql.includes("count(*)")) {
      const table = extractTable(sql);
      const key = keyByTable[table];
      return { rows: [{ count: (data[key] ?? []).length }] };
    }

    if (sql.includes("where id = any")) {
      const table = extractTable(sql);
      const key = keyByTable[table];
      const ids = new Set(data[key] ?? []);
      return { rows: (values[0] ?? []).filter((id) => ids.has(id)).map((id) => ({ id })) };
    }

    if (sql.includes("from workflow_file_bindings") && sql.includes("left join file_assets")) {
      return { rows: (scenario.missingFileReferences?.workflowFileBindings ?? []).map((id) => ({ id })) };
    }

    if (sql.includes("from execution_tasks") && sql.includes("left join file_assets")) {
      return { rows: (scenario.missingFileReferences?.executionTasks ?? []).map((id) => ({ id })) };
    }

    if (sql.includes("from task_file_links") && sql.includes("left join file_assets")) {
      return { rows: (scenario.missingFileReferences?.taskFileLinks ?? []).map((id) => ({ id })) };
    }

    if (sql.includes("from file_blobs") && sql.includes("storage_key")) {
      return {
        rows: (scenario.storageSamples ?? []).map((sample) => ({
          id: sample.id,
          storage_key: sample.storageKey,
        })),
      };
    }

    throw new Error("UNHANDLED_FAKE_PG_QUERY:" + sql.replace(/\\s+/g, " ").trim());
  }

  async end() {}
}
`,
    "utf8",
  );
}

function createMatchingScenario() {
  return {
    data: {
      fileBlobs: [blobId],
      fileAssets: [fileId],
      workflows: [workflowId],
      workflowFileBindings: [bindingId],
      executionRuns: [runId],
      executionTasks: [taskId],
      users: [userId],
      refreshTokens: [sessionId],
      auditLogs: [auditLogId],
    },
    missingFileReferences: {},
    storageSamples: [
      {
        id: blobId,
        storageKey,
      },
    ],
  };
}

function runVerification(input: {
  sourceRoot: string;
  outputDir: string;
  pgModulePath: string;
  scenario: unknown;
}) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      "--source-root",
      input.sourceRoot,
      "--output-dir",
      input.outputDir,
      "--label",
      "verify-test",
      "--database-url",
      "postgres://user:pass@localhost:5432/test",
      "--pg-module",
      input.pgModulePath,
      "--sample-size",
      "5",
    ],
    {
      cwd: backendRoot,
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        MIGRATION_VERIFY_FAKE_PG_SCENARIO: JSON.stringify(input.scenario),
      },
    },
  );
}

async function readReport(outputDir: string): Promise<VerificationReport> {
  return JSON.parse(
    await fs.readFile(path.join(outputDir, "verification-report.json"), "utf8"),
  ) as VerificationReport;
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-verify-source-"));
  const fakePgPath = path.join(rootDir, "fake-pg.mjs");

  try {
    await createSourceRoot(rootDir);
    await createFakePgModule(fakePgPath);

    const passOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-verify-pass-"));
    const passRun = runVerification({
      sourceRoot: rootDir,
      outputDir: passOutputDir,
      pgModulePath: fakePgPath,
      scenario: createMatchingScenario(),
    });
    assert.equal(passRun.status, 0, passRun.stderr);

    const passReport = await readReport(passOutputDir);
    assert.equal(passReport.status, "pass");
    assert.equal(passReport.counts.fileBlobs.pass, true);
    assert.equal(passReport.counts.fileAssets.pass, true);
    assert.equal(passReport.counts.workflows.pass, true);
    assert.equal(passReport.counts.executionRuns.pass, true);
    assert.equal(passReport.counts.users.pass, true);
    assert.equal(passReport.storageSamples.checked, 1);
    assert.deepEqual(passReport.storageSamples.missing, []);

    const failScenario = createMatchingScenario();
    failScenario.data.fileAssets = [];
    failScenario.missingFileReferences = {
      workflowFileBindings: [fileId],
    };
    failScenario.storageSamples = [
      {
        id: blobId,
        storageKey: "blobs/missing-file.png",
      },
    ];

    const failOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-verify-fail-"));
    const failRun = runVerification({
      sourceRoot: rootDir,
      outputDir: failOutputDir,
      pgModulePath: fakePgPath,
      scenario: failScenario,
    });
    assert.equal(failRun.status, 1);

    const failReport = await readReport(failOutputDir);
    assert.equal(failReport.status, "fail");
    assert.deepEqual(failReport.countMismatches.map((item) => item.type), ["fileAssets"]);
    assert.deepEqual(failReport.missingIds.fileAssets, [fileId]);
    assert.deepEqual(failReport.missingFileReferences, [
      {
        type: "workflow_file_bindings.file_id",
        id: fileId,
      },
    ]);
    assert.equal(failReport.storageSamples.missing[0]?.blobId, blobId);
    assert.equal(failReport.storageSamples.missing[0]?.storageKey, "blobs/missing-file.png");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
