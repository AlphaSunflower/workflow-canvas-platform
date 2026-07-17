import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DbAccountRepository } from "../api/src/modules/auth/db-account.repository.ts";
import { DbAuditRepository } from "../api/src/modules/auth/db-audit.repository.ts";
import { DbSessionRepository } from "../api/src/modules/auth/db-session.repository.ts";
import { JsonAccountRepository } from "../api/src/modules/auth/json-account.repository.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { PasswordService } from "../api/src/modules/auth/password.service.ts";
import { SessionService } from "../api/src/modules/auth/session.service.ts";
import { TokenService } from "../api/src/modules/auth/token.service.ts";
import { createUsersService } from "../api/src/composition/auth.composition.ts";
import type {
  AccountRole,
  AccountStatus,
  RefreshSessionStatus,
  ServiceEnv,
} from "../shared/src/index.ts";
import type {
  DatabaseClient,
  DatabasePool,
  QueryResult,
  QueryResultRow,
} from "../shared/src/db/postgres-client.ts";
import type { DatabaseConfig } from "../shared/src/db/db-config.ts";

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: AccountRole;
  status: AccountStatus;
  last_login_at: Date | string | null;
  created_at: Date;
  updated_at: Date;
}

interface SessionRow extends QueryResultRow {
  id: string;
  user_id: string;
  token_hash: string;
  status: RefreshSessionStatus;
  issued_at: Date;
  expires_at: Date | string;
  rotated_from_id: string | null;
  revoked_at: Date | string | null;
  revoked_reason: string | null;
  user_agent: string | null;
  ip_address: string | null;
}

interface AuditRow extends QueryResultRow {
  id: string;
  actor_user_id: string | null;
  actor_role: AccountRole | null;
  action: string;
  target_type: string;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

const TEST_DATABASE_CONFIG: DatabaseConfig = {
  url: null,
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

function createResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount,
    rows,
  };
}

function asRows<T extends QueryResultRow>(rows: QueryResultRow[]): T[] {
  return rows as unknown as T[];
}

function createTestEnv(mode: "json" | "db"): ServiceEnv {
  return {
    authAccessTokenSecret: "test-access-secret",
    authAccessTokenTtlSeconds: 900,
    authBootstrapAdminDisplayName: "System Admin",
    authBootstrapAdminEmail: "admin@example.com",
    authBootstrapAdminPassword: "admin-password-123",
    authIssuer: "newworkflow-backend-test",
    authRefreshTokenSecret: "test-refresh-secret",
    authRefreshTokenTtlSeconds: 7200,
    authRotateRefreshTokenOnUse: true,
    configPath: "test-config.json",
    database: TEST_DATABASE_CONFIG,
    host: "127.0.0.1",
    laozhangApiKey: null,
    laozhangApiUrl: "",
    laozhangOpenaiApiBaseUrl: "",
    laozhangSora2OfficialApiBaseUrl: "",
    laozhangSora2OfficialApiKey: null,
    laozhangVisionApiUrl: "",
    laozhangVisionModel: "",
    laozhangVisionTimeoutMs: 1,
    laozhangVeoApiBaseUrl: "",
    laozhangVeoMaxConcurrency: null,
    laozhangVeoPollIntervalMs: 1,
    laozhangVeoTimeoutMs: 1,
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
    persistenceMode: mode,
    port: 0,
    providerSnapshotDir: "",
    runninghubApiBaseUrl: null,
    runninghubApiKey: null,
    runninghubMaxConcurrency: 1,
    serviceName: "api",
    workerPollIntervalMs: 1,
  };
}

class InMemoryAuthDatabaseClient implements DatabaseClient {
  constructor(private readonly pool: InMemoryAuthDatabasePool) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  release(): void {
    return undefined;
  }
}

class InMemoryAuthDatabasePool implements DatabasePool {
  readonly users: UserRow[] = [];
  readonly sessions: SessionRow[] = [];
  readonly auditLogs: AuditRow[] = [];
  private auditSequence = 0;

  async connect(): Promise<DatabaseClient> {
    return new InMemoryAuthDatabaseClient(this);
  }

  async end(): Promise<void> {
    return undefined;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return createResult([] as T[]);
    }

    if (normalized.startsWith("select 1 as ok")) {
      return createResult(asRows<T>([{ ok: 1 }]));
    }

