import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFilePath);
const backendRoot = path.resolve(scriptDir, "..");
const requireFromBackend = createRequire(path.join(backendRoot, "package.json"));
const configPath = resolveConfigPath();
const runMode = process.argv.includes("--dev") ? "dev" : "start";
const checkOnly = process.argv.includes("--check");

const services = [
  {
    name: "api",
    cwd: path.join(backendRoot, "api"),
  },
  {
    name: "worker",
    cwd: path.join(backendRoot, "worker"),
  },
];

const runningChildren = new Map();
let shuttingDown = false;

const persistenceModes = new Set(["json", "db"]);
const requiredDbTables = [
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

function resolveConfigPath() {
  const configuredPath = process.env.BACKEND_CONFIG_PATH?.trim();
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
  }

  return path.join(backendRoot, "config", "backend.config.json");
}

function readConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf8").trim();
  if (!raw) {
    throw new Error(`Config file is empty: ${configPath}`);
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Config root must be a JSON object.");
  }

  return parsed;
}

function readNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function readString(value, fallback) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return fallback;
}

function normalizePersistenceModeValue(value, source) {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`INVALID_PERSISTENCE_MODE: ${source} must be "json" or "db".`);
  }

  const normalized = value.trim();
  if (!normalized || !persistenceModes.has(normalized)) {
    throw new Error(`INVALID_PERSISTENCE_MODE: ${source} must be "json" or "db".`);
  }

  return normalized;
}

function normalizePersistenceMode(config) {
  return normalizePersistenceModeValue(
    process.env.BACKEND_PERSISTENCE_MODE,
    "BACKEND_PERSISTENCE_MODE",
  )
    ?? normalizePersistenceModeValue(config?.persistence?.mode, "persistence.mode")
    ?? "db";
}

function isPlaceholderKey(value) {
  return value === "YOUR_LAOZHANG_API_KEY"
    || value === "YOUR_LAOZHANG_SORA2OFFICIAL_API_KEY"
    || value === "YOUR_RUNNINGHUB_API_KEY";
}

