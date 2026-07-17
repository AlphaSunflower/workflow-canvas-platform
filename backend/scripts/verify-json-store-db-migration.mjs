#!/usr/bin/env node
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const options = parseArgs(process.argv.slice(2));
const sourceRoot = path.resolve(options.sourceRoot ?? backendRoot);
const dataRoot = path.join(sourceRoot, "data");
const storageRoot = path.join(sourceRoot, "storage");
const label = sanitizeLabel(options.label ?? new Date().toISOString().replaceAll(":", "-"));
const outputDir = path.resolve(
  options.outputDir ?? path.join(backendRoot, ".tmp", "migrations", "json-store-db-verification", label),
);
const reportPath = path.join(outputDir, "verification-report.json");
const sampleSize = Math.max(0, Number.parseInt(String(options.sampleSize ?? 20), 10) || 0);

const verificationItems = [
  { key: "fileBlobs", table: "file_blobs", idKind: "uuid" },
  { key: "fileAssets", table: "file_assets", idKind: "uuid" },
  { key: "workflows", table: "workflows", idKind: "text" },
  { key: "workflowFileBindings", table: "workflow_file_bindings", idKind: "uuid" },
  { key: "executionRuns", table: "execution_runs", idKind: "uuid" },
  { key: "executionTasks", table: "execution_tasks", idKind: "uuid" },
  { key: "users", table: "users", idKind: "text" },
  { key: "refreshTokens", table: "refresh_tokens", idKind: "text" },
  { key: "auditLogs", table: "audit_logs", idKind: "text" },
];

const report = {
  label,
  sourceRoot,
  dataRoot,
  storageRoot,
  databaseTarget: redactDatabaseTarget(options.databaseUrl ?? process.env.DATABASE_URL ?? null),
  generatedAt: new Date().toISOString(),
  status: "fail",
  counts: {},
  countMismatches: [],
  missingIds: {},
  missingFileReferences: [],
  storageSamples: {
    requested: sampleSize,
    checked: 0,
    missing: [],
  },
  warnings: [],
  errors: [],
};

main().catch((error) => {
  report.errors.push({
    type: "verification_failed",
    message: error instanceof Error ? error.message : String(error),
  });
  writeReport();
  printSummary();
  process.exit(1);
});

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const expected = collectExpectedState();
  const pool = await createPool();

  try {
    await verifyCounts(pool, expected);
    await verifyMissingIds(pool, expected);
    await verifyMissingFileReferences(pool);
    await verifyStorageSamples(pool);
  } finally {
    await pool.end();
  }

  report.status = isReportPassing() ? "pass" : "fail";
  writeReport();
  printSummary();

  if (report.status !== "pass") {
    process.exit(1);
  }
}

function collectExpectedState() {
  const filesStorePath = firstExistingPath([
    path.join(dataRoot, "files", "files-store.json"),
    path.join(dataRoot, "files-store.json"),
  ]);
  const filesStore = readJsonOptional(filesStorePath, { blobs: [], files: [] });
  const accountsStore = readJsonOptional(path.join(dataRoot, "accounts-store.json"), {
    users: [],
    sessions: [],
    auditLogs: [],
  });
  const executionsStore = readJsonOptional(path.join(dataRoot, "executions-store.json"), {
    runs: [],
    tasks: [],
  });
  const workflows = collectWorkflowState();

  return {
    fileBlobs: collectIds(filesStore.blobs, "id"),
    fileAssets: collectIds(filesStore.files, "id"),
    workflows: workflows.workflowIds,
    workflowFileBindings: workflows.bindingIds,
    executionRuns: collectIds(executionsStore.runs, "id"),
    executionTasks: collectIds(executionsStore.tasks, "id"),
    users: collectIds(accountsStore.users, "id"),
    refreshTokens: collectIds(accountsStore.sessions, "id"),
    auditLogs: collectIds(accountsStore.auditLogs, "id"),
  };
}

