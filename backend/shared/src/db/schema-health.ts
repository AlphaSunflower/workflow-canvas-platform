import { performance } from "node:perf_hooks";

import type {
  DatabaseConfig,
  DatabaseSchemaHealth,
  PersistenceMode,
} from "./db-config.ts";
import type {
  DatabasePool,
  QueryResultRow,
} from "./postgres-client.ts";
import { queryPostgres } from "./postgres-client.ts";

export const REQUIRED_SCHEMA_TABLES = [
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
] as const;

export type RequiredSchemaTable = typeof REQUIRED_SCHEMA_TABLES[number];

interface MissingTableRow extends QueryResultRow {
  table_name: string;
}

async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMillis: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`DB_SCHEMA_HEALTHCHECK_TIMEOUT:${timeoutMillis}`));
    }, timeoutMillis);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function createDisabledSchemaHealth(
  mode: PersistenceMode,
  checkedAt: string,
): DatabaseSchemaHealth {
  return {
    enabled: false,
    status: "disabled",
    requiredTables: [...REQUIRED_SCHEMA_TABLES],
    missingTables: [],
    latencyMs: null,
    checkedAt,
    errorMessage: mode === "db" ? null : "Database schema check disabled outside db mode.",
  };
}

function createSchemaSql(): string {
  return `
    select table_name
    from unnest($1::text[]) as required(table_name)
    where to_regclass(format('%I', table_name)) is null
    order by table_name
  `;
}

export async function findMissingSchemaTables(
  pool: DatabasePool,
  requiredTables: readonly string[] = REQUIRED_SCHEMA_TABLES,
): Promise<string[]> {
  const result = await pool.query<MissingTableRow>(
    createSchemaSql(),
    [[...requiredTables]],
  );

  return result.rows.map((row) => row.table_name);
}

export async function checkDatabaseSchemaHealth(
  mode: PersistenceMode,
  config: DatabaseConfig,
  requiredTables: readonly string[] = REQUIRED_SCHEMA_TABLES,
): Promise<DatabaseSchemaHealth> {
  const checkedAt = new Date().toISOString();

  if (mode !== "db") {
    return createDisabledSchemaHealth(mode, checkedAt);
  }

  const startedAt = performance.now();

  try {
    const result = await runWithTimeout(
      queryPostgres<MissingTableRow>(config, createSchemaSql(), [[...requiredTables]]),
      config.healthcheckTimeoutMillis,
    );
    const missingTables = result.rows.map((row) => row.table_name);

    return {
      enabled: true,
      status: missingTables.length > 0 ? "missing" : "ok",
      requiredTables: [...requiredTables],
      missingTables,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt,
      errorMessage: missingTables.length > 0
        ? `DATABASE_SCHEMA_NOT_READY: missing tables ${missingTables.join(", ")}`
        : null,
    };
  } catch (error) {
    return {
      enabled: true,
      status: "error",
      requiredTables: [...requiredTables],
      missingTables: [],
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createDatabaseSchemaErrorHealth(
  errorMessage: string,
  checkedAt = new Date().toISOString(),
  requiredTables: readonly string[] = REQUIRED_SCHEMA_TABLES,
): DatabaseSchemaHealth {
  return {
    enabled: true,
    status: "error",
    requiredTables: [...requiredTables],
    missingTables: [],
    latencyMs: null,
    checkedAt,
    errorMessage,
  };
}
