import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  createEmptyWorkflowFileBindingStore,
  type WorkflowFileBindingRecord,
  type WorkflowFileBindingStore,
} from "./workflow-file-binding.types.ts";
import type { WorkflowFilesRepository } from "./workflow.repository.types.ts";

export class JsonWorkflowFilesRepository implements WorkflowFilesRepository {
  private readonly workflowsDir: string;
  private readonly lockRetryDelayMs = 25;
  private readonly lockTimeoutMs = 5_000;
  private readonly staleLockThresholdMs = 30_000;
  private readonly unlockRetryCount = 3;

  constructor(rootDir: string) {
    this.workflowsDir = path.join(rootDir, "data", "workflows");
  }

  async ensureInitialized(workflowId: string): Promise<void> {
    await this.withWorkflowFilesLock(workflowId, async () => {
      await this.ensureInitializedUnsafe(workflowId);
    });
  }

  async listBindings(workflowId: string): Promise<WorkflowFileBindingRecord[]> {
    return this.withWorkflowFilesLock(workflowId, async () => {
      const store = await this.readStoreUnsafe(workflowId);
      return [...store.items];
    });
  }

  async replaceBindings(
    workflowId: string,
    bindings: WorkflowFileBindingRecord[],
  ): Promise<void> {
    await this.withWorkflowFilesLock(workflowId, async () => {
      await this.writeStoreUnsafe(workflowId, { items: bindings });
    });
  }

  async deleteBindings(workflowId: string): Promise<void> {
    await fs.rm(this.getStorePath(workflowId), { force: true });
  }

  private getWorkflowDir(workflowId: string): string {
    return path.join(this.workflowsDir, workflowId);
  }

  private getStorePath(workflowId: string): string {
    return path.join(this.getWorkflowDir(workflowId), "files.json");
  }

  private getLockPath(workflowId: string): string {
    return path.join(this.getWorkflowDir(workflowId), "files.lock");
  }

  private async ensureInitializedUnsafe(workflowId: string): Promise<void> {
    const workflowDir = this.getWorkflowDir(workflowId);
    await fs.mkdir(workflowDir, { recursive: true });

    try {
      await fs.access(this.getStorePath(workflowId));
    } catch {
      await this.writeJsonAtomic(
        this.getStorePath(workflowId),
        createEmptyWorkflowFileBindingStore(),
      );
    }
  }

  private async readStoreUnsafe(workflowId: string): Promise<WorkflowFileBindingStore> {
    await this.ensureInitializedUnsafe(workflowId);
    const raw = await fs.readFile(this.getStorePath(workflowId), "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkflowFileBindingStore>;
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  }

  private async writeStoreUnsafe(
    workflowId: string,
    store: WorkflowFileBindingStore,
  ): Promise<void> {
    await this.writeJsonAtomic(this.getStorePath(workflowId), store);
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tempPath, filePath);
  }

  private async withWorkflowFilesLock<T>(
    workflowId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const workflowDir = this.getWorkflowDir(workflowId);
    await fs.mkdir(workflowDir, { recursive: true });
    return this.withLock(this.getLockPath(workflowId), action);
  }

  private async withLock<T>(lockPath: string, action: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();

    while (true) {
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

      try {
        handle = await fs.open(lockPath, "wx");
      } catch (error) {
        if (!this.isLockConflictError(error)) {
          throw error;
        }

        await this.cleanupStaleLockIfNeeded(lockPath);

        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new Error("WORKFLOW_FILE_BINDINGS_LOCK_TIMEOUT");
        }

        await this.delay(this.lockRetryDelayMs);
        continue;
      }

      try {
        return await action();
      } finally {
        await handle.close();
        await this.releaseLockFile(lockPath);
      }
    }
  }

  private isLockConflictError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "EEXIST" || code === "EPERM" || code === "EACCES";
  }

  private async cleanupStaleLockIfNeeded(lockPath: string): Promise<void> {
    try {
      const stat = await fs.stat(lockPath);

      if (Date.now() - stat.mtimeMs < this.staleLockThresholdMs) {
        return;
      }

      await fs.rm(lockPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async releaseLockFile(lockPath: string): Promise<void> {
    for (let attempt = 0; attempt <= this.unlockRetryCount; attempt += 1) {
      try {
        await fs.rm(lockPath, { force: true });
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
