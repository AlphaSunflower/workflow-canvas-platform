import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import type {
  DatabaseConfig,
  DatabaseHealth,
  PersistenceMode,
} from "./db-config.ts";
import {
  checkDatabaseSchemaHealth,
  createDatabaseSchemaErrorHealth,
} from "./schema-health.ts";

export interface QueryResultRow {
  [column: string]: unknown;
}

export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
  command: string;
  rowCount: number | null;
  rows: T[];
}

export interface DatabaseClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  release(): void;
}

export interface DatabasePool {
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

interface PoolConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
  ssl?: { rejectUnauthorized: false };
}

interface PgModule {
  Pool: new (config: PoolConfig) => DatabasePool;
}

const pools = new Map<string, Promise<DatabasePool>>();

function resolveBackendRoot(): string {
  const currentDir = typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));

  return path.resolve(currentDir, "../../..");
}

function requirePgFrom(basePath: string): PgModule | null {
  try {
    const requireFrom = createRequire(basePath);
    const loaded = requireFrom("pg") as unknown;

    if (
      loaded
      && typeof loaded === "object"
      && "Pool" in loaded
      && typeof (loaded as { Pool?: unknown }).Pool === "function"
    ) {
      return loaded as PgModule;
    }

    return null;
  } catch {
    return null;
  }
}

async function loadPg(): Promise<PgModule> {
  const backendRoot = resolveBackendRoot();
  const packagePaths = [
    path.join(backendRoot, "package.json"),
    path.join(backendRoot, "shared", "package.json"),
    path.join(backendRoot, "api", "package.json"),
    path.join(backendRoot, "worker", "package.json"),
    path.join(process.cwd(), "package.json"),
    import.meta.url,
  ];

  for (const packagePath of packagePaths) {
    const loaded = requirePgFrom(packagePath);

    if (loaded) {
      return loaded;
    }
  }

  throw new Error(
    "PG_DRIVER_NOT_INSTALLED: install the pg package before using database mode.",
  );
}

function buildPoolConfig(config: DatabaseConfig): PoolConfig {
  const baseConfig = config.url
    ? { connectionString: config.url }
    : {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password ?? undefined,
      };

  return {
    ...baseConfig,
    max: config.maxPoolSize,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  };
}

function getPoolKey(config: DatabaseConfig): string {
  return JSON.stringify({
    url: config.url,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    ssl: config.ssl,
    maxPoolSize: config.maxPoolSize,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    statementTimeoutMillis: config.statementTimeoutMillis,
  });
}

export async function createPostgresPool(config: DatabaseConfig): Promise<DatabasePool> {
  const pg = await loadPg();
  return new pg.Pool(buildPoolConfig(config));
}

export async function getPostgresPool(config: DatabaseConfig): Promise<DatabasePool> {
  const key = getPoolKey(config);
  const existingPool = pools.get(key);

  if (existingPool) {
    return existingPool;
  }

  const pool = createPostgresPool(config);
  pools.set(key, pool);
  return pool;
}

export async function closePostgresPool(config: DatabaseConfig): Promise<void> {
  const key = getPoolKey(config);
  const pool = pools.get(key);

  if (!pool) {
    return;
  }

  pools.delete(key);
  await (await pool).end();
}

export async function closeAllPostgresPools(): Promise<void> {
  const openPools = Array.from(pools.values());
  pools.clear();
  await Promise.all(openPools.map(async (pool) => (await pool).end()));
}

export async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  config: DatabaseConfig,
  text: string,
  values?: readonly unknown[],
): Promise<QueryResult<T>> {
  return (await getPostgresPool(config)).query<T>(text, values);
}

async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMillis: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`DB_HEALTHCHECK_TIMEOUT:${timeoutMillis}`));
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

export async function checkPostgresHealth(
  mode: PersistenceMode,
  config: DatabaseConfig,
): Promise<DatabaseHealth> {
  const checkedAt = new Date().toISOString();

  if (mode !== "db") {
    return {
      enabled: false,
      status: "disabled",
      mode,
      latencyMs: null,
      checkedAt,
      schema: await checkDatabaseSchemaHealth(mode, config),
      errorMessage: null,
    };
  }

  const startedAt = performance.now();

  try {
    await runWithTimeout(
      queryPostgres(config, "select 1 as ok"),
      config.healthcheckTimeoutMillis,
    );

    const schema = await checkDatabaseSchemaHealth(mode, config);

    return {
      enabled: true,
      status: schema.status === "ok" ? "ok" : "error",
      mode,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt,
      schema,
      errorMessage: schema.errorMessage,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      enabled: true,
      status: "error",
      mode,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt,
      schema: createDatabaseSchemaErrorHealth(errorMessage, checkedAt),
      errorMessage,
    };
  }
}
