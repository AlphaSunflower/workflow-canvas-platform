import type { RefreshSessionStatus } from "@newworkflow/backend-shared/auth";
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
  AccountSessionRecord,
  CreateSessionInput,
  RotateSessionInput,
  SessionRepository,
} from "./auth.repository.types.ts";

type DbQueryRow = Record<string, unknown>;

interface SessionDbRow extends DbQueryRow {
  id: string;
  user_id: string;
  token_hash: string;
  status: RefreshSessionStatus;
  issued_at: Date | string;
  expires_at: Date | string;
  rotated_from_id: string | null;
  revoked_at: Date | string | null;
  revoked_reason: string | null;
  user_agent: string | null;
  ip_address: string | null;
}

export interface DbSessionRepositoryOptions {
  pool?: DatabasePool;
}

const SESSION_SELECT_COLUMNS = `
  id,
  user_id,
  token_hash,
  status,
  issued_at,
  expires_at,
  rotated_from_id,
  revoked_at,
  revoked_reason,
  user_agent,
  ip_address
`;

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function toSessionRecord(row: SessionDbRow): AccountSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    status: row.status,
    issuedAt: toIsoString(row.issued_at) ?? new Date().toISOString(),
    expiresAt: toIsoString(row.expires_at) ?? new Date().toISOString(),
    rotatedFromSessionId: row.rotated_from_id,
    revokedAt: toIsoString(row.revoked_at),
    revokedReason: row.revoked_reason,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
  };
}

export class DbSessionRepository implements SessionRepository {
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;

  constructor(databaseConfig: DatabaseConfig, options: DbSessionRepositoryOptions = {}) {
    this.databaseConfig = databaseConfig;
    this.pool = options.pool ?? null;
  }

  async ensureInitialized(): Promise<void> {
    await this.query("select 1 as ok");
  }

  async createSession(input: CreateSessionInput): Promise<AccountSessionRecord> {
    try {
      const result = await this.query<SessionDbRow>(
        `
          insert into refresh_tokens (
            id,
            user_id,
            token_hash,
            status,
            expires_at,
            rotated_from_id,
            user_agent,
            ip_address
          )
          values ($1, $2, $3, 'active', $4, $5, $6, $7)
          returning ${SESSION_SELECT_COLUMNS}
        `,
        [
          input.sessionId,
          input.userId,
          input.tokenHash,
          input.expiresAt,
          input.rotatedFromSessionId ?? null,
          input.userAgent ?? null,
          input.ipAddress ?? null,
        ],
      );

      return toSessionRecord(result.rows[0]!);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new Error("SESSION_ID_CONFLICT");
      }

      throw error;
    }
  }

  async rotateSession(input: RotateSessionInput): Promise<{
    previousSession: AccountSessionRecord;
    nextSession: AccountSessionRecord;
  }> {
    return this.withTransaction(async (client) => {
      const previousResult = await client.query<SessionDbRow>(
        `
          select ${SESSION_SELECT_COLUMNS}
          from refresh_tokens
          where id = $1
          for update
        `,
        [input.previousSessionId],
      );
      const previousRow = previousResult.rows[0];

      if (!previousRow) {
        throw new Error("SESSION_NOT_FOUND");
      }

      if (previousRow.status !== "active") {
        throw new Error("SESSION_NOT_ACTIVE");
      }

      const rotatedResult = await client.query<SessionDbRow>(
        `
          update refresh_tokens
          set
            status = 'rotated',
            revoked_at = now(),
            revoked_reason = 'refresh_token_rotated'
          where id = $1
          returning ${SESSION_SELECT_COLUMNS}
        `,
        [input.previousSessionId],
      );

      try {
        const nextResult = await client.query<SessionDbRow>(
          `
            insert into refresh_tokens (
              id,
              user_id,
              token_hash,
              status,
              expires_at,
              rotated_from_id,
              user_agent,
              ip_address
            )
            values ($1, $2, $3, 'active', $4, $5, $6, $7)
            returning ${SESSION_SELECT_COLUMNS}
          `,
          [
            input.sessionId,
            input.userId,
            input.tokenHash,
            input.expiresAt,
            input.previousSessionId,
            input.userAgent ?? null,
            input.ipAddress ?? null,
          ],
        );

        return {
          previousSession: toSessionRecord(rotatedResult.rows[0]!),
          nextSession: toSessionRecord(nextResult.rows[0]!),
        };
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          throw new Error("SESSION_ID_CONFLICT");
        }

        throw error;
      }
    });
  }

  async findSessionById(sessionId: string): Promise<AccountSessionRecord | null> {
    const result = await this.query<SessionDbRow>(
      `
        select ${SESSION_SELECT_COLUMNS}
        from refresh_tokens
        where id = $1
        limit 1
      `,
      [sessionId],
    );

    return result.rows[0] ? toSessionRecord(result.rows[0]) : null;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AccountSessionRecord | null> {
    const result = await this.query<SessionDbRow>(
      `
        select ${SESSION_SELECT_COLUMNS}
        from refresh_tokens
        where token_hash = $1
        limit 1
      `,
      [tokenHash],
    );

    return result.rows[0] ? toSessionRecord(result.rows[0]) : null;
  }

  async listSessionsByUserId(userId: string): Promise<AccountSessionRecord[]> {
    const result = await this.query<SessionDbRow>(
      `
        select ${SESSION_SELECT_COLUMNS}
        from refresh_tokens
        where user_id = $1
        order by issued_at asc, id asc
      `,
      [userId],
    );

    return result.rows.map(toSessionRecord);
  }

  async updateSessionStatus(
    sessionId: string,
    status: RefreshSessionStatus,
    options?: {
      revokedAt?: string | null;
      revokedReason?: string | null;
    },
  ): Promise<AccountSessionRecord> {
    const current = await this.findSessionById(sessionId);

    if (!current) {
      throw new Error("SESSION_NOT_FOUND");
    }

    const revokedAt = Object.prototype.hasOwnProperty.call(options ?? {}, "revokedAt")
      ? options?.revokedAt ?? null
      : current.revokedAt;
    const revokedReason = Object.prototype.hasOwnProperty.call(options ?? {}, "revokedReason")
      ? options?.revokedReason ?? null
      : current.revokedReason;
    const result = await this.query<SessionDbRow>(
      `
        update refresh_tokens
        set
          status = $2,
          revoked_at = $3,
          revoked_reason = $4
        where id = $1
        returning ${SESSION_SELECT_COLUMNS}
      `,
      [
        sessionId,
        status,
        revokedAt,
        revokedReason,
      ],
    );

    if (!result.rows[0]) {
      throw new Error("SESSION_NOT_FOUND");
    }

    return toSessionRecord(result.rows[0]);
  }

  async revokeSession(
    sessionId: string,
    revokedReason = "manual_logout",
  ): Promise<AccountSessionRecord> {
    return this.updateSessionStatus(sessionId, "revoked", {
      revokedAt: new Date().toISOString(),
      revokedReason,
    });
  }

  async revokeSessionsByUserId(
    userId: string,
    revokedReason = "user_disabled",
  ): Promise<number> {
    const result = await this.query(
      `
        update refresh_tokens
        set
          status = 'revoked',
          revoked_at = now(),
          revoked_reason = $2
        where user_id = $1
          and status = 'active'
      `,
      [userId, revokedReason],
    );

    return result.rowCount ?? 0;
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
