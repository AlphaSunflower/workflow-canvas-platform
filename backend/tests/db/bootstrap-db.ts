import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApiServer } from "../../api/src/composition/create-api-server.ts";
import type { ServiceEnv, ServiceName } from "../../shared/src/env.ts";
import type { DatabaseConfig } from "../../shared/src/db/db-config.ts";
import {
  closePostgresPool,
  createPostgresPool,
  type DatabasePool,
  type QueryResultRow,
} from "../../shared/src/db/postgres-client.ts";
import { findMissingSchemaTables } from "../../shared/src/db/schema-health.ts";

export interface ApiEnvelope<T> {
  code: number;
  message?: string;
  error?: string;
  data?: T;
  timestamp?: number;
}

export interface DbE2EContext {
  label: string;
  sourceRoot: string;
  rootDir: string;
  schemaName: string;
  baseDatabaseUrl: string;
  databaseUrl: string;
  databaseConfig: DatabaseConfig;
  pool: DatabasePool;
  basePool: DatabasePool;
}

export interface StartedDbApi {
  baseUrl: string;
  server: Server;
  env: ServiceEnv;
}

export interface RegisteredTestAccount {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export interface UploadedTestFile {
  fileId: string;
  sha256: string;
  content: Buffer;
  file: {
    fileId: string;
    blobId: string | null;
    status: string;
    downloadUrl?: string;
    previewUrl?: string;
    thumbnailUrl?: string;
  };
}

export const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAF0lEQVR4nGP8z8DAwMDAxMDA8J8BAM4FA/2wE8sAAAAASUVORK5CYII=",
  "base64",
);

const MIGRATION_FILES = [
  "001_init.sql",
  "002_intermediate_artifacts.sql",
  "003_file_database_platform.sql",
  "004_production_hardening.sql",
] as const;

export function resolveBackendSourceRoot(): string {
  const configured = process.env.BACKEND_TEST_SOURCE_ROOT?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  let currentDir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(path.join(currentDir, "db", "migrations", "001_init.sql"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("BACKEND_TEST_SOURCE_ROOT_NOT_FOUND");
    }

    currentDir = parentDir;
  }
}

export function getDbTestDatabaseUrl(): string {
  const databaseUrl = process.env.BACKEND_TEST_DATABASE_URL?.trim()
    || process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "DB_TEST_DATABASE_URL_REQUIRED: set BACKEND_TEST_DATABASE_URL before running npm run test:db.",
    );
  }

  return databaseUrl;
}

