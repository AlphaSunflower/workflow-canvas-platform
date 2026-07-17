import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { WorkflowGroupSummaryItem } from "@newworkflow/backend-shared/api";
import {
  createEmptyWorkflowGroupIndex,
  type WorkflowGroupDocument,
  type WorkflowGroupIndex,
} from "./workflow-storage.types.ts";

export class WorkflowGroupsRepository {
  private readonly workflowsDir: string;
  private readonly indexPath: string;
  private readonly lockPath: string;
  private readonly lockRetryDelayMs = 25;
  private readonly lockTimeoutMs = 5_000;
  private readonly staleLockThresholdMs = 30_000;
  private readonly unlockRetryCount = 3;

  constructor(rootDir: string) {
    this.workflowsDir = path.join(rootDir, "data", "workflows");
    this.indexPath = path.join(this.workflowsDir, "groups-index.json");
    this.lockPath = path.join(this.workflowsDir, "groups-index.lock");
  }

  async ensureInitialized(): Promise<void> {
    await this.withIndexLock(async () => {
      await this.ensureInitializedUnsafe();
    });
  }

  async listByOwner(ownerUserId: string): Promise<WorkflowGroupSummaryItem[]> {
    return this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      return index.items
        .filter((item) => item.ownerUserId === ownerUserId)
        .sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  async listAll(): Promise<WorkflowGroupSummaryItem[]> {
    return this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      return [...index.items].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    });
  }

  async findById(groupId: string): Promise<WorkflowGroupSummaryItem | null> {
    return this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      return index.items.find((item) => item.groupId === groupId) ?? null;
    });
  }

  async upsertGroup(
    input: Omit<WorkflowGroupDocument, "createdAt" | "updatedAt"> & Partial<Pick<WorkflowGroupDocument, "createdAt" | "updatedAt">>,
  ): Promise<WorkflowGroupSummaryItem> {
    const now = new Date().toISOString();
    const nextItem: WorkflowGroupDocument = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };

    await this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      const nextItems = index.items.filter((item) => item.groupId !== nextItem.groupId);
      nextItems.push(nextItem);
      await this.writeIndexUnsafe({ items: nextItems });
    });

    return nextItem;
  }

  async createGroup(ownerUserId: string, name: string): Promise<WorkflowGroupSummaryItem> {
    return this.upsertGroup({
      groupId: randomUUID(),
      ownerUserId,
      name,
      workflowCount: 0,
    });
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      const nextItems = index.items.filter((item) => item.groupId !== groupId);
      await this.writeIndexUnsafe({ items: nextItems });
    });
  }

  async renameGroup(groupId: string, name: string): Promise<WorkflowGroupSummaryItem> {
    return this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      const existing = index.items.find((item) => item.groupId === groupId);

      if (!existing) {
        throw new Error("WORKFLOW_GROUP_NOT_FOUND");
      }

      const nextItem: WorkflowGroupDocument = {
        ...existing,
        name,
        updatedAt: new Date().toISOString(),
      };
      const nextItems = index.items.filter((item) => item.groupId !== groupId);
      nextItems.push(nextItem);
      await this.writeIndexUnsafe({ items: nextItems });
      return nextItem;
    });
  }

  async updateWorkflowCount(groupId: string, workflowCount: number): Promise<WorkflowGroupSummaryItem> {
    return this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      const existing = index.items.find((item) => item.groupId === groupId);

      if (!existing) {
        throw new Error("WORKFLOW_GROUP_NOT_FOUND");
      }

      const nextItem: WorkflowGroupDocument = {
        ...existing,
        workflowCount,
        updatedAt: new Date().toISOString(),
      };
      const nextItems = index.items.filter((item) => item.groupId !== groupId);
      nextItems.push(nextItem);
      await this.writeIndexUnsafe({ items: nextItems });
      return nextItem;
    });
  }

  async replaceAll(groups: WorkflowGroupSummaryItem[]): Promise<void> {
    await this.withIndexLock(async () => {
      await this.writeIndexUnsafe({
        items: groups.map((group) => ({
          ...group,
        })),
      });
    });
  }

  private async ensureInitializedUnsafe(): Promise<void> {
    await fs.mkdir(this.workflowsDir, { recursive: true });

    try {
      await fs.access(this.indexPath);
    } catch {
      await this.writeJsonAtomic(this.indexPath, createEmptyWorkflowGroupIndex());
    }
  }

  private async readIndexUnsafe(): Promise<WorkflowGroupIndex> {
    await this.ensureInitializedUnsafe();
    const raw = await fs.readFile(this.indexPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkflowGroupIndex>;
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  }

  private async writeIndexUnsafe(index: WorkflowGroupIndex): Promise<void> {
    await this.writeJsonAtomic(this.indexPath, index);
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tempPath, filePath);
  }

  private async withIndexLock<T>(action: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.workflowsDir, { recursive: true });
    return this.withLock(this.lockPath, action);
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
          throw new Error("WORKFLOW_GROUP_STORE_LOCK_TIMEOUT");
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
