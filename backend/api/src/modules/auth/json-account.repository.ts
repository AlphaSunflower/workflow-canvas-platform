import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  AccountRepository,
  AccountUserRecord,
  AccountsStore,
  CreateAccountInput,
  EnsureBootstrapAdminInput,
  UpdateAccountInput,
} from "./auth.repository.types.ts";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function createPasswordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

async function ensureDirectory(pathname: string): Promise<void> {
  await fs.mkdir(pathname, { recursive: true });
}

export class JsonAccountRepository implements AccountRepository {
  private readonly dataDir: string;
  private readonly storePath: string;
  private readonly lockPath: string;
  private readonly lockRetryDelayMs = 25;
  private readonly lockTimeoutMs = 5_000;
  private readonly staleLockThresholdMs = 30_000;
  private readonly unlockRetryCount = 3;

  constructor(rootDir: string) {
    this.dataDir = path.join(rootDir, "data");
    this.storePath = path.join(this.dataDir, "accounts-store.json");
    this.lockPath = path.join(this.dataDir, "accounts-store.lock");
  }

  async ensureInitialized(): Promise<void> {
    await this.withStoreLock(async () => {
      await this.ensureInitializedUnsafe();
    });
  }

  async ensureBootstrapAdmin(input: EnsureBootstrapAdminInput): Promise<AccountUserRecord> {
    return this.withStoreLock(async (store) => {
      const normalizedEmail = normalizeEmail(input.email);
      const existingUser = store.users.find((user) => user.email === normalizedEmail);

      if (existingUser) {
        return existingUser;
      }

      const now = new Date().toISOString();
      const user: AccountUserRecord = {
        id: randomUUID(),
        email: normalizedEmail,
        passwordHash: createPasswordHash(input.password),
        displayName: input.displayName.trim() || "System Admin",
        role: "admin",
        status: "enabled",
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      };

      store.users.push(user);
      store.auditLogs.push({
        id: randomUUID(),
        actorUserId: user.id,
        actorRole: "admin",
        action: "bootstrap_admin_created",
        targetType: "user",
        targetId: user.id,
        payload: {
          email: user.email,
          displayName: user.displayName,
        },
        createdAt: now,
      });
      return user;
    });
  }

  async createUser(input: CreateAccountInput): Promise<AccountUserRecord> {
    return this.withStoreLock(async (store) => {
      const normalizedEmail = normalizeEmail(input.email);

      if (store.users.some((user) => user.email === normalizedEmail)) {
        throw new Error("ACCOUNT_EMAIL_CONFLICT");
      }

      const now = new Date().toISOString();
      const user: AccountUserRecord = {
        id: randomUUID(),
        email: normalizedEmail,
        passwordHash: input.passwordHash,
        displayName: input.displayName.trim(),
        role: input.role,
        status: input.status ?? "enabled",
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      };

      store.users.push(user);
      return user;
    });
  }

  async findUserById(userId: string): Promise<AccountUserRecord | null> {
    return this.withStoreLock(async (store) => {
      return store.users.find((user) => user.id === userId) ?? null;
    });
  }

  async findUserByEmail(email: string): Promise<AccountUserRecord | null> {
    return this.withStoreLock(async (store) => {
      const normalizedEmail = normalizeEmail(email);
      return store.users.find((user) => user.email === normalizedEmail) ?? null;
    });
  }

  async listUsers(): Promise<AccountUserRecord[]> {
    return this.withStoreLock(async (store) => {
      return [...store.users].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    });
  }

  async updateUser(userId: string, input: UpdateAccountInput): Promise<AccountUserRecord> {
    return this.withStoreLock(async (store) => {
      const user = store.users.find((item) => item.id === userId);

      if (!user) {
        throw new Error("ACCOUNT_NOT_FOUND");
      }

      if (typeof input.email === "string") {
        const normalizedEmail = normalizeEmail(input.email);
        const emailConflict = store.users.some((item) =>
          item.id !== userId && item.email === normalizedEmail
        );

        if (emailConflict) {
          throw new Error("ACCOUNT_EMAIL_CONFLICT");
        }

        user.email = normalizedEmail;
      }

      if (typeof input.displayName === "string") {
        user.displayName = input.displayName.trim();
      }

      if (typeof input.passwordHash === "string") {
        user.passwordHash = input.passwordHash;
      }

      if (input.role) {
        user.role = input.role;
      }

      if (input.status) {
        user.status = input.status;
      }

      if (Object.prototype.hasOwnProperty.call(input, "lastLoginAt")) {
        user.lastLoginAt = input.lastLoginAt ?? null;
      }

      user.updatedAt = new Date().toISOString();
      return { ...user };
    });
  }

  async withStoreLock<T>(action: (store: AccountsStore) => Promise<T>): Promise<T> {
    return this.withLockedStore(action);
  }

  private async withLockedStore<T>(action: (store: AccountsStore) => Promise<T>): Promise<T> {
    await ensureDirectory(this.dataDir);
    const startedAt = Date.now();

    while (true) {
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

      try {
        handle = await fs.open(this.lockPath, "wx");
      } catch (error) {
        if (!this.isLockConflictError(error)) {
          throw error;
        }

        await this.cleanupStaleLockIfNeeded();

        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new Error("ACCOUNTS_STORE_LOCK_TIMEOUT");
        }

        await this.delay(this.lockRetryDelayMs);
        continue;
      }

      try {
        const store = await this.readStoreUnsafe();
        const result = await action(store);
        await this.writeStoreUnsafe(store);
        return result;
      } finally {
        await handle.close();
        await this.releaseLockFile();
      }
    }
  }

  private async ensureInitializedUnsafe(): Promise<void> {
    await ensureDirectory(this.dataDir);

    try {
      await fs.access(this.storePath);
    } catch {
      await fs.writeFile(this.storePath, JSON.stringify({
        users: [],
        sessions: [],
        auditLogs: [],
      }, null, 2), "utf8");
    }
  }

  private async readStoreUnsafe(): Promise<AccountsStore> {
    await this.ensureInitializedUnsafe();
    const raw = await fs.readFile(this.storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AccountsStore>;

    return {
      users: parsed.users ?? [],
      sessions: parsed.sessions ?? [],
      auditLogs: parsed.auditLogs ?? [],
    };
  }

  private async writeStoreUnsafe(store: AccountsStore): Promise<void> {
    await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
  }

  private isLockConflictError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "EEXIST" || code === "EPERM" || code === "EACCES";
  }

  private async cleanupStaleLockIfNeeded(): Promise<void> {
    try {
      const stat = await fs.stat(this.lockPath);

      if (Date.now() - stat.mtimeMs < this.staleLockThresholdMs) {
        return;
      }

      await fs.rm(this.lockPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async releaseLockFile(): Promise<void> {
    for (let attempt = 0; attempt <= this.unlockRetryCount; attempt += 1) {
      try {
        await fs.rm(this.lockPath, { force: true });
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;

        if (code === "ENOENT") {
          return;
        }

        if ((code === "EPERM" || code === "EACCES") && attempt < this.unlockRetryCount) {
          await this.delay(this.lockRetryDelayMs);
          continue;
        }

        throw error;
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

export {
  JsonAccountRepository as AccountsStoreRepository,
};