export async function createDbE2EContext(label: string): Promise<DbE2EContext> {
  const sourceRoot = resolveBackendSourceRoot();
  const baseDatabaseUrl = getDbTestDatabaseUrl();
  const safeLabel = sanitizeIdentifierPart(label);
  const schemaName = `nw_e2e_${safeLabel}_${process.pid}_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), `nw-db-e2e-${safeLabel}-`));
  const basePool = await createPostgresPool(createDatabaseConfig(baseDatabaseUrl));
  const databaseUrl = addSearchPathToDatabaseUrl(baseDatabaseUrl, schemaName);
  const databaseConfig = createDatabaseConfig(databaseUrl);
  let pool: DatabasePool | null = null;

  try {
    await basePool.query("create extension if not exists pgcrypto with schema public");
    await basePool.query(`create schema ${quoteIdent(schemaName)}`);
    pool = await createPostgresPool(databaseConfig);
    await applySchemaMigrations(pool, sourceRoot);
    const missingTables = await findMissingSchemaTables(pool);
    assert.deepEqual(missingTables, []);

    return {
      label,
      sourceRoot,
      rootDir,
      schemaName,
      baseDatabaseUrl,
      databaseUrl,
      databaseConfig,
      pool,
      basePool,
    };
  } catch (error) {
    if (pool) {
      await pool.end().catch(() => undefined);
    }
    await basePool.query(`drop schema if exists ${quoteIdent(schemaName)} cascade`).catch(() => undefined);
    await basePool.end().catch(() => undefined);
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function cleanupDbE2EContext(context: DbE2EContext): Promise<void> {
  await closePostgresPool(context.databaseConfig).catch(() => undefined);
  await context.pool.end().catch(() => undefined);
  await context.basePool
    .query(`drop schema if exists ${quoteIdent(context.schemaName)} cascade`)
    .catch(() => undefined);
  await context.basePool.end().catch(() => undefined);
  await fs.rm(context.rootDir, { recursive: true, force: true }).catch(() => undefined);
}

export function createDbTestEnv(
  context: DbE2EContext,
  serviceName: ServiceName = "api",
): ServiceEnv {
  return {
    authAccessTokenSecret: "db-e2e-access-secret",
    authAccessTokenTtlSeconds: 900,
    authBootstrapAdminDisplayName: "DB E2E Admin",
    authBootstrapAdminEmail: null,
    authBootstrapAdminPassword: null,
    authIssuer: "newworkflow-db-e2e",
    authRefreshTokenSecret: "db-e2e-refresh-secret",
    authRefreshTokenTtlSeconds: 7200,
    authRotateRefreshTokenOnUse: true,
    configPath: path.join(context.rootDir, "backend.config.json"),
    database: context.databaseConfig,
    host: "127.0.0.1",
    laozhangApiKey: null,
    laozhangApiUrl: "http://127.0.0.1/unavailable",
    laozhangOpenaiApiBaseUrl: "http://127.0.0.1/unavailable",
    laozhangSora2OfficialApiBaseUrl: "http://127.0.0.1/unavailable",
    laozhangSora2OfficialApiKey: null,
    laozhangVisionApiUrl: "http://127.0.0.1/unavailable",
    laozhangVisionModel: "test",
    laozhangVisionTimeoutMs: 1000,
    laozhangVeoApiBaseUrl: "http://127.0.0.1/unavailable",
    laozhangVeoMaxConcurrency: null,
    laozhangVeoPollIntervalMs: 10,
    laozhangVeoTimeoutMs: 1000,
    nodeEnv: "test",
    objectStorage: {
      provider: "local",
      endpoint: null,
      region: "us-east-1",
      bucket: null,
      accessKeyId: null,
      secretAccessKey: null,
      forcePathStyle: true,
      publicBaseUrl: null,
    },
    persistenceMode: "db",
    port: 0,
    providerSnapshotDir: path.join(context.rootDir, "provider-snapshots"),
    runninghubApiBaseUrl: "http://127.0.0.1/unavailable",
    runninghubApiKey: null,
    runninghubMaxConcurrency: 3,
    serviceName,
    workerPollIntervalMs: 10,
  };
}

export async function startDbApi(context: DbE2EContext): Promise<StartedDbApi> {
  const env = createDbTestEnv(context, "api");
  const server = createApiServer(env, { rootDir: context.rootDir });

  await new Promise<void>((resolve) => {
    server.listen(0, env.host, () => resolve());
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    baseUrl: `http://${env.host}:${address.port}`,
    server,
    env,
  };
}

export async function closeDbApi(api: StartedDbApi | null): Promise<void> {
  if (!api) {
    return;
  }

  await new Promise<void>((resolve) => {
    api.server.closeIdleConnections?.();
    api.server.closeAllConnections?.();
    api.server.close(() => resolve());
  });
}

export async function requestJson<TResponse>(
  baseUrl: string,
  pathname: string,
  options?: {
    method?: string;
    payload?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{
  status: number;
  headers: Headers;
  body: ApiEnvelope<TResponse>;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options?.method ?? "GET",
    headers: {
      ...(options?.payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers ?? {}),
    },
    ...(options?.payload !== undefined ? { body: JSON.stringify(options.payload) } : {}),
  });
  const text = await response.text();
  const body = text
    ? JSON.parse(text) as ApiEnvelope<TResponse>
    : ({ code: response.status, timestamp: Date.now() } as ApiEnvelope<TResponse>);

  return {
    status: response.status,
    headers: response.headers,
    body,
  };
}

export async function requestBuffer(
  baseUrl: string,
  pathname: string,
  options?: {
    headers?: Record<string, string>;
  },
): Promise<{
  status: number;
  headers: Headers;
  buffer: Buffer;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: options?.headers,
  });

  return {
    status: response.status,
    headers: response.headers,
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

export async function registerAccount(
  baseUrl: string,
  input: {
    email: string;
    password: string;
    displayName: string;
  },
): Promise<RegisteredTestAccount> {
  const response = await requestJson<{
    tokens: {
      accessToken: string;
      refreshToken: string;
    };
    user: {
      userId: string;
    };
  }>(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    payload: input,
  });

  assert.equal(response.status, 201);
  assert.ok(response.body.data);

  return {
    accessToken: response.body.data.tokens.accessToken,
    refreshToken: response.body.data.tokens.refreshToken,
    userId: response.body.data.user.userId,
  };
}

