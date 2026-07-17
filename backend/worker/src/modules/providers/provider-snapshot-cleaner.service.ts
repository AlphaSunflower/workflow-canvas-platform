import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { createLogger } from "@newworkflow/backend-shared";

const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_TEMP_FILE_RETENTION_MS = 3 * 60 * 60 * 1000;

export interface ProviderSnapshotCleanerServiceOptions {
  snapshotDir?: string;
  cleanupIntervalMs?: number;
  tempFileRetentionMs?: number;
}

function parseSnapshotFileTimestamp(fileName: string): number | null {
  const isoPrefixMatch = fileName.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)-/,
  );

  if (!isoPrefixMatch) {
    return null;
  }

  const isoText = isoPrefixMatch[1]?.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)$/,
    "$1:$2:$3",
  );

  if (!isoText) {
    return null;
  }

  const timestamp = Date.parse(isoText);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export class ProviderSnapshotCleanerService {
  private readonly logger = createLogger("provider-snapshot-cleaner");
  private readonly snapshotDir: string;
  private readonly cleanupIntervalMs: number;
  private readonly tempFileRetentionMs: number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private runningCleanup: Promise<void> | null = null;

  constructor(options: ProviderSnapshotCleanerServiceOptions = {}) {
    this.snapshotDir = options.snapshotDir
      ?? path.resolve(process.cwd(), "data/provider-snapshots");
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.tempFileRetentionMs =
      options.tempFileRetentionMs ?? DEFAULT_TEMP_FILE_RETENTION_MS;
  }

  async start(): Promise<void> {
    await this.runCleanup();

    this.intervalHandle = setInterval(() => {
      void this.runCleanup();
    }, this.cleanupIntervalMs);

    this.logger.info("Provider snapshot cleaner started", {
      snapshotDir: this.snapshotDir,
      cleanupIntervalMs: this.cleanupIntervalMs,
      tempFileRetentionMs: this.tempFileRetentionMs,
    });
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    if (this.runningCleanup) {
      await this.runningCleanup;
    }

    this.logger.info("Provider snapshot cleaner stopped", {
      snapshotDir: this.snapshotDir,
    });
  }

  async runCleanup(now = Date.now()): Promise<void> {
    if (this.runningCleanup) {
      return this.runningCleanup;
    }

    this.runningCleanup = this.executeCleanup(now).finally(() => {
      this.runningCleanup = null;
    });

    return this.runningCleanup;
  }

  private async executeCleanup(now: number): Promise<void> {
    let entries: Dirent[];

    try {
      entries = await fs.readdir(this.snapshotDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return;
      }

      throw error;
    }

    let scannedFiles = 0;
    let deletedFiles = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !this.isTempSnapshotFile(entry.name)) {
        continue;
      }

      scannedFiles += 1;
      const absolutePath = path.join(this.snapshotDir, entry.name);
      const deleted = await this.deleteExpiredTempFile(absolutePath, entry.name, now);

      if (deleted) {
        deletedFiles += 1;
      }
    }

    if (deletedFiles > 0) {
      this.logger.info("Provider snapshot cleanup completed", {
        snapshotDir: this.snapshotDir,
        scannedFiles,
        deletedFiles,
      });
    }
  }

  private isTempSnapshotFile(fileName: string): boolean {
    const normalizedName = fileName.toLowerCase();

    if (normalizedName.endsWith(".lock")) {
      return true;
    }

    return normalizedName.endsWith(".json");
  }

  private async deleteExpiredTempFile(
    absolutePath: string,
    fileName: string,
    now: number,
  ): Promise<boolean> {
    const fileTimestamp = parseSnapshotFileTimestamp(fileName);

    if (fileTimestamp === null || now - fileTimestamp < this.tempFileRetentionMs) {
      return false;
    }

    try {
      await fs.rm(absolutePath, { force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }
}
