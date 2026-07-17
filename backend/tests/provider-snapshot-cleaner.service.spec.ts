import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ProviderSnapshotCleanerService } from "../worker/src/modules/providers/provider-snapshot-cleaner.service.ts";

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "provider-snapshot-cleaner-test-"));

  try {
    const snapshotDir = path.join(rootDir, "provider-snapshots");
    await fs.mkdir(snapshotDir, { recursive: true });

    const cleanupNow = Date.parse("2026-04-07T04:00:00.000Z");

    const oldJsonPath = path.join(
      snapshotDir,
      "2026-04-07T00-00-00.000Z-old-runninghub.json",
    );
    await writeTextFile(oldJsonPath, "{\"provider\":\"runninghub\"}");

    const oldLockPath = path.join(
      snapshotDir,
      "2026-04-07T00-00-00.000Z-old-runninghub.lock",
    );
    await writeTextFile(oldLockPath, "lock");

    const freshJsonPath = path.join(
      snapshotDir,
      "2026-04-07T03-30-00.000Z-fresh-runninghub.json",
    );
    await writeTextFile(freshJsonPath, "{\"provider\":\"runninghub\"}");

    const invalidNamePath = path.join(snapshotDir, "manual-note.json");
    await writeTextFile(invalidNamePath, "{\"note\":\"keep\"}");

    const cleaner = new ProviderSnapshotCleanerService({
      snapshotDir,
      cleanupIntervalMs: 60_000,
      tempFileRetentionMs: 3 * 60 * 60 * 1000,
    });

    await cleaner.runCleanup(cleanupNow);

    assert.equal(await exists(oldJsonPath), false);
    assert.equal(await exists(oldLockPath), false);
    assert.equal(await exists(freshJsonPath), true);
    assert.equal(await exists(invalidNamePath), true);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
