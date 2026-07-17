import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { ObjectStorageAdapter } from "./object-storage.adapter.ts";
import type {
  StorageReadResult,
  StorageStatResult,
} from "./storage.types.ts";

function normalizeStorageKey(storageKey: string): string {
  const normalized = storageKey.replaceAll("\\", "/");

  if (
    normalized.length === 0 ||
    path.isAbsolute(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error("INVALID_STORAGE_KEY");
  }

  return normalized;
}

export class LocalStorageAdapter implements ObjectStorageAdapter {
  readonly provider = "local";

  private readonly storageRoot: string;

  constructor(rootDir: string) {
    this.storageRoot = path.resolve(rootDir, "storage");
  }

  async write(input: { storageKey: string; buffer: Buffer | Uint8Array }): Promise<void> {
    const absolutePath = this.resolveStoragePath(input.storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await this.writeAtomic(absolutePath, input.buffer);
  }

  async read(storageKey: string): Promise<StorageReadResult> {
    const normalized = normalizeStorageKey(storageKey);
    const absolutePath = this.resolveStoragePath(normalized);
    const [buffer, stat] = await Promise.all([
      fs.readFile(absolutePath),
      fs.stat(absolutePath),
    ]);

    return {
      buffer,
      storageKey: normalized,
      absolutePath,
      byteLength: buffer.length,
      lastModifiedAt: new Date(stat.mtimeMs).toISOString(),
    };
  }

  async stat(storageKey: string): Promise<StorageStatResult | null> {
    const normalized = normalizeStorageKey(storageKey);
    const absolutePath = this.resolveStoragePath(normalized);

    try {
      const stat = await fs.stat(absolutePath);
      return {
        storageKey: normalized,
        absolutePath,
        byteLength: stat.size,
        lastModifiedAt: new Date(stat.mtimeMs).toISOString(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private resolveStoragePath(storageKey: string): string {
    const normalized = normalizeStorageKey(storageKey);
    const absolutePath = path.resolve(this.storageRoot, ...normalized.split("/"));
    const relativePath = path.relative(this.storageRoot, absolutePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("INVALID_STORAGE_KEY");
    }

    return absolutePath;
  }

  private async writeAtomic(
    absolutePath: string,
    buffer: Buffer | Uint8Array,
  ): Promise<void> {
    const dir = path.dirname(absolutePath);
    const tempPath = path.join(dir, `.${path.basename(absolutePath)}.${randomUUID()}.tmp`);
    const handle = await fs.open(tempPath, "w");

    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fs.rename(tempPath, absolutePath);
    await this.syncDirectory(dir);
  }

  private async syncDirectory(dir: string): Promise<void> {
    try {
      const handle = await fs.open(dir, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      // Directory fsync is not available on every Windows filesystem.
    }
  }
}