function collectWorkflowState() {
  const workflowsDir = path.join(dataRoot, "workflows");
  const workflowIds = [];
  const bindingIds = [];

  if (!existsSync(workflowsDir)) {
    return { workflowIds, bindingIds };
  }

  for (const entryName of readdirSync(workflowsDir)) {
    const workflowDir = path.join(workflowsDir, entryName);
    if (!statSync(workflowDir).isDirectory() || !isUuid(entryName)) {
      continue;
    }

    const workflowPath = path.join(workflowDir, "workflow.json");
    if (!existsSync(workflowPath)) {
      continue;
    }

    workflowIds.push(entryName);

    const bindingStore = readJsonOptional(path.join(workflowDir, "files.json"), { items: [] });
    for (const binding of Array.isArray(bindingStore.items) ? bindingStore.items : []) {
      const bindingId = normalizeNonEmptyString(binding.bindingId ?? binding.id);
      if (bindingId) {
        bindingIds.push(bindingId);
      }
    }
  }

  return { workflowIds, bindingIds };
}

function collectIds(items, key) {
  if (!Array.isArray(items)) {
    return [];
  }

  const ids = [];
  for (const item of items) {
    const id = normalizeNonEmptyString(item?.[key]);
    if (id) {
      ids.push(id);
    }
  }

  return Array.from(new Set(ids));
}

async function verifyCounts(pool, expected) {
  for (const item of verificationItems) {
    const actual = await queryCount(pool, item.table);
    const expectedCount = expected[item.key].length;
    const passed = actual === expectedCount;

    report.counts[item.key] = {
      expected: expectedCount,
      actual,
      pass: passed,
    };

    if (!passed) {
      report.countMismatches.push({
        type: item.key,
        table: item.table,
        expected: expectedCount,
        actual,
      });
    }
  }
}

async function verifyMissingIds(pool, expected) {
  for (const item of verificationItems) {
    const expectedIds = expected[item.key];
    const actualIds = await queryExistingIds(pool, item.table, item.idKind, expectedIds);
    const actualIdSet = new Set(actualIds);
    const missing = expectedIds.filter((id) => !actualIdSet.has(id));

    report.missingIds[item.key] = missing;
  }
}

async function verifyMissingFileReferences(pool) {
  const checks = [
    {
      type: "workflow_file_bindings.file_id",
      sql: `
        select distinct workflow_file_bindings.file_id::text as id
        from workflow_file_bindings
        left join file_assets on file_assets.id = workflow_file_bindings.file_id
        where file_assets.id is null
        order by id
        limit 100
      `,
    },
    {
      type: "execution_tasks.result_file_id",
      sql: `
        select distinct execution_tasks.result_file_id::text as id
        from execution_tasks
        left join file_assets on file_assets.id = execution_tasks.result_file_id
        where execution_tasks.result_file_id is not null
          and file_assets.id is null
        order by id
        limit 100
      `,
    },
    {
      type: "task_file_links.file_id",
      sql: `
        select distinct task_file_links.file_id::text as id
        from task_file_links
        left join file_assets on file_assets.id = task_file_links.file_id
        where file_assets.id is null
        order by id
        limit 100
      `,
    },
  ];

  for (const check of checks) {
    const result = await pool.query(check.sql);
    for (const row of result.rows) {
      report.missingFileReferences.push({
        type: check.type,
        id: String(row.id),
      });
    }
  }
}

async function verifyStorageSamples(pool) {
  if (sampleSize === 0) {
    return;
  }

  const result = await pool.query(
    `
      select id::text as id, storage_key
      from file_blobs
      where storage_provider = 'local'
      order by created_at asc, id asc
      limit $1
    `,
    [sampleSize],
  );

  report.storageSamples.checked = result.rows.length;

  for (const row of result.rows) {
    const storageKey = normalizeNonEmptyString(row.storage_key);
    const blobId = normalizeNonEmptyString(row.id);
    if (!storageKey) {
      report.storageSamples.missing.push({
        blobId,
        storageKey: null,
        reason: "empty_storage_key",
      });
      continue;
    }

    const absolutePath = path.join(storageRoot, storageKey);
    if (!existsSync(absolutePath)) {
      report.storageSamples.missing.push({
        blobId,
        storageKey,
        absolutePath,
      });
    }
  }
}

