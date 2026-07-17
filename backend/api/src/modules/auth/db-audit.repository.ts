import type {
  DatabaseConfig,
  DatabasePool,
} from "@newworkflow/backend-shared";
import {
  queryPostgres,
} from "@newworkflow/backend-shared";
import type {
  AuditLogRecord,
  AuditRepository,
  CreateAuditLogInput,
} from "./auth.repository.types.ts";

type DbQueryRow = Record<string, unknown>;

interface AuditLogDbRow extends DbQueryRow {
  id: string;
  actor_user_id: string | null;
  actor_role: AuditLogRecord["actorRole"];
  action: string;
  target_type: string;
  target_id: string | null;
  payload: unknown;
  created_at: Date | string;
}

export interface DbAuditRepositoryOptions {
  pool?: DatabasePool;
}

const AUDIT_SELECT_COLUMNS = `
  id,
  actor_user_id,
  actor_role,
  action,
  target_type,
  target_id,
  payload,
  created_at
`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toAuditLogRecord(row: AuditLogDbRow): AuditLogRecord {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    payload: toPayload(row.payload),
    createdAt: toIsoString(row.created_at),
  };
}

export class DbAuditRepository implements AuditRepository {
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;

  constructor(databaseConfig: DatabaseConfig, options: DbAuditRepositoryOptions = {}) {
    this.databaseConfig = databaseConfig;
    this.pool = options.pool ?? null;
  }

  async ensureInitialized(): Promise<void> {
    await this.query("select 1 as ok");
  }

  async createAuditLog(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const result = await this.query<AuditLogDbRow>(
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
        returning ${AUDIT_SELECT_COLUMNS}
      `,
      [
        input.actorUserId ?? null,
        input.actorRole ?? null,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.payload ? JSON.stringify(input.payload) : null,
      ],
    );

    return toAuditLogRecord(result.rows[0]!);
  }

  async listAuditLogs(limit = 100): Promise<AuditLogRecord[]> {
    const result = await this.query<AuditLogDbRow>(
      `
        select ${AUDIT_SELECT_COLUMNS}
        from audit_logs
        order by created_at desc, id desc
        limit $1
      `,
      [limit],
    );

    return result.rows.map(toAuditLogRecord);
  }

  async listAuditLogsByTargetId(targetId: string, limit = 100): Promise<AuditLogRecord[]> {
    const result = await this.query<AuditLogDbRow>(
      `
        select ${AUDIT_SELECT_COLUMNS}
        from audit_logs
        where target_id = $1
        order by created_at desc, id desc
        limit $2
      `,
      [targetId, limit],
    );

    return result.rows.map(toAuditLogRecord);
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
}
