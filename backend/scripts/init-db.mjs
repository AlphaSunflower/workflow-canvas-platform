import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFilePath);
const backendRoot = path.resolve(scriptDir, "..");
const requireFromBackend = createRequire(path.join(backendRoot, "package.json"));

const migrationFiles = [
  "001_init.sql",
  "002_intermediate_artifacts.sql",
  "003_file_database_platform.sql",
  "004_production_hardening.sql",
];

const requiredTables = [
  "users",
  "refresh_tokens",
  "audit_logs",
  "file_blobs",
  "file_assets",
  "file_uploads",
  "file_blob_variants",
  "file_events",
  "storage_objects",
  "workflow_groups",
  "workflows",
  "workflow_file_bindings",
  "execution_runs",
  "execution_tasks",
  "task_events",
  "task_file_links",
  "provider_call_logs",
  "provider_concurrency_leases",
  "intermediate_artifacts",
  "legacy_migration_runs",
];

function hasFlag(name) {
  return process.argv.includes(name);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }

  return value;
}

function loadPg() {
  try {
    return requireFromBackend("pg");
  } catch {
    return requireFromBackend(path.join(backendRoot, "api", "node_modules", "pg"));
  }
}

function resolveDatabaseUrl() {
  const explicitUrl = readOption("--database-url");
  if (explicitUrl) {
    return explicitUrl;
  }

  if (hasFlag("--test")) {
    const testUrl = process.env.BACKEND_TEST_DATABASE_URL?.trim();
    if (!testUrl) {
      throw new Error("BACKEND_TEST_DATABASE_URL_REQUIRED: set BACKEND_TEST_DATABASE_URL or pass --database-url.");
    }
    return testUrl;
  }

  const developmentUrl =
    process.env.DATABASE_URL?.trim()
    || process.env.BACKEND_DATABASE_URL?.trim();

  if (!developmentUrl) {
    throw new Error("DATABASE_URL_REQUIRED: set DATABASE_URL/BACKEND_DATABASE_URL or pass --database-url.");
  }

  return developmentUrl;
}

function readMigrationSql(fileName) {
  const migrationPath = path.join(backendRoot, "db", "migrations", fileName);
  return fs.readFileSync(migrationPath, "utf8");
}

async function checkRequiredTables(client) {
  const result = await client.query(
    `
      select table_name
      from unnest($1::text[]) as required(table_name)
      where to_regclass(format('%I', table_name)) is null
      order by table_name
    `,
    [requiredTables],
  );

  return result.rows.map((row) => row.table_name);
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  const { Pool } = loadPg();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
    statement_timeout: 30000,
    ssl: hasFlag("--ssl") ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();

  try {
    console.log("[init-db] connected.");
    for (const migrationFile of migrationFiles) {
      console.log(`[init-db] applying ${migrationFile}`);
      await client.query(readMigrationSql(migrationFile));
    }

    const missingTables = await checkRequiredTables(client);
    if (missingTables.length > 0) {
      throw new Error(`DATABASE_SCHEMA_NOT_READY: missing tables ${missingTables.join(", ")}`);
    }

    console.log("[init-db] schema ready.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[init-db] failed: ${message}`);
  process.exit(1);
});
