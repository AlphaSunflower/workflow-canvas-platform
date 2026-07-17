import test from "node:test";
import assert from "node:assert/strict";

import type { FileNodeData } from "@/types";
import { exportFileNode, clearExportDirectoryHandle, selectExportDirectory } from "./file-export";
import { registerLocalArchiveFile, clearLocalArchiveFileRegistry } from "./local-workflow-assets";
import {
  clearExecutionOutputRuntimeResources,
  ensureExecutionOutputRuntimeResource,
} from "./execution-output-runtime-sync";
import { imageOriginalSourceRegistry } from "./image/image-original-source-registry";
import {
  fileManifestStore,
  fileResourceDiagnostics,
  fileResourceLeaseManager,
} from "./file-resource";

function createFileNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: "100",
      display: "#00100",
    },
    type: "image",
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 180 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: "idle",
    zIndex: 1,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId: "file-100",
    fileName: "sample",
    fileSize: 128,
    mimeType: "image/png",
    source: {
      type: "imported",
      importMethod: "local",
      importedAt: now,
    },
    metadata: {
      width: 512,
      height: 512,
    },
    ...overrides,
  };
}

function resetTestState(): void {
  clearExportDirectoryHandle();
  clearLocalArchiveFileRegistry();
  clearExecutionOutputRuntimeResources();
  imageOriginalSourceRegistry.clear();
  fileResourceLeaseManager.clear();
  fileManifestStore.clear();
  fileResourceDiagnostics.clear();
}

function createDirectoryHandle(assertion?: (fileName: string, data?: Blob) => void) {
  return {
    name: "exports",
    queryPermission: async () => "granted" as const,
    getFileHandle: async (fileName: string) => ({
      createWritable: async () => ({
        write: async (data: Blob | BufferSource | string) => {
          if (!(data instanceof Blob)) {
            throw new Error("Expected directory write data to be a Blob.");
          }
          assertion?.(fileName, data);
        },
        close: async () => undefined,
      }),
    }),
  };
}

test("exportFileNode 优先导出本地注册原文件并补全扩展名", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "101", display: "#00101" },
    fileId: "file-local",
    fileName: "local image",
  });
  const localFile = new File([new Uint8Array([1, 2, 3])], "camera-shot.png", {
    type: "image/png",
  });

  registerLocalArchiveFile(node.id.value, node.fileId, localFile);

  const savedFiles: Array<{ fileName: string; blob: Blob }> = [];
  const directoryHandle = createDirectoryHandle((fileName, data) => {
    savedFiles.push({ fileName, blob: data ?? new Blob() });
  });

  const result = await exportFileNode(node, {
    directoryHandle,
  });

  assert.equal(result.status, "saved");
  assert.equal(result.fileName, "local image.png");
  assert.equal(result.source, "local-archive");
  assert.equal(result.directoryName, "exports");
  assert.equal(savedFiles.length, 1);
  assert.equal(savedFiles[0]?.fileName, "local image.png");
  assert.equal(savedFiles[0]?.blob.type, "image/png");
  resetTestState();
});

test("exportFileNode maps inaccessible execution output files to a specific artifact access error", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "110", display: "#00110" },
    fileId: "forbidden-output",
    fileName: "forbidden-output",
    source: {
      type: "node-output",
      producerNodeId: "ai-1",
      producerNodeDisplayId: "#00001",
      producerNodeType: "aiImageGen",
      taskId: "task-forbidden",
      taskNo: "TASK-FORBIDDEN",
      taskCreatedAt: Date.now(),
    },
  });

  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response(JSON.stringify({
      code: 403,
      error: "AUTH_FORBIDDEN",
      message: "当前账户无权执行该操作。",
      timestamp: Date.now(),
    }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }),
  });

  try {
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle(),
    });

    assert.equal(result.status, "failed");
    if (result.status !== "failed") {
      throw new Error("Expected export to fail.");
    }
    assert.equal(result.error.code, "DOWNLOAD_ERROR");
    assert.ok(/产物文件不可访问/.test(result.error.message));
    assert.equal(result.error.context?.accessDenied, true);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});

