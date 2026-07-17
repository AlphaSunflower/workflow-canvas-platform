import test from "node:test";
import assert from "node:assert/strict";

import { downloadFile, getFileUrl } from "./file-api";

test("getFileUrl returns distinct thumbnail, preview, and download routes", () => {
  assert.equal(getFileUrl("file-1", "thumbnail"), "/api/v1/files/file-1/thumbnail");
  assert.equal(getFileUrl("file-1", "preview"), "/api/v1/files/file-1/preview");
  assert.equal(getFileUrl("file-1", "download"), "/api/v1/files/file-1/download");
});

test("downloadFile maps access-denied errors to execution output access messaging", async () => {
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
    const result = await downloadFile("file-denied");
    assert.equal(result.success, false);
    if (result.success) {
      throw new Error("Expected download to fail.");
    }
    assert.equal(result.error.code, "DOWNLOAD_ERROR");
    assert.ok(/产物文件不可访问/.test(result.error.message));
    assert.equal(result.error.context?.accessDenied, true);
    assert.equal(result.error.context?.status, 403);
    assert.equal(result.error.context?.backendCode, 403);
    assert.equal(typeof result.error.context?.bodySnippet, "string");
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  }
});

test("downloadFile preserves network failure diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "http://localhost:3000",
      },
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  try {
    const result = await downloadFile("file-network-failed");
    assert.equal(result.success, false);
    if (result.success) {
      throw new Error("Expected download to fail.");
    }

    assert.equal(result.error.code, "DOWNLOAD_ERROR");
    assert.equal(result.error.context?.previousCode, "NETWORK_ERROR");
    assert.equal(result.error.context?.failureKind, "network");
    assert.equal(result.error.context?.path, "/api/v1/files/file-network-failed/download");
    assert.equal(result.error.context?.method, "GET");
    assert.equal(result.error.context?.hasAuthToken, false);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("downloadFile preserves bounded HTTP response diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const longBody = JSON.stringify({
    code: 40042,
    error: "INVALID_FILE",
    message: "x".repeat(3000),
  });

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response(longBody, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }),
  });

  try {
    const result = await downloadFile("file-http-failed");
    assert.equal(result.success, false);
    if (result.success) {
      throw new Error("Expected download to fail.");
    }

    assert.equal(result.error.code, "DOWNLOAD_ERROR");
    assert.equal(result.error.context?.failureKind, "http");
    assert.equal(result.error.context?.status, 400);
    assert.equal(result.error.context?.backendCode, 40042);
    assert.equal(result.error.context?.bodyLength, longBody.length);
    assert.equal(result.error.context?.bodyTruncated, true);
    assert.equal(typeof result.error.context?.bodySnippet, "string");
    assert.equal("body" in (result.error.context ?? {}), false);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  }
});
