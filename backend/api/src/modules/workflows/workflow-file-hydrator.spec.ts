import assert from "node:assert/strict";
import test from "node:test";

import type { FileAssetResponse } from "@newworkflow/backend-shared/api";
import { WorkflowFileHydrator } from "./workflow-file-hydrator.ts";

function createFile(fileId: string): FileAssetResponse {
  return {
    fileId,
    userId: "user-1",
    blobId: "blob-1",
    originalName: "image.png",
    displayName: "Image",
    mimeType: "image/png",
    fileType: "image",
    sourceType: "input",
    sha256: "hash",
    size: 128,
    extension: "png",
    width: 640,
    height: 480,
    duration: null,
    status: "ready",
    createdAt: new Date(0).toISOString(),
    downloadUrl: "/api/v1/files/file-1/download",
    thumbnailUrl: "/api/v1/files/file-1/thumbnail",
    previewUrl: "/api/v1/files/file-1/preview",
    thumbnailWidth: 64,
    thumbnailHeight: 48,
    previewWidth: 320,
    previewHeight: 240,
  };
}

test("WorkflowFileHydrator fills remote file metadata and preview asset fallback", () => {
  const hydrator = new WorkflowFileHydrator();
  const result = hydrator.hydrateNodes(
    {
      "node-1": {
        type: "image",
        fileId: "file-1",
        metadata: {},
      },
    },
    new Map([["file-1", createFile("file-1")]]),
  );

  const node = result["node-1"] as Record<string, unknown>;
  assert.equal(node.fileName, "Image");
  assert.equal(node.fileSize, 128);
  assert.equal(node.mimeType, "image/png");
  assert.equal((node.metadata as Record<string, unknown>).width, 640);
  assert.equal(node.previewUrl, "/api/v1/files/file-1/preview");
  assert.equal(node.thumbnailUrl, "/api/v1/files/file-1/thumbnail");
  assert.ok(node.imageAsset);
});
