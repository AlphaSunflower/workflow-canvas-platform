import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-files-ply-test-"));
  const repository = new FilesRepository(rootDir);
  const service = new FilesService(repository);

  try {
    const content = Buffer.from("ply\nformat ascii 1.0\nend_header\n");
    const sha256 = createHash("sha256").update(content).digest("hex");

    const registerResult = await service.register({
      userId: "user-ply",
      sha256,
      size: content.length,
      mimeType: "application/octet-stream",
      originalName: "model-output.ply",
      fileType: "ply",
      sourceType: "output",
    });

    assert.equal(registerResult.uploadRequired, true);
    assert.ok(registerResult.uploadId);
    assert.equal(registerResult.file.fileType, "ply");
    assert.equal(registerResult.file.extension, "ply");
    assert.equal(registerResult.file.previewUrl, undefined);

    const uploadResult = await service.upload({
      uploadId: registerResult.uploadId!,
      contentBase64: content.toString("base64"),
    });

    assert.equal(uploadResult.file.fileType, "ply");
    assert.equal(uploadResult.file.sourceType, "output");
    assert.equal(uploadResult.file.mimeType, "application/octet-stream");
    assert.equal(uploadResult.file.extension, "ply");
    assert.ok(uploadResult.file.downloadUrl);
    assert.equal(uploadResult.file.previewUrl, undefined);

    const fetchedFile = await service.getFile(uploadResult.fileId);
    assert.ok(fetchedFile);
    assert.equal(fetchedFile?.fileType, "ply");
    assert.equal(fetchedFile?.previewUrl, undefined);

    const downloaded = await service.downloadFile(uploadResult.fileId);
    assert.ok(downloaded);
    assert.equal(downloaded?.mimeType, "application/octet-stream");
    assert.equal(downloaded?.buffer.toString("utf8"), content.toString("utf8"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
