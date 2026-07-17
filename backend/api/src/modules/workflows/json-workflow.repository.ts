import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  WorkflowDetailResponseData,
  WorkflowSummaryItem,
} from "@newworkflow/backend-shared/api";
import {
  createEmptyWorkflowAccountIndex,
  createEmptyWorkflowSummaryIndex,
  resolveWorkflowContainerKey,
  type StoredWorkflowDocument,
  type WorkflowAccountIndex,
  type WorkflowSummaryIndex,
} from "./workflow-storage.types.ts";
import { WorkflowSummaryMapper } from "./workflow-summary.mapper.ts";

function createWorkflowDetail(document: StoredWorkflowDocument): WorkflowDetailResponseData {
  return {
    workflowId: document.workflowId,
    ownerUserId: document.ownerUserId,
    groupId: document.groupId,
    containerKey: document.containerKey,
    isAutoNamed: document.isAutoNamed,
    workflow: document.workflow,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class JsonWorkflowRepository {
  private readonly dataDir: string;
  private readonly workflowsDir: string;
  private readonly indexPath: string;
  private readonly accountIndexPath: string;
  private readonly indexLockPath: string;
  private readonly summaryMapper: WorkflowSummaryMapper;
  private readonly lockRetryDelayMs = 25;
  private readonly lockTimeoutMs = 5_000;
  private readonly staleLockThresholdMs = 30_000;
  private readonly unlockRetryCount = 3;

  constructor(rootDir: string, summaryMapper: WorkflowSummaryMapper = new WorkflowSummaryMapper()) {
    this.dataDir = path.join(rootDir, "data");
    this.workflowsDir = path.join(this.dataDir, "workflows");
    this.indexPath = path.join(this.workflowsDir, "index.json");
    this.accountIndexPath = path.join(this.workflowsDir, "accounts-index.json");
    this.indexLockPath = path.join(this.workflowsDir, "index.lock");
    this.summaryMapper = summaryMapper;
  }

  async ensureInitialized(): Promise<void> {
    await this.withIndexLock(async () => {
      await this.ensureInitializedUnsafe();
    });
  }

  async listByOwner(ownerUserId: string): Promise<WorkflowSummaryItem[]> {
    return this.withIndexLock(async () => {
      const summaryIndex = await this.readIndexUnsafe();
      const accountIndex = await this.readAccountIndexUnsafe();
      const accountEntry = accountIndex.items.find((item) => item.ownerUserId === ownerUserId);

      if (!accountEntry) {
        return [];
      }

      const ownedWorkflowIds = new Set(accountEntry.workflowIds);
      return summaryIndex.items
        .filter((item) => ownedWorkflowIds.has(item.workflowId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  async listByOwnerAndContainer(
    ownerUserId: string,
    containerKey: string,
  ): Promise<WorkflowSummaryItem[]> {
    const normalizedContainerKey = containerKey.trim();
    const items = await this.listByOwner(ownerUserId);
    return items.filter((item) => item.containerKey === normalizedContainerKey);
  }

  async listAll(): Promise<WorkflowSummaryItem[]> {
    return this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();

      return [...index.items]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  async findSummaryById(workflowId: string): Promise<WorkflowSummaryItem | null> {
    return this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      return index.items.find((item) => item.workflowId === workflowId) ?? null;
    });
  }

  async findById(workflowId: string): Promise<WorkflowDetailResponseData | null> {
    return this.withWorkflowLock(workflowId, async () => {
      const document = await this.readWorkflowUnsafe(workflowId);

      if (!document) {
        return null;
      }

      return createWorkflowDetail(document);
    });
  }

  async createWorkflow(
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    options?: {
      workflowId?: string;
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    const workflowId = options?.workflowId?.trim() || workflow.id?.trim() || randomUUID();
    const groupId = options?.groupId?.trim() || null;
    const now = new Date().toISOString();
    const document: StoredWorkflowDocument = {
      workflowId,
      ownerUserId,
      groupId,
      containerKey: resolveWorkflowContainerKey(groupId),
      isAutoNamed: options?.isAutoNamed ?? false,
      workflow: {
        ...workflow,
        id: workflowId,
        ...(workflow.version !== undefined ? {} : { version: 1 }),
      },
      createdAt: now,
      updatedAt: now,
    };

    await this.withWorkflowLock(workflowId, async () => {
      const existing = await this.readWorkflowUnsafe(workflowId);

      if (existing) {
        throw new Error("WORKFLOW_ALREADY_EXISTS");
      }

      await this.writeWorkflowUnsafe(document);
    });

    await this.upsertSummary(this.summaryMapper.fromDocument(document));
    await this.upsertAccountMembership(ownerUserId, workflowId, now);

    return createWorkflowDetail(document);
  }

  async updateWorkflow(
    workflowId: string,
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    options?: {
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    const updated = await this.withWorkflowLock(workflowId, async () => {
      const existing = await this.readWorkflowUnsafe(workflowId);

      if (!existing) {
        throw new Error("WORKFLOW_NOT_FOUND");
      }

      const groupId = options?.groupId !== undefined
        ? (options.groupId?.trim() || null)
        : existing.groupId;
      const nextVersion = workflow.version ?? (existing.workflow.version ?? 1) + 1;
      const nextDocument: StoredWorkflowDocument = {
        workflowId: existing.workflowId,
        ownerUserId,
        groupId,
        containerKey: resolveWorkflowContainerKey(groupId),
        isAutoNamed: options?.isAutoNamed ?? existing.isAutoNamed,
        workflow: {
          ...workflow,
          id: workflowId,
          version: nextVersion,
        },
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };

      await this.writeWorkflowUnsafe(nextDocument);
      return nextDocument;
    });

    await this.upsertSummary(this.summaryMapper.fromDetail(updated));
    await this.upsertAccountMembership(ownerUserId, workflowId, updated.updatedAt);

    return createWorkflowDetail(updated);
  }

  async updateWorkflowMetadata(
    workflowId: string,
    updates: {
      name?: string;
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    const updated = await this.withWorkflowLock(workflowId, async () => {
      const existing = await this.readWorkflowUnsafe(workflowId);

      if (!existing) {
        throw new Error("WORKFLOW_NOT_FOUND");
      }

      const groupId = updates.groupId !== undefined
        ? (updates.groupId?.trim() || null)
        : existing.groupId;
      const nextDocument: StoredWorkflowDocument = {
        ...existing,
        groupId,
        containerKey: resolveWorkflowContainerKey(groupId),
        isAutoNamed: updates.isAutoNamed ?? existing.isAutoNamed,
        workflow: {
          ...existing.workflow,
          ...(updates.name !== undefined ? { name: updates.name } : {}),
        },
        updatedAt: new Date().toISOString(),
      };

      await this.writeWorkflowUnsafe(nextDocument);
      return nextDocument;
    });

    await this.upsertSummary(this.summaryMapper.fromDetail(updated));
    await this.upsertAccountMembership(updated.ownerUserId, workflowId, updated.updatedAt);

    return createWorkflowDetail(updated);
  }

  async deleteWorkflow(workflowId: string): Promise<WorkflowDetailResponseData> {
    const deleted = await this.withWorkflowLock(workflowId, async () => {
      const existing = await this.readWorkflowUnsafe(workflowId);

      if (!existing) {
        throw new Error("WORKFLOW_NOT_FOUND");
      }

      const workflowDir = this.getWorkflowDir(workflowId);
      const entries = await fs.readdir(workflowDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === "workflow.lock") {
          continue;
        }

        await fs.rm(path.join(workflowDir, entry.name), {
          recursive: entry.isDirectory(),
          force: true,
        });
      }

      return existing;
    });

    await this.removeSummary(workflowId);
    await this.removeAccountMembership(deleted.ownerUserId, workflowId);
    await fs.rm(this.getWorkflowDir(workflowId), { recursive: true, force: true });

    return createWorkflowDetail(deleted);
  }

  async rebuildAccountIndex(): Promise<void> {
    await this.withIndexLock(async () => {
      const summaryIndex = await this.readIndexUnsafe();
      const byOwner = new Map<string, { workflowIds: string[]; updatedAt: string }>();

      summaryIndex.items.forEach((item) => {
        const current = byOwner.get(item.ownerUserId);
        if (!current) {
          byOwner.set(item.ownerUserId, {
            workflowIds: [item.workflowId],
            updatedAt: item.updatedAt,
          });
          return;
        }

        if (!current.workflowIds.includes(item.workflowId)) {
          current.workflowIds.push(item.workflowId);
        }

        if (item.updatedAt > current.updatedAt) {
          current.updatedAt = item.updatedAt;
        }
      });

      await this.writeAccountIndexUnsafe({
        items: Array.from(byOwner.entries()).map(([ownerUserId, item]) => ({
          ownerUserId,
          workflowIds: item.workflowIds.sort(),
          updatedAt: item.updatedAt,
        })),
      });
    });
  }

  private async upsertSummary(summary: WorkflowSummaryItem): Promise<void> {
    await this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      const nextItems = index.items.filter((item) => item.workflowId !== summary.workflowId);
      nextItems.push(summary);
      nextItems.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      await this.writeIndexUnsafe({ items: nextItems });
    });
  }

  private async upsertAccountMembership(
    ownerUserId: string,
    workflowId: string,
    updatedAt: string,
  ): Promise<void> {
    await this.withIndexLock(async () => {
      const accountIndex = await this.readAccountIndexUnsafe();
      const existing = accountIndex.items.find((item) => item.ownerUserId === ownerUserId);

      if (!existing) {
        accountIndex.items.push({
          ownerUserId,
          workflowIds: [workflowId],
          updatedAt,
        });
      } else {
        if (!existing.workflowIds.includes(workflowId)) {
          existing.workflowIds.push(workflowId);
          existing.workflowIds.sort();
        }
        existing.updatedAt = updatedAt;
      }

      await this.writeAccountIndexUnsafe(accountIndex);
    });
  }

  private async removeSummary(workflowId: string): Promise<void> {
    await this.withIndexLock(async () => {
      const index = await this.readIndexUnsafe();
      await this.writeIndexUnsafe({
        items: index.items.filter((item) => item.workflowId !== workflowId),
      });
    });
  }

  private async removeAccountMembership(
    ownerUserId: string,
    workflowId: string,
  ): Promise<void> {
    await this.withIndexLock(async () => {
      const accountIndex = await this.readAccountIndexUnsafe();
      const nextItems = accountIndex.items
        .map((item) => {
          if (item.ownerUserId !== ownerUserId) {
            return item;
          }

          const nextWorkflowIds = item.workflowIds.filter((id) => id !== workflowId);

          if (nextWorkflowIds.length === 0) {
            return null;
          }

          return {
            ...item,
            workflowIds: nextWorkflowIds,
          };
        })
        .filter((item): item is WorkflowAccountIndex["items"][number] => Boolean(item));

      await this.writeAccountIndexUnsafe({
        items: nextItems,
      });
    });
  }

  private getWorkflowDir(workflowId: string): string {
    return path.join(this.workflowsDir, workflowId);
  }

  private getWorkflowPath(workflowId: string): string {
    return path.join(this.getWorkflowDir(workflowId), "workflow.json");
  }

  private getWorkflowLockPath(workflowId: string): string {
    return path.join(this.getWorkflowDir(workflowId), "workflow.lock");
  }

  private async ensureInitializedUnsafe(): Promise<void> {
    await fs.mkdir(this.workflowsDir, { recursive: true });

    try {
      await fs.access(this.indexPath);
    } catch {
      await this.writeJsonAtomic(this.indexPath, createEmptyWorkflowSummaryIndex());
    }

    try {
      await fs.access(this.accountIndexPath);
    } catch {
      await this.writeJsonAtomic(this.accountIndexPath, createEmptyWorkflowAccountIndex());
    }
  }

  private async readIndexUnsafe(): Promise<WorkflowSummaryIndex> {
    await this.ensureInitializedUnsafe();
    const raw = await fs.readFile(this.indexPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkflowSummaryIndex>;

    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  }

  private async writeIndexUnsafe(index: WorkflowSummaryIndex): Promise<void> {
    await this.writeJsonAtomic(this.indexPath, index);
  }

  private async readAccountIndexUnsafe(): Promise<WorkflowAccountIndex> {
    await this.ensureInitializedUnsafe();
    const raw = await fs.readFile(this.accountIndexPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkflowAccountIndex>;

    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  }

  private async writeAccountIndexUnsafe(index: WorkflowAccountIndex): Promise<void> {
    await this.writeJsonAtomic(this.accountIndexPath, index);
  }

  private async readWorkflowUnsafe(workflowId: string): Promise<StoredWorkflowDocument | null> {
    try {
      const raw = await fs.readFile(this.getWorkflowPath(workflowId), "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredWorkflowDocument>;
      if (!parsed.workflowId || !parsed.ownerUserId || !parsed.workflow) {
        return null;
      }

      const groupId = typeof parsed.groupId === "string" && parsed.groupId.trim()
        ? parsed.groupId.trim()
        : null;

      return {
        workflowId: parsed.workflowId,
        ownerUserId: parsed.ownerUserId,
        groupId,
        containerKey: typeof parsed.containerKey === "string" && parsed.containerKey.trim()
          ? parsed.containerKey
          : resolveWorkflowContainerKey(groupId),
        isAutoNamed: parsed.isAutoNamed === true,
        workflow: parsed.workflow,
        createdAt: parsed.createdAt ?? new Date().toISOString(),
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private async writeWorkflowUnsafe(document: StoredWorkflowDocument): Promise<void> {
    const workflowDir = this.getWorkflowDir(document.workflowId);
    await fs.mkdir(workflowDir, { recursive: true });
    await this.writeJsonAtomic(this.getWorkflowPath(document.workflowId), document);
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tempPath, filePath);
  }

  private async withIndexLock<T>(action: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.workflowsDir, { recursive: true });
    return this.withLock(this.indexLockPath, action);
  }

  private async withWorkflowLock<T>(workflowId: string, action: () => Promise<T>): Promise<T> {
    const workflowDir = this.getWorkflowDir(workflowId);
    await fs.mkdir(workflowDir, { recursive: true });
    return this.withLock(this.getWorkflowLockPath(workflowId), action);
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
          throw new Error("WORKFLOW_STORE_LOCK_TIMEOUT");
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