test("exportFileNode skips duplicate original fallback when remote download already failed for same url", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "114", display: "#00114" },
    fileId: "same-download-original",
    fileName: "same-url",
    mimeType: "image/png",
    imageAsset: {
      assetId: "same-download-original",
      source: "remote",
      version: 1,
      variants: {
        original: { url: "/api/v1/files/same-download-original/download", mimeType: "image/png" },
      },
    },
  });

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response("missing", { status: 404 });
    },
  });

  try {
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle(),
    });

    assert.equal(result.status, "failed");
    assert.deepEqual(requestedUrls, [
      "/api/v1/files/same-download-original/download",
    ]);
    if (result.status !== "failed") {
      throw new Error("Expected export to fail.");
    }
    assert.deepEqual(result.error.context?.failedUrls, [
      "/api/v1/files/same-download-original/download",
    ]);
    assert.deepEqual(result.error.context?.fallbackChain, [
      "execution-runtime-file",
      "registry-file",
      "local-handle",
      "remote-download",
    ]);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});

test("exportFileNode uses original variant URL directly when it differs from backend download URL", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "115", display: "#00115" },
    fileId: "different-original-url",
    fileName: "different-url",
    mimeType: "image/png",
    imageAsset: {
      assetId: "different-original-url",
      source: "remote",
      version: 1,
      variants: {
        original: { url: "https://example.com/different-original.png", mimeType: "image/png" },
      },
    },
  });

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url === "https://example.com/different-original.png") {
        return new Response(new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle((fileName, data) => {
        assert.equal(fileName, "different-url.png");
        assert.equal(data?.size, 3);
      }),
    });

    assert.equal(result.status, "saved");
    assert.equal(result.source, "remote-download");
    assert.deepEqual(requestedUrls, [
      "https://example.com/different-original.png",
    ]);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});

test("exportFileNode uses image original registry file before remote fallback", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "111", display: "#00111" },
    fileId: "registry-original-image",
    fileName: "registry image",
  });
  const registryFile = new File([new Uint8Array([7, 8, 9, 10])], "registry-image.png", {
    type: "image/png",
  });
  const originalFetch = globalThis.fetch;

  imageOriginalSourceRegistry.registerLocalFile(node.id.value, node.fileId, registryFile);
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      throw new Error(`Registry original export should not hit fetch: ${String(input)}`);
    },
  });

  try {
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle((fileName, data) => {
        assert.equal(fileName, "registry image.png");
        assert.equal(data?.type, "image/png");
        assert.equal(data?.size, 4);
      }),
    });

    assert.equal(result.status, "saved");
    assert.equal(result.fileName, "registry image.png");
    assert.equal(result.source, "registry-file");
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});

test("exportFileNode resolves registry originals within the requested workflow scope", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "111", display: "#00111" },
    fileId: "registry-original-image",
    fileName: "registry scoped image",
  });
  const workflowAFile = new File([new Uint8Array([1, 2])], "workflow-a.png", {
    type: "image/png",
  });
  const workflowBFile = new File([new Uint8Array([7, 8, 9, 10, 11])], "workflow-b.png", {
    type: "image/png",
  });
  const originalFetch = globalThis.fetch;

  imageOriginalSourceRegistry.registerLocalFile(node.id.value, node.fileId, workflowAFile, {
    workflowId: "workflow-a",
  });
  imageOriginalSourceRegistry.registerLocalFile(node.id.value, node.fileId, workflowBFile, {
    workflowId: "workflow-b",
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      throw new Error(`Scoped registry export should not hit fetch: ${String(input)}`);
    },
  });

  try {
    const result = await exportFileNode(node, {
      workflowId: "workflow-b",
      directoryHandle: createDirectoryHandle((fileName, data) => {
        assert.equal(fileName, "registry scoped image.png");
        assert.equal(data?.type, "image/png");
        assert.equal(data?.size, 5);
      }),
    });

    assert.equal(result.status, "saved");
    assert.equal(result.source, "registry-file");
    const resolvedEvent = fileResourceDiagnostics.getEvents().find((event) => (
      event.event === "resolved"
      && event.purpose === "export-original"
      && event.nodeId === node.id.value
      && event.fileId === node.fileId
    ));
    assert.equal(resolvedEvent?.workflowId, "workflow-b");
    assert.equal(resolvedEvent?.selectedSource, "registry-file");
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});

