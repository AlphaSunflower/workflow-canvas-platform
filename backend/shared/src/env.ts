import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  DatabaseConfig,
  PersistenceMode,
} from "./db/db-config.ts";
import { isPersistenceMode } from "./db/db-config.ts";

export type ServiceName = "api" | "worker";
export type ObjectStorageProvider = "local" | "s3";

export interface ObjectStorageConfig {
  provider: ObjectStorageProvider;
  endpoint: string | null;
  region: string;
  bucket: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  forcePathStyle: boolean;
  publicBaseUrl: string | null;
}

export interface BackendConfig {
  runtime?: {
    host?: unknown;
    nodeEnv?: unknown;
  };
  services?: {
    api?: {
      port?: unknown;
    };
    worker?: {
      pollIntervalMs?: unknown;
      port?: unknown;
    };
  };
  persistence?: {
    mode?: unknown;
    cutoverStage?: unknown;
  };
  database?: {
    url?: unknown;
    host?: unknown;
    port?: unknown;
    database?: unknown;
    user?: unknown;
    password?: unknown;
    ssl?: unknown;
    maxPoolSize?: unknown;
    idleTimeoutMillis?: unknown;
    connectionTimeoutMillis?: unknown;
    statementTimeoutMillis?: unknown;
    healthcheckTimeoutMillis?: unknown;
  };
  storage?: {
    provider?: unknown;
    s3?: {
      endpoint?: unknown;
      region?: unknown;
      bucket?: unknown;
      accessKeyId?: unknown;
      secretAccessKey?: unknown;
      forcePathStyle?: unknown;
      publicBaseUrl?: unknown;
    };
  };
  auth?: {
    jwt?: {
      issuer?: unknown;
      accessTokenSecret?: unknown;
      accessTokenTtlSeconds?: unknown;
      refreshTokenSecret?: unknown;
      refreshTokenTtlSeconds?: unknown;
    };
    session?: {
      rotateRefreshTokenOnUse?: unknown;
    };
    bootstrapAdmin?: {
      email?: unknown;
      password?: unknown;
      displayName?: unknown;
    };
  };
  providers?: {
    laozhang?: {
      apiKey?: unknown;
      apiUrl?: unknown;
      openaiApiBaseUrl?: unknown;
      sora2Official?: {
        apiKey?: unknown;
        apiBaseUrl?: unknown;
      };
      vision?: {
        apiUrl?: unknown;
        model?: unknown;
        timeoutMs?: unknown;
      };
      veo?: {
        apiBaseUrl?: unknown;
        pollIntervalMs?: unknown;
        timeoutMs?: unknown;
        maxConcurrency?: unknown;
      };
    };
    runninghub?: {
      apiKey?: unknown;
      apiBaseUrl?: unknown;
      maxConcurrency?: unknown;
    };
  };
  paths?: {
    providerSnapshotDir?: unknown;
  };
}

export interface ServiceEnv {
  authAccessTokenSecret: string | null;
  authAccessTokenTtlSeconds: number;
  authBootstrapAdminDisplayName: string;
  authBootstrapAdminEmail: string | null;
  authBootstrapAdminPassword: string | null;
  authIssuer: string;
  authRefreshTokenSecret: string | null;
  authRefreshTokenTtlSeconds: number;
  authRotateRefreshTokenOnUse: boolean;
  configPath: string;
  database: DatabaseConfig;
  host: string;
  laozhangApiKey: string | null;
  laozhangApiUrl: string;
  laozhangOpenaiApiBaseUrl: string;
  laozhangSora2OfficialApiBaseUrl: string;
  laozhangSora2OfficialApiKey: string | null;
  laozhangVisionApiUrl: string;
  laozhangVisionModel: string;
  laozhangVisionTimeoutMs: number;
  laozhangVeoApiBaseUrl: string;
  laozhangVeoMaxConcurrency: number | null;
  laozhangVeoPollIntervalMs: number;
  laozhangVeoTimeoutMs: number;
  nodeEnv: string;
  objectStorage: ObjectStorageConfig;
  persistenceMode: PersistenceMode;
  port: number;
  providerSnapshotDir: string;
  runninghubApiBaseUrl: string | null;
  runninghubApiKey: string | null;
  runninghubMaxConcurrency: number;
  serviceName: ServiceName;
  workerPollIntervalMs: number;
}

let cachedConfigPath: string | null = null;
let cachedConfig: BackendConfig | null = null;

function resolveBackendRoot(): string {
  const currentDir = typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));

  return path.resolve(currentDir, "../..");
}