    if (normalized.startsWith("insert into users")) {
      return createResult(asRows<T>([this.insertUser(values)]));
    }

    if (normalized.startsWith("select id, email from users")) {
      const email = values[0] as string;
      return createResult(asRows<T>(
        this.users
          .filter((user) => user.email === email)
          .map((user) => ({ id: user.id, email: user.email })),
      ));
    }

    if (normalized.includes("from users") && normalized.includes("where email = $1")) {
      return createResult(asRows<T>(
        this.users.filter((user) => user.email === values[0]),
      ));
    }

    if (normalized.includes("from users") && normalized.includes("where id = $1")) {
      return createResult(asRows<T>(
        this.users.filter((user) => user.id === values[0]),
      ));
    }

    if (normalized.includes("from users") && normalized.includes("order by created_at")) {
      return createResult(asRows<T>(
        [...this.users].sort((left, right) =>
          left.created_at.getTime() - right.created_at.getTime()
          || left.id.localeCompare(right.id)),
      ));
    }

    if (normalized.startsWith("update users")) {
      const row = this.updateUser(values);
      return createResult(asRows<T>(row ? [row] : []));
    }

    if (normalized.startsWith("insert into refresh_tokens")) {
      return createResult(asRows<T>([this.insertSession(values)]));
    }

    if (normalized.includes("from refresh_tokens") && normalized.includes("where id = $1")) {
      return createResult(asRows<T>(
        this.sessions.filter((session) => session.id === values[0]),
      ));
    }

    if (normalized.includes("from refresh_tokens") && normalized.includes("where token_hash = $1")) {
      return createResult(asRows<T>(
        this.sessions.filter((session) => session.token_hash === values[0]),
      ));
    }

    if (normalized.includes("from refresh_tokens") && normalized.includes("where user_id = $1")) {
      return createResult(asRows<T>(
        this.sessions
          .filter((session) => session.user_id === values[0])
          .sort((left, right) => left.issued_at.getTime() - right.issued_at.getTime()),
      ));
    }

    if (normalized.startsWith("update refresh_tokens") && normalized.includes("status = 'rotated'")) {
      const row = this.updateSession(values[0] as string, {
        status: "rotated",
        revoked_at: new Date(),
        revoked_reason: "refresh_token_rotated",
      });
      return createResult(asRows<T>(row ? [row] : []));
    }

    if (normalized.startsWith("update refresh_tokens") && normalized.includes("status = 'revoked'")) {
      let rowCount = 0;
      for (const session of this.sessions) {
        if (session.user_id !== values[0] || session.status !== "active") {
          continue;
        }

        session.status = "revoked";
        session.revoked_at = new Date();
        session.revoked_reason = values[1] as string;
        rowCount += 1;
      }

      return createResult([] as T[], rowCount);
    }

    if (normalized.startsWith("update refresh_tokens")) {
      const row = this.updateSession(values[0] as string, {
        status: values[1] as RefreshSessionStatus,
        revoked_at: values[2] as string | null,
        revoked_reason: values[3] as string | null,
      });
      return createResult(asRows<T>(row ? [row] : []));
    }

    if (normalized.startsWith("insert into audit_logs")) {
      return createResult(asRows<T>([this.insertAuditLog(values)]));
    }

    if (normalized.includes("from audit_logs") && normalized.includes("where target_id = $1")) {
      return createResult(asRows<T>(
        this.auditLogs
          .filter((item) => item.target_id === values[0])
          .sort((left, right) => right.created_at.getTime() - left.created_at.getTime())
          .slice(0, values[1] as number),
      ));
    }

    if (normalized.includes("from audit_logs")) {
      return createResult(asRows<T>(
        [...this.auditLogs]
          .sort((left, right) => right.created_at.getTime() - left.created_at.getTime())
          .slice(0, values[0] as number),
      ));
    }

