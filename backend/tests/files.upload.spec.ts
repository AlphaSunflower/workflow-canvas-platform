import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-files-test-"));
  const repository = new FilesRepository(rootDir);
  const service = new FilesService(repository);

  const content = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAF0lEQVR4nGP8z8DAwMDAxMDA8J8BAM4FA/2wE8sAAAAASUVORK5CYII=",
    "base64",
  );
  const sha256 = createHash("sha256").update(content).digest("hex");

  const firstRegister = await service.register({
    userId: "user-a",
    sha256,
    size: content.length,
    mimeType: "image/png",
    originalName: "image-a.png",
    fileType: "image",
    sourceType: "input",
  });

  assert.equal(firstRegister.uploadRequired, true);
  assert.ok(firstRegister.uploadId);
  assert.equal(firstRegister.file.status, "pending_upload");

  const uploadResult = await service.upload({
    uploadId: firstRegister.uploadId!,
    contentBase64: content.toString("base64"),
  });

  assert.equal(uploadResult.file.status, "ready");
  assert.ok(uploadResult.file.blobId);
  assert.equal(uploadResult.file.sha256, sha256);

  const secondRegister = await service.register({
    userId: "user-b",
    sha256,
    size: content.length,
    mimeType: "image/png",
    originalName: "image-b.png",
    fileType: "image",
    sourceType: "input",
  });

  assert.equal(secondRegister.uploadRequired, false);
  assert.equal(secondRegister.file.status, "ready");
  assert.ok(secondRegister.file.blobId);
  assert.notEqual(secondRegister.file.fileId, uploadResult.fileId);
  assert.equal(secondRegister.file.sha256, sha256);

  const thirdRegister = await service.register({
    userId: "user-a",
    sha256,
    size: content.length,
    mimeType: "image/png",
    originalName: "image-a-second.png",
    fileType: "image",
    sourceType: "input",
  });

  assert.equal(thirdRegister.uploadRequired, false);
  assert.equal(thirdRegister.file.fileId, uploadResult.fileId);
  assert.equal(thirdRegister.file.sha256, sha256);

  const fetchedFile = await service.getFile(uploadResult.fileId);

  assert.ok(fetchedFile);
  assert.equal(fetchedFile?.fileId, uploadResult.fileId);

  const downloaded = await service.downloadFile(uploadResult.fileId);

  assert.ok(downloaded);
  assert.equal(Buffer.compare(downloaded!.buffer, content), 0);

  const firstBlobPath = path.join(rootDir, "storage", "blobs", sha256.slice(0, 2), `${sha256}.png`);
  await fs.rm(firstBlobPath, { force: true });

  const staleRegister = await service.register({
    userId: "user-a",
    sha256,
    size: content.length,
    mimeType: "image/png",
    originalName: "image-a-reupload.png",
    fileType: "image",
    sourceType: "input",
  });

  assert.equal(staleRegister.uploadRequired, true);
  assert.ok(staleRegister.uploadId);
  assert.equal(staleRegister.file.status, "pending_upload");
  assert.notEqual(staleRegister.file.fileId, uploadResult.fileId);

  const staleUpload = await service.upload({
    uploadId: staleRegister.uploadId!,
    contentBase64: content.toString("base64"),
  });

  assert.equal(staleUpload.file.status, "ready");
  assert.equal(staleUpload.file.sha256, sha256);

  const reuploaded = await service.downloadFile(staleUpload.fileId);
  assert.ok(reuploaded);
  assert.equal(Buffer.compare(reuploaded!.buffer, content), 0);

  const originalFileAfterRepair = await service.downloadFile(uploadResult.fileId);
  assert.ok(originalFileAfterRepair);
  assert.equal(Buffer.compare(originalFileAfterRepair!.buffer, content), 0);

  await fs.rm(rootDir, { recursive: true, force: true });
}

void run();