test("exportFileNode syncs missing node output runtime resource on demand before remote export", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "112", display: "#00112" },
    fileId: "runtime-missing-image",
    fileName: "synced image",
    source: {
      type: "node-output",
      producerNodeId: "ai-112",
      producerNodeDisplayId: "#00112",
      producerNodeType: "aiImageGen",
      taskId: "task-112",
      taskNo: "TASK-112",
      taskCreatedAt: Date.now(),
    },
  });
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const fetchCalls: string[] = [];

  URL.createObjectURL = () => "blob:runtime-missing-image";
  URL.revokeObjectURL = () => undefined;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === "/api/v1/files/runtime-missing-image") {
        return new Response(JSON.stringify({
          code: 200,
          message: "ok",
          data: {
            fileId: "runtime-missing-image",
            originalName: "runtime-missing-image.png",
            displayName: "runtime-missing-image.png",
            mimeType: "image/png",
            fileType: "image",
            sourceType: "output",
            sha256: "hash-runtime-missing-image",
            size: 3,
            extension: "png",
            width: 512,
            height: 512,
            duration: null,
            status: "ready",
            createdAt: new Date("2026-05-14T00:00:00.000Z").toISOString(),
            downloadUrl: "/api/v1/files/runtime-missing-image/download",
            thumbnailUrl: "/api/v1/files/runtime-missing-image/thumbnail",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url === "/api/v1/files/runtime-missing-image/download") {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle((fileName, data) => {
        assert.equal(fileName, "synced image.png");
        assert.equal(data?.type, "image/png");
        assert.equal(data?.size, 3);
      }),
    });

    assert.equal(result.status, "saved");
    assert.equal(result.fileName, "synced image.png");
    assert.equal(result.source, "runtime-output");
    assert.deepEqual(fetchCalls, [
      "/api/v1/files/runtime-missing-image",
      "/api/v1/files/runtime-missing-image/download",
    ]);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    resetTestState();
  }
});

test("exportFileNode falls back to remote download when node output runtime sync fails", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "113", display: "#00113" },
    fileId: "sync-fails-remote-succeeds",
    fileName: "remote after sync failure",
    source: {
      type: "node-output",
      producerNodeId: "ai-113",
      producerNodeDisplayId: "#00113",
      producerNodeType: "aiImageGen",
      taskId: "task-113",
      taskNo: "TASK-113",
      taskCreatedAt: Date.now(),
    },
  });
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === "/api/v1/files/sync-fails-remote-succeeds") {
        return new Response("metadata failed", { status: 500 });
      }

      if (url === "/api/v1/files/sync-fails-remote-succeeds/download") {
        return new Response(new Blob([new Uint8Array([9, 9, 9])], { type: "image/png" }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle((fileName, data) => {
        assert.equal(fileName, "remote after sync failure.png");
        assert.equal(data?.type, "image/png");
        assert.equal(data?.size, 3);
      }),
    });

    assert.equal(result.status, "saved");
    assert.equal(result.fileName, "remote after sync failure.png");
    assert.equal(result.source, "remote-download");
    assert.deepEqual(fetchCalls, [
      "/api/v1/files/sync-fails-remote-succeeds",
      "/api/v1/files/sync-fails-remote-succeeds/download",
    ]);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});

test("exportFileNode 在浏览器不支持目录选择时降级为普通下载", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "102", display: "#00102" },
    fileId: "file-download",
    fileName: "artifact",
  });
  const localFile = new File([new Uint8Array([9, 9, 9])], "artifact.png", {
    type: "image/png",
  });

  registerLocalArchiveFile(node.id.value, node.fileId, localFile);

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;
  const clicked: string[] = [];
  const appended: unknown[] = [];
  const removed: unknown[] = [];

  const anchor = {
    href: "",
    download: "",
    style: { display: "" },
    click: () => {
      clicked.push(anchor.download);
    },
  };

  const documentMock = {
    body: {
      appendChild: (value: unknown) => {
        appended.push(value);
      },
      removeChild: (value: unknown) => {
        removed.push(value);
      },
    },
    createElement: (tagName: string) => {
      assert.equal(tagName, "a");
      return anchor;
    },
  } as unknown as Document;

  const windowMock = {
    setTimeout: (handler: () => void) => {
      handler();
      return 0;
    },
  } as unknown as Window;

  const urlMock = {
    createObjectURL: () => "blob:mock-export",
    revokeObjectURL: () => undefined,
  } as unknown as typeof URL;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentMock,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
  });
  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    value: urlMock,
  });

  try {
    const result = await exportFileNode(node);

    assert.equal(result.status, "downloaded");
    assert.equal(result.fileName, "artifact.png");
    assert.equal(result.source, "local-archive");
    assert.deepEqual(clicked, ["artifact.png"]);
    assert.equal(appended.length, 1);
    assert.equal(removed.length, 1);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "URL", {
      configurable: true,
      value: originalUrl,
    });
    resetTestState();
  }
});