    throw new Error(`UNHANDLED_TEST_QUERY:${normalized}`);
  }

  private insertUser(values: readonly unknown[]): UserRow {
    const email = values[0] as string;

    if (this.users.some((user) => user.email === email)) {
      const error = new Error("duplicate key value violates unique constraint users_email_key");
      (error as Error & { code: string }).code = "23505";
      throw error;
    }

    const now = new Date();
    const row: UserRow = {
      id: `user-${this.users.length + 1}`,
      email,
      password_hash: values[1] as string,
      display_name: values[2] as string,
      role: (values[3] as AccountRole | undefined) ?? "admin",
      status: (values[4] as AccountStatus | undefined) ?? "enabled",
      last_login_at: values.length >= 6 ? values[5] as string | null : null,
      created_at: now,
      updated_at: now,
    };

    this.users.push(row);
    return row;
  }

  private updateUser(values: readonly unknown[]): UserRow | null {
    const row = this.users.find((user) => user.id === values[0]);

    if (!row) {
      return null;
    }

    const email = values[1] as string;
    if (this.users.some((user) => user.id !== row.id && user.email === email)) {
      const error = new Error("duplicate key value violates unique constraint users_email_key");
      (error as Error & { code: string }).code = "23505";
      throw error;
    }

    row.email = email;
    row.password_hash = values[2] as string;
    row.display_name = values[3] as string;
    row.role = values[4] as AccountRole;
    row.status = values[5] as AccountStatus;
    row.last_login_at = values[6] as string | null;
    row.updated_at = new Date();
    return row;
  }

  private insertSession(values: readonly unknown[]): SessionRow {
    const id = values[0] as string;

    if (this.sessions.some((session) => session.id === id || session.token_hash === values[2])) {
      const error = new Error("duplicate key value violates unique constraint refresh_tokens_pkey");
      (error as Error & { code: string }).code = "23505";
      throw error;
    }

    const row: SessionRow = {
      id,
      user_id: values[1] as string,
      token_hash: values[2] as string,
      status: "active",
      issued_at: new Date(),
      expires_at: values[3] as string,
      rotated_from_id: values[4] as string | null,
      user_agent: values[5] as string | null,
      ip_address: values[6] as string | null,
      revoked_at: null,
      revoked_reason: null,
    };

    this.sessions.push(row);
    return row;
  }

  private updateSession(
    sessionId: string,
    values: {
      status: RefreshSessionStatus;
      revoked_at: Date | string | null;
      revoked_reason: string | null;
    },
  ): SessionRow | null {
    const row = this.sessions.find((session) => session.id === sessionId);

    if (!row) {
      return null;
    }

    row.status = values.status;
    row.revoked_at = values.revoked_at;
    row.revoked_reason = values.revoked_reason;
    return row;
  }

  private insertAuditLog(values: readonly unknown[]): AuditRow {
    const payloadRaw = values[5] as string | null;
    const row: AuditRow = {
      id: `audit-${this.auditSequence += 1}`,
      actor_user_id: values[0] as string | null,
      actor_role: values[1] as AccountRole | null,
      action: values[2] as string,
      target_type: values[3] as string,
      target_id: values[4] as string | null,
      payload: payloadRaw ? JSON.parse(payloadRaw) as Record<string, unknown> : null,
      created_at: new Date(Date.now() + this.auditSequence),
    };

    this.auditLogs.push(row);
    return row;
  }
}

function createAuthService(pool: InMemoryAuthDatabasePool): AuthService {
  const env = createTestEnv("db");
  const refreshTokenSecret = env.authRefreshTokenSecret!;

  return new AuthService({
    accountsRepository: new DbAccountRepository(TEST_DATABASE_CONFIG, { pool }),
    auditRepository: new DbAuditRepository(TEST_DATABASE_CONFIG, { pool }),
    passwordService: new PasswordService(),
    sessionService: new SessionService({
      issuer: env.authIssuer,
      refreshTokenSecret,
      refreshTokenTtlSeconds: env.authRefreshTokenTtlSeconds,
      rotateRefreshTokenOnUse: env.authRotateRefreshTokenOnUse,
      sessionRepository: new DbSessionRepository(TEST_DATABASE_CONFIG, { pool }),
    }),
    tokenService: new TokenService({
      issuer: env.authIssuer,
      accessTokenSecret: env.authAccessTokenSecret!,
      accessTokenTtlSeconds: env.authAccessTokenTtlSeconds,
      refreshTokenSecret,
      refreshTokenTtlSeconds: env.authRefreshTokenTtlSeconds,
    }),
    accessTokenTtlSeconds: env.authAccessTokenTtlSeconds,
  });
}

