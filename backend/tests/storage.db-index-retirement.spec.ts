import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-index-retirement-"));
  const service = new StorageService(new LocalStorageAdapter(rootDir));
  const content = Buffer.from("worker-output-content");
  const sha256 = createHash("sha256").update(content).digest("hex");

  try {
    const saved = await service.saveBuffer({
      sourceType: "output",
      fileType: "image",
      originalName: "worker-output.png",
      mimeType: "image/png",
      buffer: content,
    });

    const storageIndexPath = path.join(rootDir, "data", "storage-index.json");
    await assert.rejects(
      () => fs.access(storageIndexPath),
      /ENOENT/,
    );

    assert.equal(saved.sha256, sha256);
    assert.equal(saved.size, content.length);
    assert.equal(saved.storageProvider, "local");
    assert.equal(saved.storageKey.startsWith("outputs/"), true);
    assert.equal(saved.storageKey.endsWith(".png"), true);

    const read = await service.read(saved.storageKey);
    assert.equal(Buffer.compare(read.buffer, content), 0);
    assert.equal(read.byteLength, content.length);
    assert.equal(await service.stat(saved.storageKey).then((stat) => stat?.byteLength), content.length);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