export async function loginAccount(
  baseUrl: string,
  input: {
    email: string;
    password: string;
  },
): Promise<RegisteredTestAccount> {
  const response = await requestJson<{
    tokens: {
      accessToken: string;
      refreshToken: string;
    };
    user: {
      userId: string;
    };
  }>(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    payload: input,
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.data);

  return {
    accessToken: response.body.data.tokens.accessToken,
    refreshToken: response.body.data.tokens.refreshToken,
    userId: response.body.data.user.userId,
  };
}

export async function promoteUserToAdmin(
  context: DbE2EContext,
  userId: string,
): Promise<void> {
  await context.pool.query(
    "update users set role = 'admin', updated_at = now() where id = $1",
    [userId],
  );
}

export function bearer(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function registerAndUploadFile(
  baseUrl: string,
  accessToken: string,
  input: {
    content?: Buffer | string;
    originalName: string;
    displayName?: string;
    mimeType?: string;
    fileType?: "image" | "video" | "ply" | "unknown";
    sourceType?: "input" | "intermediate" | "output";
  },
): Promise<UploadedTestFile> {
  const content = Buffer.isBuffer(input.content)
    ? input.content
    : Buffer.from(input.content ?? SAMPLE_PNG);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const registerResponse = await requestJson<{
    uploadRequired: boolean;
    uploadId?: string;
    fileId: string;
    file: UploadedTestFile["file"];
  }>(baseUrl, "/api/v1/files/register", {
    method: "POST",
    headers: bearer(accessToken),
    payload: {
      sha256,
      size: content.length,
      mimeType: input.mimeType ?? "image/png",
      originalName: input.originalName,
      displayName: input.displayName ?? input.originalName,
      fileType: input.fileType ?? "image",
      sourceType: input.sourceType ?? "input",
    },
  });

  assert.equal(registerResponse.status, 200);
  assert.ok(registerResponse.body.data);

  if (!registerResponse.body.data.uploadRequired) {
    return {
      fileId: registerResponse.body.data.fileId,
      sha256,
      content,
      file: registerResponse.body.data.file,
    };
  }

  assert.ok(registerResponse.body.data.uploadId);
  const uploadResponse = await requestJson<{
    fileId: string;
    file: UploadedTestFile["file"];
  }>(baseUrl, "/api/v1/files/upload", {
    method: "POST",
    headers: bearer(accessToken),
    payload: {
      uploadId: registerResponse.body.data.uploadId,
      contentBase64: content.toString("base64"),
    },
  });

  assert.equal(uploadResponse.status, 200);
  assert.ok(uploadResponse.body.data);

  return {
    fileId: uploadResponse.body.data.fileId,
    sha256,
    content,
    file: uploadResponse.body.data.file,
  };
}

export async function querySingleValue<T extends QueryResultRow>(
  context: DbE2EContext,
  sql: string,
  values?: readonly unknown[],
): Promise<T | null> {
  const result = await context.pool.query<T>(sql, values);
  return result.rows[0] ?? null;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function applySqlFile(context: DbE2EContext, sqlPath: string): Promise<void> {
  const sql = await fs.readFile(sqlPath, "utf8");
  await context.pool.query(sql);
}

async function applySchemaMigrations(pool: DatabasePool, sourceRoot: string): Promise<void> {
  for (const migrationFile of MIGRATION_FILES) {
    const sql = readFileSync(path.join(sourceRoot, "db", "migrations", migrationFile), "utf8");
    await pool.query(sql);
  }
}

function createDatabaseConfig(url: string): DatabaseConfig {
  return {
    url,
    host: "127.0.0.1",
    port: 5432,
    database: "newworkflow_test",
    user: "postgres",
    password: null,
    ssl: false,
    maxPoolSize: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
    statementTimeoutMillis: 30000,
    healthcheckTimeoutMillis: 1000,
  };
}

function addSearchPathToDatabaseUrl(databaseUrl: string, schemaName: string): string {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set("options", `-c search_path=${schemaName},public`);
  return parsed.toString();
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sanitizeIdentifierPart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]/gu, "_").replace(/_+/gu, "_");
  return normalized.replace(/^_+|_+$/gu, "") || "db";
}
