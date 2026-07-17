import { randomBytes, scryptSync } from "node:crypto";

import type {
  DatabaseConfig,
  DatabasePool,
  TransactionClient,
} from "@newworkflow/backend-shared";
import {
  queryPostgres,
  withTransaction,
} from "@newworkflow/backend-shared";
import type {
  AccountRepository,
  AccountUserRecord,
  CreateAccountInput,
  EnsureBootstrapAdminInput,
  UpdateAccountInput,
} from "./auth.repository.types.ts";

type QueryExecutor = Pick<TransactionClient, "query">;
type DbQueryRow = Record<string, unknown>;

interface UserDbRow extends DbQueryRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: AccountUserRecord["role"];
  status: AccountUserRecord["status"];
  last_login_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface DbAccountRepositoryOptions {
  pool?: DatabasePool;
}

const USER_SELECT_COLUMNS = `
  id,
  email,
  password_hash,
  display_name,
  role,
  status,
  last_login_at,
  created_at,
  updated_at
`;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function createPasswordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function toUserRecord(row: UserDbRow): AccountUserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastLoginAt: toIsoString(row.last_login_at),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
  };
}

export class DbAccountRepository implements AccountRepository {
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;

  constructor(databaseConfig: DatabaseConfig, options: DbAccountRepositoryOptions = {}) {
    this.databaseConfig = databaseConfig;
    this.pool = options.pool ?? null;
  }

  async ensureInitialized(): Promise<void> {
    await this.query("select 1 as ok");
  }

  async ensureBootstrapAdmin(input: EnsureBootstrapAdminInput): Promise<AccountUserRecord> {
    return this.withTransaction(async (client) => {
      const normalizedEmail = normalizeEmail(input.email);
      const existing = await this.findUserByEmailWithExecutor(client, normalizedEmail);

      if (existing) {
        return existing;
      }

      const result = await client.query<UserDbRow>(
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
          returning ${USER_SELECT_COLUMNS}
        `,
        [
          normalizedEmail,
          createPasswordHash(input.password),
          input.displayName.trim() || "System Admin",
        ],
      );
      const user = toUserRecord(result.rows[0]!);

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
          user.id,
          "admin",
          "bootstrap_admin_created",
          "user",
          user.id,
          JSON.stringify({
            email: user.email,
            displayName: user.displayName,
          }),
        ],
      );

      return user;
    });
  }

  async createUser(input: CreateAccountInput): Promise<AccountUserRecord> {
    try {
      const result = await this.query<UserDbRow>(
        `
          insert into users (
            email,
            password_hash,
            display_name,
            role,
            status,
            last_login_at
          )
          values ($1, $2, $3, $4, $5, null)
          returning ${USER_SELECT_COLUMNS}
        `,
        [
          normalizeEmail(input.email),
          input.passwordHash,
          input.displayName.trim(),
          input.role,
          input.status ?? "enabled",
        ],
      );

      return toUserRecord(result.rows[0]!);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new Error("ACCOUNT_EMAIL_CONFLICT");
      }

      throw error;
    }
  }

  async findUserById(userId: string): Promise<AccountUserRecord | null> {
    const result = await this.query<UserDbRow>(
      `
        select ${USER_SELECT_COLUMNS}
        from users
        where id = $1
        limit 1
      `,
      [userId],
    );

    return result.rows[0] ? toUserRecord(result.rows[0]) : null;
  }

  async findUserByEmail(email: string): Promise<AccountUserRecord | null> {
    return this.findUserByEmailWithExecutor(this, normalizeEmail(email));
  }

  async listUsers(): Promise<AccountUserRecord[]> {
    const result = await this.query<UserDbRow>(
      `
        select ${USER_SELECT_COLUMNS}
        from users
        order by created_at asc, id asc
      `,
    );

    return result.rows.map(toUserRecord);
  }

  async updateUser(userId: string, input: UpdateAccountInput): Promise<AccountUserRecord> {
    const current = await this.findUserById(userId);

    if (!current) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    const next = {
      email: typeof input.email === "string" ? normalizeEmail(input.email) : current.email,
      displayName: typeof input.displayName === "string" ? input.displayName.trim() : current.displayName,
      passwordHash: typeof input.passwordHash === "string" ? input.passwordHash : current.passwordHash,
      role: input.role ?? current.role,
      status: input.status ?? current.status,
      lastLoginAt: Object.prototype.hasOwnProperty.call(input, "lastLoginAt")
        ? input.lastLoginAt ?? null
        : current.lastLoginAt,
    };

    try {
      const result = await this.query<UserDbRow>(
        `
          update users
          set
            email = $2,
            password_hash = $3,
            display_name = $4,
            role = $5,
            status = $6,
            last_login_at = $7,
            updated_at = now()
          where id = $1
          returning ${USER_SELECT_COLUMNS}
        `,
        [
          userId,
          next.email,
          next.passwordHash,
          next.displayName,
          next.role,
          next.status,
          next.lastLoginAt,
        ],
      );

      if (!result.rows[0]) {
        throw new Error("ACCOUNT_NOT_FOUND");
      }

      return toUserRecord(result.rows[0]);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new Error("ACCOUNT_EMAIL_CONFLICT");
      }

      throw error;
    }
  }

  async query<T extends DbQueryRow = DbQueryRow>(
    text: string,
    values?: readonly unknown[],
  ) {
    if (this.pool) {
      return this.pool.query<T>(text, values);
    }

    return queryPostgres<T>(this.databaseConfig, text, values);
  }

  private async findUserByEmailWithExecutor(
    executor: QueryExecutor,
    normalizedEmail: string,
  ): Promise<AccountUserRecord | null> {
    const result = await executor.query<UserDbRow>(
      `
        select ${USER_SELECT_COLUMNS}
        from users
        where email = $1
        limit 1
      `,
      [normalizedEmail],
    );

    return result.rows[0] ? toUserRecord(result.rows[0]) : null;
  }

  private async withTransaction<T>(
    callback: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (this.pool) {
      return withTransaction(this.pool, callback);
    }

    return withTransaction(this.databaseConfig, callback);
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === "object"
      && error !== null
      && (error as { code?: unknown }).code === "23505";
  }
}