function createSummary(config) {
  return {
    host: readString(config?.runtime?.host, "127.0.0.1"),
    nodeEnv: readString(config?.runtime?.nodeEnv, "development"),
    apiPort: readNumber(config?.services?.api?.port, 3100),
    workerPort: readNumber(config?.services?.worker?.port, 3200),
    workerPollIntervalMs: readNumber(
      config?.services?.worker?.pollIntervalMs,
      5000,
    ),
    providerSnapshotDir: readString(
      config?.paths?.providerSnapshotDir,
      "data/provider-snapshots",
    ),
    laozhangApiUrl: readString(
      config?.providers?.laozhang?.apiUrl,
      "https://api.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent",
    ),
    laozhangOpenaiApiBaseUrl: readString(
      config?.providers?.laozhang?.openaiApiBaseUrl,
      "https://api.laozhang.ai/v1",
    ),
    laozhangSora2OfficialApiBaseUrl: readString(
      config?.providers?.laozhang?.sora2Official?.apiBaseUrl,
      "https://api.laozhang.ai/v1",
    ),
    laozhangSora2OfficialApiKey: readString(
      config?.providers?.laozhang?.sora2Official?.apiKey,
      "",
    ),
    laozhangApiKey: readString(config?.providers?.laozhang?.apiKey, ""),
    runninghubApiBaseUrl: readString(
      config?.providers?.runninghub?.apiBaseUrl,
      "https://www.runninghub.cn",
    ),
    runninghubApiKey: readString(config?.providers?.runninghub?.apiKey, ""),
    authIssuer: readString(config?.auth?.jwt?.issuer, "newworkflow-backend"),
    authAccessTokenSecret: readString(config?.auth?.jwt?.accessTokenSecret, ""),
    authAccessTokenTtlSeconds: readNumber(
      config?.auth?.jwt?.accessTokenTtlSeconds,
      3600,
    ),
    authRefreshTokenSecret: readString(config?.auth?.jwt?.refreshTokenSecret, ""),
    authRefreshTokenTtlSeconds: readNumber(
      config?.auth?.jwt?.refreshTokenTtlSeconds,
      2592000,
    ),
    authBootstrapAdminEmail: readString(config?.auth?.bootstrapAdmin?.email, ""),
    authBootstrapAdminPassword: readString(config?.auth?.bootstrapAdmin?.password, ""),
    authBootstrapAdminDisplayName: readString(
      config?.auth?.bootstrapAdmin?.displayName,
      "System Admin",
    ),
    persistenceMode: normalizePersistenceMode(config),
    databaseUrl: readString(process.env.DATABASE_URL, readString(process.env.BACKEND_DATABASE_URL, readString(config?.database?.url, ""))),
    databaseHost: readString(process.env.PGHOST, readString(process.env.BACKEND_DATABASE_HOST, readString(config?.database?.host, "127.0.0.1"))),
    databasePort: readNumber(process.env.PGPORT, readNumber(process.env.BACKEND_DATABASE_PORT, readNumber(config?.database?.port, 5432))),
    databaseName: readString(process.env.PGDATABASE, readString(process.env.BACKEND_DATABASE_NAME, readString(config?.database?.database, "newworkflow"))),
    databaseUser: readString(process.env.PGUSER, readString(process.env.BACKEND_DATABASE_USER, readString(config?.database?.user, "postgres"))),
    databasePassword: readString(process.env.PGPASSWORD, readString(process.env.BACKEND_DATABASE_PASSWORD, readString(config?.database?.password, ""))),
    databaseSsl: readBoolean(process.env.BACKEND_DATABASE_SSL, readBoolean(config?.database?.ssl, false)),
    databaseMaxPoolSize: readNumber(process.env.BACKEND_DATABASE_MAX_POOL_SIZE, readNumber(config?.database?.maxPoolSize, 10)),
    databaseIdleTimeoutMillis: readNumber(process.env.BACKEND_DATABASE_IDLE_TIMEOUT_MS, readNumber(config?.database?.idleTimeoutMillis, 30000)),
    databaseConnectionTimeoutMillis: readNumber(process.env.BACKEND_DATABASE_CONNECTION_TIMEOUT_MS, readNumber(config?.database?.connectionTimeoutMillis, 3000)),
    databaseStatementTimeoutMillis: readNumber(process.env.BACKEND_DATABASE_STATEMENT_TIMEOUT_MS, readNumber(config?.database?.statementTimeoutMillis, 30000)),
    databaseHealthcheckTimeoutMillis: readNumber(process.env.BACKEND_DATABASE_HEALTHCHECK_TIMEOUT_MS, readNumber(config?.database?.healthcheckTimeoutMillis, 1000)),
    objectStorageProvider: readString(process.env.BACKEND_OBJECT_STORAGE_PROVIDER, readString(config?.storage?.provider, "local")),
    s3Endpoint: readString(process.env.BACKEND_S3_ENDPOINT, readString(config?.storage?.s3?.endpoint, "")),
    s3Region: readString(process.env.BACKEND_S3_REGION, readString(config?.storage?.s3?.region, "us-east-1")),
    s3Bucket: readString(process.env.BACKEND_S3_BUCKET, readString(config?.storage?.s3?.bucket, "")),
    s3AccessKeyId: readString(process.env.BACKEND_S3_ACCESS_KEY_ID, readString(config?.storage?.s3?.accessKeyId, "")),
    s3SecretAccessKey: readString(process.env.BACKEND_S3_SECRET_ACCESS_KEY, readString(config?.storage?.s3?.secretAccessKey, "")),
    s3ForcePathStyle: readBoolean(process.env.BACKEND_S3_FORCE_PATH_STYLE, readBoolean(config?.storage?.s3?.forcePathStyle, true)),
  };
}

function readBoolean(value, fallback) {
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

  return fallback;
}

function resolveBackendPath(inputPath) {
  if (!inputPath) {
    return backendRoot;
  }

  return path.isAbsolute(inputPath)
    ? inputPath
    : path.join(backendRoot, inputPath);
}

