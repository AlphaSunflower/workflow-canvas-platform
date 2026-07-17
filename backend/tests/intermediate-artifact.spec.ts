import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { IntermediateArtifactRepository } from "../worker/src/modules/intermediate/intermediate-artifact.repository.ts";
import { IntermediateArtifactService } from "../worker/src/modules/intermediate/intermediate-artifact.service.ts";
import { IntermediateLockService } from "../worker/src/modules/intermediate/intermediate-lock.service.ts";

async function registerReadyFile(
  filesRepository: FilesRepository,
  userId: string,
  originalName: string,
  content: string,
  sourceType: "input" | "intermediate",
): Promise<string> {
  const buffer = Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const registerResult = await filesRepository.registerFile({
    userId,
    sha256,
    size: buffer.length,
    mimeType: "image/png",
    originalName,
    fileType: "image",
    sourceType,
  });

  if (registerResult.uploadRequired && registerResult.uploadId) {
    await filesRepository.uploadFile(
      registerResult.uploadId,
      buffer.toString("base64"),
    );
  }

  return registerResult.file.fileId;
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "intermediate-artifact-test-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const service = new IntermediateArtifactService(
      new IntermediateArtifactRepository(rootDir),
      filesRepository,
      new IntermediateLockService(),
    );

    const whiteModelFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "white-model.png",
      "white-model-content",
      "input",
    );
    const lineartFileId = await registerReadyFile(
      filesRepository,
      "system",
      "lineart.png",
      "lineart-content",
      "intermediate",
    );
    const depthFileId = await registerReadyFile(
      filesRepository,
      "system",
      "depth.png",
      "depth-content",
      "intermediate",
    );
    const sourceBlobId = (await filesRepository.findFileById(whiteModelFileId))!.blobId!;

    const firstReservation = await service.acquireArtifact({
      sourceBlobId,
      artifactType: "lineart",
      lastTaskId: "task-1",
      model: "gemini-3-pro-image-preview",
      imageSize: "1K",
      aspectRatio: "auto",
    });
    assert.equal(firstReservation.status, "processing");

    await service.markArtifactReady({
      reservation: firstReservation,
      fileId: lineartFileId,
      lastTaskId: "task-1",
    });
    await firstReservation.release();

    const reusedReservation = await service.acquireArtifact({
      sourceBlobId,
      artifactType: "lineart",
      lastTaskId: "task-2",
      model: "gemini-3-pro-image-preview",
      imageSize: "1K",
      aspectRatio: "auto",
    });
    assert.equal(reusedReservation.status, "ready");
    assert.equal(reusedReservation.reusedFileId, lineartFileId);
    await reusedReservation.release();

    const gptReservation = await service.acquireArtifact({
      sourceBlobId,
      artifactType: "lineart",
      lastTaskId: "task-3",
      model: "gpt-image-2-vip",
      imageSize: "4K",
      aspectRatio: "4:5",
    });
    assert.equal(gptReservation.status, "processing");

    await service.markArtifactReady({
      reservation: gptReservation,
      fileId: depthFileId,
      lastTaskId: "task-3",
    });
    await gptReservation.release();

    const gptReusedReservation = await service.acquireArtifact({
      sourceBlobId,
      artifactType: "lineart",
      lastTaskId: "task-4",
      model: "gpt-image-2-vip",
      imageSize: "4K",
      aspectRatio: "4:5",
    });
    assert.equal(gptReusedReservation.status, "ready");
    assert.equal(gptReusedReservation.reusedFileId, depthFileId);
    await gptReusedReservation.release();

    const sizeChangedReservation = await service.acquireArtifact({
      sourceBlobId,
      artifactType: "lineart",
      lastTaskId: "task-5",
      model: "gpt-image-2-vip",
      imageSize: "2K",
      aspectRatio: "4:5",
    });
    assert.equal(sizeChangedReservation.status, "processing");
    await sizeChangedReservation.release();

    const partialStatus = await service.resolveWhiteModelArtifacts({
      whiteModelFileId,
      taskId: "task-6",
      model: "gemini-3-pro-image-preview",
      imageSize: "1K",
      aspectRatio: "auto",
    });
    assert.equal(partialStatus.lineart?.status, "ready");
    assert.equal(partialStatus.depth?.status, "processing");

    await service.markArtifactReady({
      reservation: partialStatus.depth!,
      fileId: depthFileId,
      lastTaskId: "task-6",
    });
    await partialStatus.lineart?.release();
    await partialStatus.depth?.release();
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
