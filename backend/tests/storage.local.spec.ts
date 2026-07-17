import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-storage-test-"));
  const service = new StorageService(new LocalStorageAdapter(rootDir));

  const inputBuffer = Buffer.from("input-image");
  const intermediateBase64 = Buffer.from("intermediate-image").toString("base64");
  const outputBase64 = Buffer.from("output-image").toString("base64");

  const inputFile = await service.saveBuffer({
    sourceType: "input",
    fileType: "image",
    originalName: "white-model.png",
    mimeType: "image/png",
    buffer: inputBuffer,
  });

  const intermediateFile = await service.saveBase64({
    sourceType: "intermediate",
    fileType: "image",
    originalName: "lineart.png",
    mimeType: "image/png",
    contentBase64: intermediateBase64,
  });

  const outputFile = await service.saveBase64({
    sourceType: "output",
    fileType: "image",
    originalName: "final.png",
    mimeType: "image/png",
    contentBase64: outputBase64,
  });

  assert.equal(inputFile.storageProvider, "local");
  assert.equal(intermediateFile.sourceType, "intermediate");
  assert.equal(outputFile.sourceType, "output");
  assert.equal(inputFile.sha256.length, 64);
  assert.equal(outputFile.size, Buffer.from(outputBase64, "base64").length);

  const inputRead = await service.read(inputFile.storageKey);
  const intermediateRead = await service.read(intermediateFile.storageKey);
  const outputRead = await service.read(outputFile.storageKey);

  assert.equal(inputRead.buffer.toString("utf8"), "input-image");
  assert.equal(intermediateRead.buffer.toString("utf8"), "intermediate-image");
  assert.equal(outputRead.buffer.toString("utf8"), "output-image");
  assert.equal(outputRead.byteLength, Buffer.from("output-image").length);

  const outputStat = await service.stat(outputFile.storageKey);

  assert.ok(outputStat);
  assert.equal(outputStat?.byteLength, Buffer.from("output-image").length);
  assert.equal(outputStat?.storageKey, outputFile.storageKey);
  await assert.rejects(
    () => service.read("missing/not-found.bin"),
    /ENOENT/,
  );

  await fs.rm(rootDir, { recursive: true, force: true });
}

void run();