async function queryCount(pool, table) {
  const result = await pool.query(`select count(*)::int as count from ${quoteIdent(table)}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function queryExistingIds(pool, table, idKind, expectedIds) {
  if (expectedIds.length === 0) {
    return [];
  }

  const cast = idKind === "uuid" ? "uuid[]" : "text[]";
  const result = await pool.query(
    `select id::text as id from ${quoteIdent(table)} where id = any($1::${cast})`,
    [expectedIds],
  );

  return result.rows.map((row) => String(row.id));
}

async function createPool() {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_REQUIRED: pass --database-url or set DATABASE_URL.");
  }

  const pg = await loadPgModule();
  return new pg.Pool({
    connectionString: databaseUrl,
  });
}

async function loadPgModule() {
  const modulePath = options.pgModule ?? process.env.VERIFY_JSON_STORE_DB_MIGRATION_PG_MODULE;

  if (modulePath) {
    return import(pathToFileURL(path.resolve(modulePath)).href);
  }

  const packagePaths = [
    path.join(backendRoot, "api", "package.json"),
    path.join(backendRoot, "shared", "package.json"),
    path.join(backendRoot, "worker", "package.json"),
    path.join(backendRoot, "package.json"),
    path.join(process.cwd(), "package.json"),
    import.meta.url,
  ];

  for (const packagePath of packagePaths) {
    try {
      const requireFrom = createRequire(packagePath);
      const loaded = requireFrom("pg");

      if (loaded?.Pool) {
        return loaded;
      }
    } catch {
      // Try the next package boundary.
    }
  }

  throw new Error("PG_DRIVER_NOT_INSTALLED: install pg before running migration verification.");
}

function isReportPassing() {
  return report.errors.length === 0
    && report.countMismatches.length === 0
    && Object.values(report.missingIds).every((ids) => ids.length === 0)
    && report.missingFileReferences.length === 0
    && report.storageSamples.missing.length === 0;
}

function writeReport() {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
}

function printSummary() {
  console.log(`Migration verification report: ${reportPath}`);
  console.log(`Status: ${report.status}`);
  console.log(`Count mismatches: ${report.countMismatches.length}`);
  console.log(`Missing id groups: ${
    Object.entries(report.missingIds)
      .filter(([, ids]) => ids.length > 0)
      .map(([key]) => key)
      .join(", ") || "none"
  }`);
  console.log(`Missing file references: ${report.missingFileReferences.length}`);
  console.log(`Missing storage samples: ${report.storageSamples.missing.length}`);
}

function readJsonOptional(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = readFileSync(filePath, "utf8").trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    report.errors.push({
      type: "json_read_failed",
      filePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

function firstExistingPath(candidates) {
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function quoteIdent(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function redactDatabaseTarget(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.password) {
      parsed.password = "***";
    }
    if (parsed.username) {
      parsed.username = "***";
    }
    return parsed.toString();
  } catch {
    return value.replace(/:\/\/([^:/?#]+):([^@/?#]+)@/u, "://***:***@");
  }
}

function sanitizeLabel(value) {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 120) || "verification";
}

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--source-root":
        parsed.sourceRoot = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--output-dir":
        parsed.outputDir = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--label":
        parsed.label = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--database-url":
        parsed.databaseUrl = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--sample-size":
        parsed.sampleSize = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--pg-module":
        parsed.pgModule = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return parsed;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${name}.`);
    process.exit(1);
  }

  return value;
}

function printHelp() {
  console.log(`Usage:
  node backend/scripts/verify-json-store-db-migration.mjs [options]

Options:
  --source-root <path>    Backend root containing data/ and storage/. Defaults to backend/.
  --output-dir <path>    Directory for verification-report.json.
  --label <label>        Output folder label.
  --database-url <url>   PostgreSQL connection URL. Defaults to DATABASE_URL.
  --sample-size <n>      Number of DB file_blobs to sample for storage lookup. Defaults to 20.
  --help                 Show this help.
`);
}
