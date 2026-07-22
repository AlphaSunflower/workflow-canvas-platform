import { constants as fsConstants, createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  ObjectStorageAdapter,
  ObjectStorageReadResult,
  ObjectStorageStreamResult,
} from "./object-storage.adapter.ts";

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

export class LocalObjectStorageAdapter implements ObjectStorageAdapter {
  readonly provider = "local";

  private readonly storageRoot: string;

  constructor(rootDir: string) {
    this.storageRoot = path.resolve(rootDir, "storage");
  }

  async write(storageKey: string, buffer: Buffer | Uint8Array): Promise<void> {
    const absolutePath = this.resolveStoragePath(storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await this.writeAtomic(absolutePath, buffer, { failIfExists: false });
  }

  async writeIfMissing(storageKey: string, buffer: Buffer | Uint8Array): Promise<void> {
    const absolutePath = this.resolveStoragePath(storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    try {
      await this.writeAtomic(absolutePath, buffer, { failIfExists: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") {
        return;
      }

      throw error;
    }
  }

  async read(storageKey: string): Promise<ObjectStorageReadResult> {
    const absolutePath = this.resolveStoragePath(storageKey);
    const [buffer, stat] = await Promise.all([
      fs.readFile(absolutePath),
      fs.stat(absolutePath),
    ]);

    return {
      buffer,
      byteLength: buffer.length,
      storageKey: normalizeStorageKey(storageKey),
      lastModifiedAt: new Date(stat.mtimeMs).toISOString(),
    };
  }

  async readStream(storageKey: string): Promise<ObjectStorageStreamResult> {
    const absolutePath = this.resolveStoragePath(storageKey);
    const stat = await fs.stat(absolutePath);
    const stream = createReadStream(absolutePath);

    return {
      stream,
      byteLength: stat.size,
      storageKey: normalizeStorageKey(storageKey),
      lastModifiedAt: new Date(stat.mtimeMs).toISOString(),
    };
  }

  async copyIfMissing(sourceStorageKey: string, targetStorageKey: string): Promise<void> {
    const sourcePath = this.resolveStoragePath(sourceStorageKey);
    const targetPath = this.resolveStoragePath(targetStorageKey);
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });

    try {
      await fs.link(sourcePath, targetPath);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException | undefined)?.code;

      if (errorCode === "EEXIST") {
        return;
      }

      if (errorCode !== "EPERM" && errorCode !== "EXDEV") {
        throw error;
      }

      try {
        await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
      } catch (copyError) {
        if ((copyError as NodeJS.ErrnoException | undefined)?.code === "EEXIST") {
          return;
        }

        throw copyError;
      }
    }

    await this.syncDirectory(targetDir);
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(this.resolveStoragePath(storageKey));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }

  async deleteIfExists(storageKey: string): Promise<void> {
    const absolutePath = this.resolveStoragePath(storageKey);

    try {
      await fs.unlink(absolutePath);
      await this.syncDirectory(path.dirname(absolutePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return;
      }

      throw error;
    }
  }

  private resolveStoragePath(storageKey: string): string {
    const normalized = normalizeStorageKey(storageKey);
    const absolutePath = path.resolve(this.storageRoot, ...normalized.split("/"));
    const relative = path.relative(this.storageRoot, absolutePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("INVALID_STORAGE_KEY");
    }

    return absolutePath;
  }

  private async writeAtomic(
    absolutePath: string,
    buffer: Buffer | Uint8Array,
    options: { failIfExists: boolean },
  ): Promise<void> {
    const dir = path.dirname(absolutePath);
    const tempPath = path.join(dir, `.${path.basename(absolutePath)}.${randomUUID()}.tmp`);
    const handle = await fs.open(tempPath, options.failIfExists ? "wx" : "w");

    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (options.failIfExists) {
      try {
        await fs.link(tempPath, absolutePath);
      } finally {
        await fs.unlink(tempPath).catch(() => undefined);
      }
    } else {
      await fs.rename(tempPath, absolutePath);
    }

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