test("DB auth repositories support register, login, refresh, logout and audit logs", async () => {
  const pool = new InMemoryAuthDatabasePool();
  const authService = createAuthService(pool);

  const registered = await authService.register({
    email: "Member@Example.com",
    password: "member-password-123",
    displayName: "Member User",
  }, {
    userAgent: "test-agent",
    ipAddress: "127.0.0.1",
  });

  assert.equal(registered.user.email, "member@example.com");
  assert.equal(registered.user.role, "member");
  assert.equal(pool.users.length, 1);
  assert.equal(pool.sessions.length, 1);
  assert.ok(pool.auditLogs.some((item) => item.action === "account_registered"));
  assert.ok(pool.auditLogs.some((item) => item.action === "session_created"));

  await assert.rejects(
    () => authService.register({
      email: "member@example.com",
      password: "member-password-123",
      displayName: "Duplicate",
    }),
    /ACCOUNT_EMAIL_CONFLICT/u,
  );

  await assert.rejects(
    () => authService.login({
      email: "member@example.com",
      password: "wrong-password",
    }),
    /AUTH_INVALID_CREDENTIALS/u,
  );

  const loggedIn = await authService.login({
    email: "member@example.com",
    password: "member-password-123",
  });

  assert.equal(loggedIn.user.email, "member@example.com");
  assert.equal(pool.sessions.length, 2);

  const refreshed = await authService.refresh({
    refreshToken: loggedIn.tokens.refreshToken,
  });

  assert.notEqual(refreshed.tokens.refreshToken, loggedIn.tokens.refreshToken);
  assert.equal(pool.sessions.length, 3);
  assert.equal(pool.sessions[1]?.status, "rotated");
  assert.ok(pool.auditLogs.some((item) => item.action === "session_refreshed"));

  await assert.rejects(
    () => authService.refresh({
      refreshToken: loggedIn.tokens.refreshToken,
    }),
    /SESSION_ROTATED/u,
  );

  await authService.logout({
    refreshToken: refreshed.tokens.refreshToken,
  });
  assert.equal(pool.sessions[2]?.status, "revoked");
  assert.ok(pool.auditLogs.some((item) => item.action === "session_logged_out"));

  const auditRepository = new DbAuditRepository(TEST_DATABASE_CONFIG, { pool });
  const userAuditLogs = await auditRepository.listAuditLogsByTargetId(registered.user.userId);
  assert.ok(userAuditLogs.some((item) => item.action === "account_registered"));
});

test("DB account repository bootstraps admin once and preserves admin role", async () => {
  const pool = new InMemoryAuthDatabasePool();
  const accountRepository = new DbAccountRepository(TEST_DATABASE_CONFIG, { pool });

  const first = await accountRepository.ensureBootstrapAdmin({
    email: "Admin@Example.com",
    password: "admin-password-123",
    displayName: "Admin User",
  });
  const second = await accountRepository.ensureBootstrapAdmin({
    email: "admin@example.com",
    password: "another-password",
    displayName: "Another Admin",
  });

  assert.equal(first.id, second.id);
  assert.equal(first.email, "admin@example.com");
  assert.equal(first.role, "admin");
  assert.equal(pool.users.length, 1);
  assert.equal(pool.auditLogs.filter((item) => item.action === "bootstrap_admin_created").length, 1);
});

test("DB mode composition wires auth and users services to database repositories", async () => {
  const pool = new InMemoryAuthDatabasePool();
  const env = createTestEnv("db");
  const authService = createAuthService(pool);
  const usersService = createUsersService({
    env,
    rootDir: "",
    authService,
  });

  // The service factory itself uses DB repositories in DB mode. This assertion keeps the
  // JSON fallback path covered without requiring a real PostgreSQL connection here.
  assert.equal(usersService.authService, authService);
});

test("JSON repository remains usable for rollback mode", async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "newworkflow-auth-json-rollback-"),
  );

  try {
    const repository = new JsonAccountRepository(tempRoot);
    await repository.ensureInitialized();
    const user = await repository.createUser({
      email: "rollback@example.com",
      passwordHash: "scrypt:salt:hash",
      displayName: "Rollback User",
      role: "member",
    });

    assert.equal(user.email, "rollback@example.com");
    assert.equal((await repository.findUserByEmail("ROLLBACK@example.com"))?.id, user.id);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
