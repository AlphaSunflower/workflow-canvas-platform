import { randomUUID } from "node:crypto";
import type { RefreshSessionStatus } from "@newworkflow/backend-shared/auth";
import type {
  AccountSessionRecord,
  CreateSessionInput,
  RotateSessionInput,
  SessionRepository as SessionRepositoryInterface,
} from "./auth.repository.types.ts";
import { JsonAccountRepository } from "./json-account.repository.ts";

export class JsonSessionRepository implements SessionRepositoryInterface {
  private readonly store: JsonAccountRepository;

  constructor(rootDir: string) {
    this.store = new JsonAccountRepository(rootDir);
  }

  async ensureInitialized(): Promise<void> {
    await this.store.ensureInitialized();
  }

  async createSession(input: CreateSessionInput): Promise<AccountSessionRecord> {
    return this.store.withStoreLock(async (store) => {
      const now = new Date().toISOString();
      const session: AccountSessionRecord = {
        id: input.sessionId ?? randomUUID(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        status: "active",
        issuedAt: now,
        expiresAt: input.expiresAt,
        rotatedFromSessionId: input.rotatedFromSessionId ?? null,
        revokedAt: null,
        revokedReason: null,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      };

      store.sessions.push(session);
      return session;
    });
  }

  async rotateSession(input: RotateSessionInput): Promise<{
    previousSession: AccountSessionRecord;
    nextSession: AccountSessionRecord;
  }> {
    return this.store.withStoreLock(async (store) => {
      const previousSession = store.sessions.find((session) => session.id === input.previousSessionId);

      if (!previousSession) {
        throw new Error("SESSION_NOT_FOUND");
      }

      if (previousSession.status !== "active") {
        throw new Error("SESSION_NOT_ACTIVE");
      }

      if (store.sessions.some((session) => session.id === input.sessionId)) {
        throw new Error("SESSION_ID_CONFLICT");
      }

      const now = new Date().toISOString();
      previousSession.status = "rotated";
      previousSession.revokedAt = now;
      previousSession.revokedReason = "refresh_token_rotated";

      const nextSession: AccountSessionRecord = {
        id: input.sessionId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        status: "active",
        issuedAt: now,
        expiresAt: input.expiresAt,
        rotatedFromSessionId: input.previousSessionId,
        revokedAt: null,
        revokedReason: null,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      };

      store.sessions.push(nextSession);

      return {
        previousSession: { ...previousSession },
        nextSession,
      };
    });
  }

  async findSessionById(sessionId: string): Promise<AccountSessionRecord | null> {
    return this.store.withStoreLock(async (store) => {
      return store.sessions.find((session) => session.id === sessionId) ?? null;
    });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AccountSessionRecord | null> {
    return this.store.withStoreLock(async (store) => {
      return store.sessions.find((session) => session.tokenHash === tokenHash) ?? null;
    });
  }

  async listSessionsByUserId(userId: string): Promise<AccountSessionRecord[]> {
    return this.store.withStoreLock(async (store) => {
      return store.sessions
        .filter((session) => session.userId === userId)
        .sort((left, right) => left.issuedAt.localeCompare(right.issuedAt));
    });
  }

  async updateSessionStatus(
    sessionId: string,
    status: RefreshSessionStatus,
    options?: {
      revokedAt?: string | null;
      revokedReason?: string | null;
    },
  ): Promise<AccountSessionRecord> {
    return this.store.withStoreLock(async (store) => {
      const session = store.sessions.find((item) => item.id === sessionId);

      if (!session) {
        throw new Error("SESSION_NOT_FOUND");
      }

      session.status = status;

      if (Object.prototype.hasOwnProperty.call(options ?? {}, "revokedAt")) {
        session.revokedAt = options?.revokedAt ?? null;
      }

      if (Object.prototype.hasOwnProperty.call(options ?? {}, "revokedReason")) {
        session.revokedReason = options?.revokedReason ?? null;
      }

      return { ...session };
    });
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
    return this.store.withStoreLock(async (store) => {
      let updatedCount = 0;
      const revokedAt = new Date().toISOString();

      for (const session of store.sessions) {
        if (session.userId !== userId || session.status !== "active") {
          continue;
        }

        session.status = "revoked";
        session.revokedAt = revokedAt;
        session.revokedReason = revokedReason;
        updatedCount += 1;
      }

      return updatedCount;
    });
  }
}

export {
  JsonSessionRepository as SessionRepository,
};