function writeJsonIfMissing(filePath, value) {
  if (fs.existsSync(filePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function initializeStorageLayout(config) {
  const storageDir = path.join(backendRoot, "storage");
  const blobsDir = path.join(storageDir, "blobs");
  const providerSnapshotDir = resolveBackendPath(
    readString(config?.paths?.providerSnapshotDir, "data/provider-snapshots"),
  );

  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(blobsDir, { recursive: true });
  fs.mkdirSync(providerSnapshotDir, { recursive: true });

  console.log("[backend] storage layout initialized.");
}

function initializeWorkflowAndStorageLayout(config) {
  const dataDir = path.join(backendRoot, "data");
  const workflowsDir = path.join(dataDir, "workflows");
  const filesDir = path.join(dataDir, "files");
  const legacyFilesStorePath = path.join(dataDir, "files-store.json");
  const filesStorePath = path.join(filesDir, "files-store.json");

  initializeStorageLayout(config);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(filesDir, { recursive: true });

  if (!fs.existsSync(filesStorePath) && fs.existsSync(legacyFilesStorePath)) {
    fs.copyFileSync(legacyFilesStorePath, filesStorePath);
  }

  writeJsonIfMissing(path.join(workflowsDir, "index.json"), { items: [] });
  writeJsonIfMissing(path.join(workflowsDir, "accounts-index.json"), { items: [] });
  writeJsonIfMissing(path.join(workflowsDir, "groups-index.json"), { items: [] });
  writeJsonIfMissing(filesStorePath, {
    blobs: [],
    files: [],
    pendingUploads: [],
  });
  writeJsonIfMissing(path.join(dataDir, "storage-index.json"), {
    files: [],
  });

  console.log("[backend] legacy JSON workflow/file layout initialized.");
}

function printSummary(summary) {
  console.log(`[backend] config: ${configPath}`);
  console.log(`[backend] nodeEnv: ${summary.nodeEnv}`);
  console.log(`[backend] host: ${summary.host}`);
  console.log(`[backend] api port: ${summary.apiPort}`);
  console.log(`[backend] worker port: ${summary.workerPort}`);
  console.log(`[backend] worker poll interval: ${summary.workerPollIntervalMs} ms`);
  console.log(`[backend] provider snapshot dir: ${summary.providerSnapshotDir}`);
  console.log(`[backend] laozhang gemini api url: ${summary.laozhangApiUrl}`);
  console.log(`[backend] laozhang openai api base url: ${summary.laozhangOpenaiApiBaseUrl}`);
  console.log(`[backend] laozhang sora2official api base url: ${summary.laozhangSora2OfficialApiBaseUrl}`);
  console.log(`[backend] runninghub api base url: ${summary.runninghubApiBaseUrl}`);
  console.log(`[backend] auth issuer: ${summary.authIssuer}`);
  console.log(`[backend] auth access token ttl: ${summary.authAccessTokenTtlSeconds} s`);
  console.log(`[backend] auth refresh token ttl: ${summary.authRefreshTokenTtlSeconds} s`);
  console.log(`[backend] persistence mode: ${summary.persistenceMode}`);
  console.log(`[backend] object storage provider: ${summary.objectStorageProvider}`);
  console.log(`[backend] bootstrap admin configured: ${summary.authBootstrapAdminEmail ? "yes" : "no"}`);

  if (!summary.laozhangApiKey || isPlaceholderKey(summary.laozhangApiKey)) {
    console.warn("[backend] warning: providers.laozhang.apiKey is missing or placeholder; Laozhang execution will fail during execution.");
  }

  if (!summary.laozhangSora2OfficialApiKey || isPlaceholderKey(summary.laozhangSora2OfficialApiKey)) {
    console.warn("[backend] warning: providers.laozhang.sora2Official.apiKey is missing or placeholder; GPT Image 2 Official execution will fail during execution.");
  }

  if (!summary.runninghubApiKey || isPlaceholderKey(summary.runninghubApiKey)) {
    console.warn("[backend] warning: providers.runninghub.apiKey is missing or placeholder; aiImageToPly execution will fail during execution.");
  }

  if (summary.authBootstrapAdminEmail && !summary.authBootstrapAdminPassword) {
    console.warn("[backend] warning: auth.bootstrapAdmin.email is configured but auth.bootstrapAdmin.password is empty or placeholder; bootstrap admin initialization will be skipped.");
  }

  if (summary.objectStorageProvider === "s3") {
    const missing = [];

    if (!summary.s3Endpoint) {
      missing.push("storage.s3.endpoint/BACKEND_S3_ENDPOINT");
    }
    if (!summary.s3Bucket) {
      missing.push("storage.s3.bucket/BACKEND_S3_BUCKET");
    }
    if (!summary.s3AccessKeyId || summary.s3AccessKeyId === "CHANGE_ME_S3_ACCESS_KEY_ID") {
      missing.push("storage.s3.accessKeyId/BACKEND_S3_ACCESS_KEY_ID");
    }
    if (!summary.s3SecretAccessKey || summary.s3SecretAccessKey === "CHANGE_ME_S3_SECRET_ACCESS_KEY") {
      missing.push("storage.s3.secretAccessKey/BACKEND_S3_SECRET_ACCESS_KEY");
    }

    if (missing.length > 0) {
      throw new Error(`OBJECT_STORAGE_NOT_READY: missing ${missing.join(", ")}.`);
    }
  }
}

function resolveAccountsStorePath() {
  return path.join(backendRoot, "data", "accounts-store.json");
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function createPasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function readAccountsStore(storePath) {
  if (!fs.existsSync(storePath)) {
    return {
      users: [],
      sessions: [],
      auditLogs: [],
    };
  }

  const raw = fs.readFileSync(storePath, "utf8").trim();
  if (!raw) {
    return {
      users: [],
      sessions: [],
      auditLogs: [],
    };
  }

  const parsed = JSON.parse(raw);
  return {
    users: Array.isArray(parsed?.users) ? parsed.users : [],
    sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
    auditLogs: Array.isArray(parsed?.auditLogs) ? parsed.auditLogs : [],
  };
}

function writeAccountsStore(storePath, store) {
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

async function initializeAccountsStore(config) {
  const summary = createSummary(config);

  if (summary.persistenceMode === "db") {
    await initializeDatabaseAccounts(summary);
    return;
  }

  const dataDir = path.join(backendRoot, "data");
  const storePath = resolveAccountsStorePath();
  fs.mkdirSync(dataDir, { recursive: true });

  const store = readAccountsStore(storePath);
  writeAccountsStore(storePath, store);

  const email = readString(config?.auth?.bootstrapAdmin?.email, "");
  const password = readString(config?.auth?.bootstrapAdmin?.password, "");
  const displayName = readString(
    config?.auth?.bootstrapAdmin?.displayName,
    "System Admin",
  );

  if (!email || !password || password === "CHANGE_ME_ADMIN_PASSWORD") {
    console.log("[backend] accounts store initialized.");
    return;
  }

  const normalizedEmail = normalizeEmail(email);
  const existingUser = store.users.find((user) => user.email === normalizedEmail);

  if (existingUser) {
    writeAccountsStore(storePath, store);
    console.log(`[backend] accounts store initialized. bootstrap admin: ${existingUser.email}`);
    return;
  }

  const now = new Date().toISOString();
  const admin = {
    id: randomUUID(),
    email: normalizedEmail,
    passwordHash: createPasswordHash(password),
    displayName,
    role: "admin",
    status: "enabled",
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  };

  store.users.push(admin);
  store.auditLogs.push({
    id: randomUUID(),
    actorUserId: admin.id,
    actorRole: "admin",
    action: "bootstrap_admin_created",
    targetType: "user",
    targetId: admin.id,
    payload: {
      email: admin.email,
      displayName: admin.displayName,
    },
    createdAt: now,
  });
  writeAccountsStore(storePath, store);

  console.log(`[backend] accounts store initialized. bootstrap admin: ${admin.email}`);
}

function buildDatabasePoolConfig(summary) {
  const baseConfig = summary.databaseUrl
    ? { connectionString: summary.databaseUrl }
    : {
        host: summary.databaseHost,
        port: summary.databasePort,
        database: summary.databaseName,
        user: summary.databaseUser,
        password: summary.databasePassword || undefined,
      };

  return {
    ...baseConfig,
    max: summary.databaseMaxPoolSize,
    idleTimeoutMillis: summary.databaseIdleTimeoutMillis,
    connectionTimeoutMillis: summary.databaseConnectionTimeoutMillis,
    statement_timeout: summary.databaseStatementTimeoutMillis,
    ssl: summary.databaseSsl ? { rejectUnauthorized: false } : undefined,
  };
}

function loadPg() {
  try {
    return requireFromBackend("pg");
  } catch {
    return requireFromBackend(path.join(backendRoot, "api", "node_modules", "pg"));
  }
}

function withTimeout(operation, timeoutMillis, label) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label}_TIMEOUT:${timeoutMillis}`));
    }, timeoutMillis);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

async function assertDatabaseReady(summary) {
  if (summary.persistenceMode !== "db") {
    return;
  }

  const { Pool } = loadPg();
  const pool = new Pool(buildDatabasePoolConfig(summary));

  try {
    const client = await withTimeout(
      pool.connect(),
      summary.databaseHealthcheckTimeoutMillis,
      "DB_CONNECT",
    );

    try {
      await withTimeout(
        client.query("select 1 as ok"),
        summary.databaseHealthcheckTimeoutMillis,
        "DB_HEALTHCHECK",
      );
      const schemaCheck = await client.query(
        `
          select table_name
          from unnest($1::text[]) as required(table_name)
          where to_regclass(format('%I', table_name)) is null
          order by table_name
        `,
        [requiredDbTables],
      );
      const missingTables = schemaCheck.rows.map((row) => row.table_name);

      if (missingTables.length > 0) {
        throw new Error(
          `DATABASE_SCHEMA_NOT_READY: missing tables ${missingTables.join(", ")}. Run backend/db/migrations/001_init.sql through 004_production_hardening.sql before starting DB mode.`,
        );
      }
    } finally {
      client.release();
    }

    console.log("[backend] database connection and schema check passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DATABASE_NOT_READY: ${message}`);
  } finally {
    await pool.end();
  }
}

async function initializeDatabaseAccounts(summary) {
  const email = summary.authBootstrapAdminEmail;
  const password = summary.authBootstrapAdminPassword;
  const displayName = summary.authBootstrapAdminDisplayName;

  if (!email || !password || password === "CHANGE_ME_ADMIN_PASSWORD") {
    console.log("[backend] database accounts bootstrap skipped.");
    return;
  }

  const { Pool } = loadPg();

  const pool = new Pool(buildDatabasePoolConfig(summary));
  const client = await pool.connect();

  try {
    const normalizedEmail = normalizeEmail(email);
    await client.query("begin");
    const existing = await client.query(
      `
        select id, email
        from users
        where email = $1
        limit 1
      `,
      [normalizedEmail],
    );

    if (existing.rows[0]) {
      await client.query("commit");
      console.log(`[backend] database accounts initialized. bootstrap admin: ${existing.rows[0].email}`);
      return;
    }

    const inserted = await client.query(
      `
        insert into users (
          email,
          password_hash,
          display_name,
          role,
          status,
          last_login_at
        )
        values ($1, $2, $3, 'admin', 'enabled', null)
        returning id, email, display_name
      `,
      [
        normalizedEmail,
        createPasswordHash(password),
        displayName,
      ],
    );
    const admin = inserted.rows[0];
    await client.query(
      `
        insert into audit_logs (
          actor_user_id,
          actor_role,
          action,
          target_type,
          target_id,
          payload
        )
        values ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        admin.id,
        "admin",
        "bootstrap_admin_created",
        "user",
        admin.id,
        JSON.stringify({
          email: admin.email,
          displayName: admin.display_name,
        }),
      ],
    );
    await client.query("commit");
    console.log(`[backend] database accounts initialized. bootstrap admin: ${admin.email}`);
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Keep the original startup error visible.
    }

    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function bindPrefixedOutput(serviceName, stream, target) {
  const lineReader = readline.createInterface({ input: stream });
  lineReader.on("line", (line) => {
    target.write(`[${serviceName}] ${line}\n`);
  });
}

function spawnService(service) {
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `npm.cmd run ${runMode}`], {
        cwd: service.cwd,
        env: {
          ...process.env,
          BACKEND_CONFIG_PATH: configPath,
        },
        stdio: ["inherit", "pipe", "pipe"],
      })
      : spawn("npm", ["run", runMode], {
        cwd: service.cwd,
        env: {
          ...process.env,
          BACKEND_CONFIG_PATH: configPath,
        },
        stdio: ["inherit", "pipe", "pipe"],
      });

  bindPrefixedOutput(service.name, child.stdout, process.stdout);
  bindPrefixedOutput(service.name, child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    runningChildren.delete(service.name);

    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(
      `[backend] ${service.name} exited, code=${code ?? "null"} signal=${signal ?? "null"}`,
    );

    void stopChildren(service.name).finally(() => {
      process.exit(code ?? 1);
    });
  });

  runningChildren.set(service.name, child);
}

async function killChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });

      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }

  child.kill("SIGTERM");
}

async function stopChildren(exitedServiceName) {
  const tasks = [];

  for (const [serviceName, child] of runningChildren.entries()) {
    if (serviceName === exitedServiceName) {
      continue;
    }

    tasks.push(killChild(child));
  }

  await Promise.all(tasks);
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[backend] received ${signal}, stopping API and Worker...`);
  await stopChildren();
  process.exit(0);
}

async function main() {
  const config = readConfig();
  const summary = createSummary(config);

  printSummary(summary);

  if (summary.persistenceMode === "db") {
    initializeStorageLayout(config);
    await assertDatabaseReady(summary);
  } else {
    initializeWorkflowAndStorageLayout(config);
  }

  await initializeAccountsStore(config);

  if (checkOnly) {
    console.log("[backend] config check passed.");
    return;
  }

  for (const service of services) {
    if (!fs.existsSync(service.cwd)) {
      throw new Error(`Service directory not found: ${service.cwd}`);
    }
  }

  console.log(`[backend] mode: ${runMode}`);
  console.log("[backend] starting API and Worker. Press Ctrl+C to stop.");

  for (const service of services) {
    spawnService(service);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

main().catch((error) => {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  console.error(`[backend] startup failed: ${message}`);
  process.exit(1);
});
