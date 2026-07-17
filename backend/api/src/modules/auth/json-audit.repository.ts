import { randomUUID } from "node:crypto";
import type {
  AuditLogRecord,
  AuditRepository as AuditRepositoryInterface,
  CreateAuditLogInput,
} from "./auth.repository.types.ts";
import { JsonAccountRepository } from "./json-account.repository.ts";

export class JsonAuditRepository implements AuditRepositoryInterface {
  private readonly store: JsonAccountRepository;

  constructor(rootDir: string) {
    this.store = new JsonAccountRepository(rootDir);
  }

  async ensureInitialized(): Promise<void> {
    await this.store.ensureInitialized();
  }

  async createAuditLog(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    return this.store.withStoreLock(async (store) => {
      const record: AuditLogRecord = {
        id: randomUUID(),
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        payload: input.payload ?? null,
        createdAt: new Date().toISOString(),
      };

      store.auditLogs.push(record);
      return record;
    });
  }

  async listAuditLogs(limit = 100): Promise<AuditLogRecord[]> {
    return this.store.withStoreLock(async (store) => {
      return [...store.auditLogs]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    });
  }

  async listAuditLogsByTargetId(targetId: string, limit = 100): Promise<AuditLogRecord[]> {
    return this.store.withStoreLock(async (store) => {
      return store.auditLogs
        .filter((item) => item.targetId === targetId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    });
  }
}

export {
  JsonAuditRepository as AuditRepository,
};
