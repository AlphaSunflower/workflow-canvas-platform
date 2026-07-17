import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  IntermediateArtifactQuery,
  IntermediateArtifactRecord,
  IntermediateArtifactRepository as IntermediateArtifactRepositoryContract,
} from "./intermediate-artifact.repository.types.ts";

export type {
  IntermediateArtifactQuery,
  IntermediateArtifactRecord,
  IntermediateArtifactRepositoryContract,
};

interface IntermediateArtifactStore {
  artifacts: IntermediateArtifactRecord[];
}

export class IntermediateArtifactRepository implements IntermediateArtifactRepositoryContract {
  private readonly dataDir: string;
  private readonly storePath: string;
  private readonly lockPath: string;
  private readonly lockRetryDelayMs = 25;
  private readonly lockTimeoutMs = 5_000;
  private readonly staleLockThresholdMs = 30_000;
  private readonly unlockRetryCount = 3;

  constructor(rootDir: string) {
    this.dataDir = path.join(rootDir, "data");
    this.storePath = path.join(this.dataDir, "intermediate-artifacts-store.json");
    this.lockPath = path.join(this.dataDir, "intermediate-artifacts-store.lock");
  }

  async findByKey(
    query: IntermediateArtifactQuery,
  ): Promise<IntermediateArtifactRecord | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return this.findRecord(store.artifacts, query) ?? null;
    });
  }

  async touchLastUsed(id: string): Promise<IntermediateArtifactRecord | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const record = store.artifacts.find((item) => item.id === id);

      if (!record) {
        return null;
      }

      record.lastUsedAt = new Date().toISOString();
      record.updatedAt = record.lastUsedAt;
      await this.writeStoreUnsafe(store);
      return { ...record };
    });
  }

  async findOrCreateProcessing(
    query: IntermediateArtifactQuery,
    lastTaskId: string | null,
  ): Promise<{
    record: IntermediateArtifactRecord;
    created: boolean;
    owner: boolean;
  }> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const existing = this.findRecord(store.artifacts, query);

      if (existing) {
        return {
          record: { ...existing },
          created: false,
          owner: false,
        };
      }

      const now = new Date().toISOString();
      const record: IntermediateArtifactRecord = {
        id: randomUUID(),
        sourceBlobId: query.sourceBlobId,
        artifactType: query.artifactType,
        fileId: null,
        provider: query.provider,
        model: query.model,
        pipelineVersion: query.pipelineVersion,
        promptVersion: query.promptVersion,
        imageSize: query.imageSize ?? null,
        aspectRatio: query.aspectRatio ?? null,
        status: "processing",
        lastTaskId,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
      };

      store.artifacts.push(record);
      await this.writeStoreUnsafe(store);

      return {
        record: { ...record },
        created: true,
        owner: true,
      };
    });
  }

  async markReady(input: {
    id: string;
    fileId: string;
    lastTaskId: string | null;
  }): Promise<IntermediateArtifactRecord> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const record = store.artifacts.find((item) => item.id === input.id);

      if (!record) {
        throw new Error("INTERMEDIATE_ARTIFACT_NOT_FOUND");
      }

      const now = new Date().toISOString();
      record.fileId = input.fileId;
      record.status = "ready";
      record.lastTaskId = input.lastTaskId;
      record.updatedAt = now;
      record.lastUsedAt = now;

      await this.writeStoreUnsafe(store);
      return { ...record };
    });
  }

  async markFailed(input: {
    id: string;
    lastTaskId: string | null;
  }): Promise<IntermediateArtifactRecord> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const record = store.artifacts.find((item) => item.id === input.id);

      if (!record) {
        throw new Error("INTERMEDIATE_ARTIFACT_NOT_FOUND");
      }

      record.status = "failed";
      record.lastTaskId = input.lastTaskId;
      record.updatedAt = new Date().toISOString();

      await this.writeStoreUnsafe(store);
      return { ...record };
    });
  }

  private findRecord(
    records: IntermediateArtifactRecord[],
    query: IntermediateArtifactQuery,
  ): IntermediateArtifactRecord | undefined {
    return records.find(
      (record) =>
        record.sourceBlobId === query.sourceBlobId
        && record.artifactType === query.artifactType
        && record.provider === query.provider
        && record.model === query.model
        && record.pipelineVersion === query.pipelineVersion
        && record.promptVersion === query.promptVersion
        && (record.imageSize ?? null) === (query.imageSize ?? null)
        && (record.aspectRatio ?? null) === (query.aspectRatio ?? null),
    );
  }

  private async ensureInitializedUnsafe(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });

    try {
      await fs.access(this.storePath);
    } catch {
      await this.writeStoreUnsafe({
        artifacts: [],
      });
    }
  }

  private async readStoreUnsafe(): Promise<IntermediateArtifactStore> {
    await this.ensureInitializedUnsafe();
    const raw = await fs.readFile(this.storePath, "utf8");
    return JSON.parse(raw) as IntermediateArtifactStore;
  }

  private async writeStoreUnsafe(store: IntermediateArtifactStore): Promise<void> {
    await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
  }

  private async withStoreLock<T>(action: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.dataDir, { recursive: true });
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
          throw new Error("INTERMEDIATE_STORE_LOCK_TIMEOUT");
        }

        await this.delay(this.lockRetryDelayMs);
        continue;
      }

      try {
        return await action();
      } finally {
        await handle.close();
        await this.releaseLockFile();
      }
    }
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
  IntermediateArtifactRepository as JsonIntermediateArtifactRepository,
};
