import assert from "node:assert/strict";
import test from "node:test";

import { WorkflowDetailAssembler } from "./workflow-detail.assembler.ts";

test("WorkflowDetailAssembler hydrates nodes from bound file metadata", async () => {
  const assembler = new WorkflowDetailAssembler(
    {
      async listBindings() {
        return [
          { fileId: "file-1" },
        ];
      },
    },
    {
      async findFilesByIds(fileIds) {
        assert.deepEqual(fileIds, ["file-1"]);
        return [
          {
            fileId: "file-1",
            userId: "user-1",
            blobId: "blob-1",
            originalName: "photo.png",
            displayName: "photo.png",
            mimeType: "image/png",
            fileType: "image",
            sourceType: "input",
            sha256: "sha",
            size: 123,
            extension: "png",
            width: 640,
            height: 480,
            duration: null,
            status: "ready",
            createdAt: "2026-04-01T00:00:00.000Z",
            downloadUrl: "/api/v1/files/file-1/download",
            previewUrl: "/api/v1/files/file-1/preview",
            thumbnailUrl: "/api/v1/files/file-1/thumbnail",
            previewWidth: 640,
            previewHeight: 480,
            thumbnailWidth: 320,
            thumbnailHeight: 240,
          },
        ];
      },
    },
  );

  const result = await assembler.assemble({
    workflowId: "workflow-1",
    ownerUserId: "user-1",
    groupId: null,
    containerKey: "__ungrouped__",
    isAutoNamed: false,
    workflow: {
      id: "workflow-1",
      projectId: "project-1",
      name: "Canvas",
      nodes: {
        nodeA: {
          type: "image",
          fileId: "file-1",
        },
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {},
      timestamp: 1,
      version: 1,
    },
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  const node = result.workflow.nodes.nodeA as Record<string, unknown>;
  assert.equal(node.fileName, "photo.png");
  assert.equal(node.previewUrl, "/api/v1/files/file-1/preview");
  assert.equal(node.thumbnailUrl, "/api/v1/files/file-1/thumbnail");
});