test("selectExportDirectory 在目录选择成功时返回目录名并缓存句柄", async () => {
  resetTestState();
  const originalWindow = globalThis.window;
  const pickedHandle = createDirectoryHandle();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      showDirectoryPicker: async () => pickedHandle,
    },
  });

  try {
    const result = await selectExportDirectory();
    assert.equal(result.success, true);
    assert.equal(result.directoryName, "exports");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    resetTestState();
  }
});

test("exportFileNode 为 ply 文件补齐缺失扩展名", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "103", display: "#00103" },
    type: "ply",
    fileId: "file-ply",
    fileName: "mesh_output",
    mimeType: "application/octet-stream",
    metadata: {},
  });
  const localFile = new File([new Uint8Array([80, 76, 89])], "mesh_output", {
    type: "application/octet-stream",
  });

  registerLocalArchiveFile(node.id.value, node.fileId, localFile);

  const directoryHandle = createDirectoryHandle((fileName) => {
    assert.equal(fileName, "mesh_output.ply");
  });

  const result = await exportFileNode(node, {
    directoryHandle,
  });

  assert.equal(result.status, "saved");
  assert.equal(result.fileName, "mesh_output.ply");
  assert.equal(result.source, "local-archive");
  resetTestState();
});

test("exportFileNode 会修正非法字符、错误扩展名与重复扩展名", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "104", display: "#00104" },
    fileId: "file-weird",
    fileName: 'bad:name?.jpg.jpg',
    mimeType: "image/png",
  });
  const localFile = new File([new Uint8Array([1, 2])], "origin.png", {
    type: "image/png",
  });

  registerLocalArchiveFile(node.id.value, node.fileId, localFile);

  let exportedFileName = "";
  const result = await exportFileNode(node, {
    directoryHandle: createDirectoryHandle((fileName) => {
      exportedFileName = fileName;
    }),
  });

  assert.equal(result.status, "saved");
  assert.equal(result.fileName, "bad_name_.png");
  assert.equal(exportedFileName, "bad_name_.png");
  resetTestState();
});

test("exportFileNode 可导出远端视频原始文件", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "105", display: "#00105" },
    type: "video",
    fileId: "remote-video",
    fileName: "clip",
    mimeType: "video/mp4",
    previewUrl: "/api/v1/files/remote-video/preview",
    metadata: {
      width: 1920,
      height: 1080,
      duration: 5,
    },
  });

  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/v1/files/remote-video/download");
      return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/mp4" }), {
        status: 200,
      });
    },
  });

  try {
    let writtenType = "";
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle((fileName, data) => {
        assert.equal(fileName, "clip.mp4");
        writtenType = data?.type ?? "";
      }),
    });

    assert.equal(result.status, "saved");
    assert.equal(result.fileName, "clip.mp4");
    assert.equal(result.source, "remote-download");
    assert.equal(writtenType, "video/mp4");
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});