function resolveInputPath(rawPath: string): string {
  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = readNumber(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function pickBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    const parsed = readBoolean(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = readString(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function normalizePositiveInteger(
  value: number | null,
  fallback: number,
): number {
  if (value === null || value < 1) {
    return fallback;
  }

  return value;
}

function normalizeOptionalPositiveInteger(
  value: number | null,
): number | null {
  if (value === null || value < 1) {
    return null;
  }

  return value;
}

function normalizeNonNegativeInteger(
  value: number | null,
  fallback: number,
): number {
  if (value === null || value < 0) {
    return fallback;
  }

  return value;
}

function normalizePersistenceModeValue(
  value: unknown,
  source: string,
): PersistenceMode | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(
      `INVALID_PERSISTENCE_MODE: ${source} must be "json" or "db".`,
    );
  }

  const normalized = value.trim();
  if (!normalized || !isPersistenceMode(normalized)) {
    throw new Error(
      `INVALID_PERSISTENCE_MODE: ${source} must be "json" or "db".`,
    );
  }

  return normalized;
}

function normalizePersistenceMode(
  envValue: unknown,
  configValue: unknown,
): PersistenceMode {
  return normalizePersistenceModeValue(
    envValue,
    "BACKEND_PERSISTENCE_MODE",
  )
    ?? normalizePersistenceModeValue(configValue, "persistence.mode")
    ?? "db";
}

function normalizeObjectStorageProvider(
  envValue: unknown,
  configValue: unknown,
): ObjectStorageProvider {
  const value = pickString(envValue, configValue) ?? "local";

  if (value === "local" || value === "s3") {
    return value;
  }

  throw new Error(
    "INVALID_OBJECT_STORAGE_PROVIDER: storage.provider must be \"local\" or \"s3\".",
  );
}

function normalizeConfiguredSecret(
  value: string | null,
  placeholders: string[],
): string | null {
  if (!value) {
    return null;
  }

  if (placeholders.includes(value)) {
    return null;
  }

  return value;
}

function normalizeProviderApiKey(value: string | null): string | null {
  return normalizeConfiguredSecret(value, [
    "YOUR_LAOZHANG_API_KEY",
    "YOUR_LAOZHANG_SORA2OFFICIAL_API_KEY",
    "YOUR_RUNNINGHUB_API_KEY",
  ]);
}

export function resolveBackendConfigPath(): string {
  const configuredPath = readString(process.env.BACKEND_CONFIG_PATH);
  if (configuredPath) {
    return resolveInputPath(configuredPath);
  }

  return path.join(resolveBackendRoot(), "config", "backend.config.json");
}

export function loadBackendConfig(configPath = resolveBackendConfigPath()): BackendConfig {
  if (cachedConfigPath === configPath && cachedConfig) {
    return cachedConfig;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const normalized = raw.trim();
    if (!normalized) {
      cachedConfigPath = configPath;
      cachedConfig = {};
      return cachedConfig;
    }

    const parsed = JSON.parse(normalized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("配置文件根节点必须是 JSON 对象。");
    }

    cachedConfigPath = configPath;
    cachedConfig = parsed as BackendConfig;
    return cachedConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      cachedConfigPath = configPath;
      cachedConfig = {};
      return cachedConfig;
    }

    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    throw new Error(`读取后端配置文件失败: ${configPath} - ${message}`);
  }
}

export function createEnv(serviceName: ServiceName): ServiceEnv {
  const configPath = resolveBackendConfigPath();
  const config = loadBackendConfig(configPath);
  const port =
    serviceName === "api"
      ? (pickNumber(process.env.BACKEND_API_PORT, config.services?.api?.port) ?? 3100)
      : (pickNumber(process.env.BACKEND_WORKER_PORT, config.services?.worker?.port) ?? 3200);
  const persistenceMode = normalizePersistenceMode(
    process.env.BACKEND_PERSISTENCE_MODE,
    config.persistence?.mode,
  );
  const database: DatabaseConfig = {
    url: pickString(
      process.env.DATABASE_URL,
      process.env.BACKEND_DATABASE_URL,
      config.database?.url,
    ),
    host: pickString(
      process.env.PGHOST,
      process.env.BACKEND_DATABASE_HOST,
      config.database?.host,
    ) ?? "127.0.0.1",
    port: normalizePositiveInteger(
      pickNumber(
        process.env.PGPORT,
        process.env.BACKEND_DATABASE_PORT,
        config.database?.port,
      ),
      5432,
    ),
    database: pickString(
      process.env.PGDATABASE,
      process.env.BACKEND_DATABASE_NAME,
      config.database?.database,
    ) ?? "newworkflow",
    user: pickString(
      process.env.PGUSER,
      process.env.BACKEND_DATABASE_USER,
      config.database?.user,
    ) ?? "postgres",
    password: pickString(
      process.env.PGPASSWORD,
      process.env.BACKEND_DATABASE_PASSWORD,
      config.database?.password,
    ),
    ssl: pickBoolean(
      process.env.BACKEND_DATABASE_SSL,
      config.database?.ssl,
    ) ?? false,
    maxPoolSize: normalizePositiveInteger(
      pickNumber(
        process.env.BACKEND_DATABASE_MAX_POOL_SIZE,
        config.database?.maxPoolSize,
      ),
      10,
    ),
    idleTimeoutMillis: normalizePositiveInteger(
      pickNumber(
        process.env.BACKEND_DATABASE_IDLE_TIMEOUT_MS,
        config.database?.idleTimeoutMillis,
      ),
      30000,
    ),
    connectionTimeoutMillis: normalizePositiveInteger(
      pickNumber(
        process.env.BACKEND_DATABASE_CONNECTION_TIMEOUT_MS,
        config.database?.connectionTimeoutMillis,
      ),
      3000,
    ),
    statementTimeoutMillis: normalizeNonNegativeInteger(
      pickNumber(
        process.env.BACKEND_DATABASE_STATEMENT_TIMEOUT_MS,
        config.database?.statementTimeoutMillis,
      ),
      30000,
    ),
    healthcheckTimeoutMillis: normalizePositiveInteger(
      pickNumber(
        process.env.BACKEND_DATABASE_HEALTHCHECK_TIMEOUT_MS,
        config.database?.healthcheckTimeoutMillis,
      ),
      1000,
    ),
  };
  const objectStorageProvider = normalizeObjectStorageProvider(
    process.env.BACKEND_OBJECT_STORAGE_PROVIDER,
    config.storage?.provider,
  );
  const objectStorage: ObjectStorageConfig = {
    provider: objectStorageProvider,
    endpoint: pickString(
      process.env.BACKEND_S3_ENDPOINT,
      config.storage?.s3?.endpoint,
    ),
    region: pickString(
      process.env.BACKEND_S3_REGION,
      config.storage?.s3?.region,
    ) ?? "us-east-1",
    bucket: pickString(
      process.env.BACKEND_S3_BUCKET,
      config.storage?.s3?.bucket,
    ),
    accessKeyId: normalizeConfiguredSecret(
      pickString(
        process.env.BACKEND_S3_ACCESS_KEY_ID,
        config.storage?.s3?.accessKeyId,
      ),
      ["CHANGE_ME_S3_ACCESS_KEY_ID"],
    ),
    secretAccessKey: normalizeConfiguredSecret(
      pickString(
        process.env.BACKEND_S3_SECRET_ACCESS_KEY,
        config.storage?.s3?.secretAccessKey,
      ),
      ["CHANGE_ME_S3_SECRET_ACCESS_KEY"],
    ),
    forcePathStyle: pickBoolean(
      process.env.BACKEND_S3_FORCE_PATH_STYLE,
      config.storage?.s3?.forcePathStyle,
    ) ?? true,
    publicBaseUrl: pickString(
      process.env.BACKEND_S3_PUBLIC_BASE_URL,
      config.storage?.s3?.publicBaseUrl,
    ),
  };

  return {
    authAccessTokenSecret: normalizeConfiguredSecret(
      pickString(
        process.env.BACKEND_AUTH_ACCESS_TOKEN_SECRET,
        config.auth?.jwt?.accessTokenSecret,
      ),
      ["CHANGE_ME_ACCESS_TOKEN_SECRET"],
    ),
    authAccessTokenTtlSeconds: normalizePositiveInteger(
      pickNumber(
        process.env.BACKEND_AUTH_ACCESS_TOKEN_TTL_SECONDS,
        config.auth?.jwt?.accessTokenTtlSeconds,
      ),
      3600,
    ),
    authBootstrapAdminDisplayName: pickString(
      process.env.BACKEND_AUTH_BOOTSTRAP_ADMIN_DISPLAY_NAME,
      config.auth?.bootstrapAdmin?.displayName,
    ) ?? "System Admin",
    authBootstrapAdminEmail: pickString(
      process.env.BACKEND_AUTH_BOOTSTRAP_ADMIN_EMAIL,
      config.auth?.bootstrapAdmin?.email,
    ),
    authBootstrapAdminPassword: normalizeConfiguredSecret(
      pickString(
        process.env.BACKEND_AUTH_BOOTSTRAP_ADMIN_PASSWORD,
        config.auth?.bootstrapAdmin?.password,
      ),
      ["CHANGE_ME_ADMIN_PASSWORD"],
    ),
    authIssuer: pickString(
      process.env.BACKEND_AUTH_ISSUER,
      config.auth?.jwt?.issuer,
    ) ?? "newworkflow-backend",
    authRefreshTokenSecret: normalizeConfiguredSecret(
      pickString(
        process.env.BACKEND_AUTH_REFRESH_TOKEN_SECRET,
        config.auth?.jwt?.refreshTokenSecret,
      ),
      ["CHANGE_ME_REFRESH_TOKEN_SECRET"],
    ),
    authRefreshTokenTtlSeconds: normalizePositiveInteger(
      pickNumber(
        process.env.BACKEND_AUTH_REFRESH_TOKEN_TTL_SECONDS,
        config.auth?.jwt?.refreshTokenTtlSeconds,
      ),
      2_592_000,
    ),
    authRotateRefreshTokenOnUse: pickBoolean(
      process.env.BACKEND_AUTH_ROTATE_REFRESH_TOKEN_ON_USE,
      config.auth?.session?.rotateRefreshTokenOnUse,
    ) ?? true,
    configPath,
    database,
    host: pickString(process.env.BACKEND_HOST, config.runtime?.host) ?? "127.0.0.1",
    laozhangApiKey: normalizeProviderApiKey(pickString(
      process.env.LAOZHANG_API_KEY,
      config.providers?.laozhang?.apiKey,
    )),
    laozhangApiUrl: pickString(
      process.env.LAOZHANG_API_URL,
      config.providers?.laozhang?.apiUrl,
    ) ?? "https://api2.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent",
    laozhangOpenaiApiBaseUrl: pickString(
      process.env.LAOZHANG_OPENAI_API_BASE_URL,
      config.providers?.laozhang?.openaiApiBaseUrl,
    ) ?? "https://api2.laozhang.ai/v1",
    laozhangSora2OfficialApiBaseUrl: pickString(
      process.env.LAOZHANG_SORA2OFFICIAL_BASE_URL,
      config.providers?.laozhang?.sora2Official?.apiBaseUrl,
    ) ?? "https://api2.laozhang.ai/v1",
    laozhangSora2OfficialApiKey: normalizeProviderApiKey(pickString(
      process.env.LAOZHANG_SORA2OFFICIAL_API_KEY,
      config.providers?.laozhang?.sora2Official?.apiKey,
    )),
    laozhangVisionApiUrl: pickString(
      process.env.LAOZHANG_VISION_API_URL,
      config.providers?.laozhang?.vision?.apiUrl,
    ) ?? "https://api2.laozhang.ai/v1/chat/completions",
    laozhangVisionModel: pickString(
      process.env.LAOZHANG_VISION_MODEL,
      config.providers?.laozhang?.vision?.model,
    ) ?? "gemini-2.5-flash",
    laozhangVisionTimeoutMs: normalizePositiveInteger(
      pickNumber(
        process.env.LAOZHANG_VISION_TIMEOUT_MS,
        config.providers?.laozhang?.vision?.timeoutMs,
      ),
      180000,
    ),
    laozhangVeoApiBaseUrl: pickString(
      process.env.LAOZHANG_VEO_API_BASE_URL,
      config.providers?.laozhang?.veo?.apiBaseUrl,
    ) ?? "https://api2.laozhang.ai/v1",
    laozhangVeoMaxConcurrency: normalizeOptionalPositiveInteger(
      pickNumber(
        process.env.LAOZHANG_VEO_MAX_CONCURRENCY,
        config.providers?.laozhang?.veo?.maxConcurrency,
      ),
    ),
    laozhangVeoPollIntervalMs: normalizePositiveInteger(
      pickNumber(
        process.env.LAOZHANG_VEO_POLL_INTERVAL_MS,
        config.providers?.laozhang?.veo?.pollIntervalMs,
      ),
      5000,
    ),
    laozhangVeoTimeoutMs: normalizePositiveInteger(
      pickNumber(
        process.env.LAOZHANG_VEO_TIMEOUT_MS,
        config.providers?.laozhang?.veo?.timeoutMs,
      ),
      600000,
    ),
    nodeEnv: pickString(process.env.NODE_ENV, config.runtime?.nodeEnv) ?? "development",
    objectStorage,
    persistenceMode,
    port,
    providerSnapshotDir: pickString(
      process.env.BACKEND_PROVIDER_SNAPSHOT_DIR,
      config.paths?.providerSnapshotDir,
    ) ?? "data/provider-snapshots",
    runninghubApiBaseUrl: pickString(
      process.env.RUNNINGHUB_API_BASE_URL,
      config.providers?.runninghub?.apiBaseUrl,
    ) ?? "https://www.runninghub.cn",
    runninghubApiKey: normalizeProviderApiKey(pickString(
      process.env.RUNNINGHUB_API_KEY,
      config.providers?.runninghub?.apiKey,
    )),
    runninghubMaxConcurrency: normalizePositiveInteger(
      pickNumber(
        process.env.RUNNINGHUB_MAX_CONCURRENCY,
        config.providers?.runninghub?.maxConcurrency,
      ),
      3,
    ),
    serviceName,
    workerPollIntervalMs: pickNumber(
      process.env.BACKEND_WORKER_POLL_INTERVAL_MS,
      config.services?.worker?.pollIntervalMs,
    ) ?? 5000,
  };
}