test("exportFileNode prefers runtime output before local archive and remote fallback", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "109", display: "#00109" },
    fileId: "runtime-output-image",
    fileName: "runtime image",
  });
  const archivedFile = new File([new Uint8Array([9, 9, 9])], "archived-image.png", {
    type: "image/png",
  });
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const fetchCalls: string[] = [];
  let allowSyncFetch = true;

  URL.createObjectURL = () => "blob:runtime-output-image";
  URL.revokeObjectURL = () => undefined;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (allowSyncFetch && url === "data:image/png;base64,AQID") {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), {
          status: 200,
        });
      }
      throw new Error(`Runtime output export should not hit fetch: ${url}`);
    },
  });

  try {
    await ensureExecutionOutputRuntimeResource({
      id: node.fileId,
      name: "runtime-output-image.png",
      originalName: "runtime-output-image.png",
      size: 3,
      mimeType: "image/png",
      format: "png",
      fileType: "image",
      status: "ready",
      hash: "hash-runtime-output-image",
      path: "data:image/png;base64,AQID",
      metadata: {
        width: 512,
        height: 512,
      },
      source: {
        type: "node-output",
      },
      timestamp: {
        created: 1,
        updated: 1,
      },
    });
    allowSyncFetch = false;
    registerLocalArchiveFile(node.id.value, node.fileId, archivedFile);

    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle((fileName, data) => {
        assert.equal(fileName, "runtime image.png");
        assert.equal(data?.type, "image/png");
        assert.equal(data?.size, 3);
      }),
    });

    assert.equal(result.status, "saved");
    assert.equal(result.fileName, "runtime image.png");
    assert.equal(result.source, "runtime-output");
    assert.deepEqual(fetchCalls, ["data:image/png;base64,AQID"]);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    resetTestState();
  }
});

test("exportFileNode 可导出远端 ply 模型文件", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "108", display: "#00108" },
    type: "ply",
    fileId: "remote-ply",
    fileName: "sculpt",
    mimeType: "application/octet-stream",
    metadata: {},
  });

  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/v1/files/remote-ply/download");
      return new Response(new Blob([new Uint8Array([80, 76, 89])], { type: "application/octet-stream" }), {
        status: 200,
      });
    },
  });

  try {
    let exportedFileName = "";
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle((fileName) => {
        exportedFileName = fileName;
      }),
    });

    assert.equal(result.status, "saved");
    assert.equal(result.source, "remote-download");
    assert.equal(result.fileName, "sculpt.ply");
    assert.equal(exportedFileName, "sculpt.ply");
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});

test("exportFileNode 在图片原图缺失时回退预览图导出", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "106", display: "#00106" },
    fileId: "remote-image-fallback",
    fileName: "render-result",
    mimeType: "image/png",
    imageAsset: {
      assetId: "remote-image-fallback",
      source: "remote",
      version: 1,
      variants: {
        original: { url: "https://example.com/original.png", mimeType: "image/png" },
      },
    },
  });

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url === "/api/v1/files/remote-image-fallback/download") {
        return new Response("download missing", { status: 404 });
      }

      if (url === "https://example.com/original.png") {
        return new Response(new Blob([new Uint8Array([5, 6, 7])], { type: "image/png" }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle((fileName) => {
        assert.equal(fileName, "render-result.png");
      }),
    });

    assert.equal(result.status, "saved");
    assert.equal(result.fileName, "render-result.png");
    assert.equal(result.source, "remote-download");
    assert.deepEqual(requestedUrls, [
      "https://example.com/original.png",
    ]);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});

test("exportFileNode 在远端文件与图片兜底都失败时返回明确错误", async () => {
  resetTestState();
  const node = createFileNode({
    id: { value: "107", display: "#00107" },
    fileId: "broken-remote-image",
    fileName: "broken",
    mimeType: "image/png",
    imageAsset: {
      assetId: "broken-remote-image",
      source: "remote",
      version: 1,
      variants: {
        original: { url: "https://example.com/broken-original.png", mimeType: "image/png" },
      },
    },
  });

  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response("missing", { status: 404 }),
  });

  try {
    const result = await exportFileNode(node, {
      directoryHandle: createDirectoryHandle(),
    });

    assert.equal(result.status, "failed");
    assert.equal(result.fileName, "broken.png");
    if (result.status !== "failed") {
      throw new Error("Expected export to fail.");
    }
    assert.ok(/图片原图缺失|远端文件下载失败|未找到可导出的文件内容/.test(result.error.message));
    assert.deepEqual(result.error.context?.fallbackChain, [
      "execution-runtime-file",
      "registry-file",
      "local-handle",
      "remote-download",
    ]);
    assert.equal(Array.isArray(result.error.context?.failures), true);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    resetTestState();
  }
});
