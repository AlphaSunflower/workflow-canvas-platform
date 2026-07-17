import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileInfo } from '@/types';
import {
  fileManifestStore,
  fileResourceLeaseManager,
} from './file-resource';
import { imageOriginalSourceRegistry } from './image/image-original-source-registry';
import { imageThumbnailRuntimeStore } from './image/image-thumbnail-runtime-store';
import { clearProtectedResourceCache } from './protected-resource';
import {
  clearExecutionOutputRuntimeResources,
  ensureExecutionOutputRuntimeResource,
  ensureExecutionOutputRuntimeResourceByFileId,
  getExecutionOutputRuntimeResource,
  getExecutionOutputRuntimeStatus,
  prefetchExecutionOutputRuntimeResource,
  registerExecutionOutputNodeRuntimeSource,
  unregisterExecutionOutputNodeRuntimeSource,
} from './execution-output-runtime-sync';

function createFileInfo(fileId: string, overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    id: fileId,
    name: `${fileId}.png`,
    originalName: `${fileId}.png`,
    size: 1024,
    mimeType: 'image/png',
    format: 'png',
    fileType: 'image',
    status: 'ready',
    hash: `hash-${fileId}`,
    path: `/api/v1/files/${fileId}/download`,
    thumbnailPath: `/api/v1/files/${fileId}/thumbnail`,
    metadata: {
      width: 1024,
      height: 768,
    },
    source: {
      type: 'node-output',
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
    ...overrides,
  };
}

function resetRuntimeState(): void {
  fileResourceLeaseManager.clear();
  clearExecutionOutputRuntimeResources();
  clearProtectedResourceCache();
  fileManifestStore.clear();
  imageOriginalSourceRegistry.clear();
  imageThumbnailRuntimeStore.clearAll();
}

function mockObjectUrls(): {
  created: string[];
  revoked: string[];
  restore: () => void;
} {
  const created: string[] = [];
  const revoked: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  URL.createObjectURL = (): string => {
    const nextUrl = `blob:runtime-${created.length + 1}`;
    created.push(nextUrl);
    return nextUrl;
  };
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  return {
    created,
    revoked,
    restore: () => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    },
  };
}

test('execution-output-runtime-sync hydrates runtime resources by result file id and binds image previews', async () => {
  resetRuntimeState();
  const urlMock = mockObjectUrls();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/files/file-image-1') {
        return new Response(JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            fileId: 'file-image-1',
            originalName: 'result-image.png',
            displayName: 'result-image.png',
            mimeType: 'image/png',
            fileType: 'image',
            sourceType: 'output',
            sha256: 'hash-file-image-1',
            size: 4,
            extension: 'png',
            width: 1024,
            height: 768,
            duration: null,
            status: 'ready',
            createdAt: new Date('2026-04-16T00:00:00.000Z').toISOString(),
            downloadUrl: '/api/v1/files/file-image-1/download',
            thumbnailUrl: '/api/v1/files/file-image-1/thumbnail',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/v1/files/file-image-1/download') {
        return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const resource = await ensureExecutionOutputRuntimeResourceByFileId('file-image-1');

    assert.ok(resource);
    assert.equal(resource?.file.name, 'result-image.png');
    assert.equal(resource?.objectUrl, 'blob:runtime-1');
    assert.equal(getExecutionOutputRuntimeStatus('file-image-1'), 'ready');
    assert.equal(getExecutionOutputRuntimeResource('file-image-1')?.objectUrl, 'blob:runtime-1');

    registerExecutionOutputNodeRuntimeSource('node-image-1', 'file-image-1', {
      workflowId: 'workflow-output-1',
    });

    assert.equal(imageOriginalSourceRegistry.hasLocalFile('node-image-1', 'file-image-1'), true);
    assert.equal(imageOriginalSourceRegistry.getFile('node-image-1', 'file-image-1')?.name, 'result-image.png');
    const manifest = fileManifestStore.get({
      workflowId: 'workflow-output-1',
      nodeId: 'node-image-1',
      fileId: 'file-image-1',
      variant: 'original',
    });
    assert.equal(manifest?.hasRuntimeFile, true);
    assert.equal(manifest?.hasLocalFile, true);
    assert.equal(manifest?.hasRemoteOriginal, true);
    assert.equal(manifest?.backendFileId, 'file-image-1');
    assert.equal(manifest?.sourceType, 'node-output');
    assert.equal(imageThumbnailRuntimeStore.get('node-image-1')?.status, 'ready');
    assert.equal(imageThumbnailRuntimeStore.get('node-image-1')?.objectUrl, 'blob:runtime-2');
    assert.deepEqual(fetchCalls, [
      '/api/v1/files/file-image-1',
      '/api/v1/files/file-image-1/download',
    ]);
  } finally {
    unregisterExecutionOutputNodeRuntimeSource('node-image-1', 'file-image-1', {
      workflowId: 'workflow-output-1',
      clearOriginalSource: true,
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    urlMock.restore();
    resetRuntimeState();
  }
});

test('execution-output-runtime-sync deduplicates repeated synchronization for the same result file', async () => {
  resetRuntimeState();
  const urlMock = mockObjectUrls();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];
  let resolveDownloadPromise: ((response: Response) => void) | undefined;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      assert.equal(url, '/api/v1/files/file-image-2/download');

      return new Promise<Response>((resolve) => {
        resolveDownloadPromise = resolve;
      });
    },
  });

  try {
    const fileInfo = createFileInfo('file-image-2');
    const first = ensureExecutionOutputRuntimeResource(fileInfo);
    const second = ensureExecutionOutputRuntimeResource(fileInfo);

    assert.equal(getExecutionOutputRuntimeStatus('file-image-2'), 'syncing');

    if (!resolveDownloadPromise) {
      throw new Error('Expected the runtime download request to be pending.');
    }
    resolveDownloadPromise(new Response(new Blob([new Uint8Array([5, 6, 7])], { type: 'image/png' }), {
      status: 200,
    }));
    const [firstResource, secondResource] = await Promise.all([first, second]);

    assert.ok(firstResource);
    assert.strictEqual(firstResource, secondResource);
    assert.equal(getExecutionOutputRuntimeStatus('file-image-2'), 'ready');
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(urlMock.created, ['blob:runtime-1']);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    urlMock.restore();
    resetRuntimeState();
  }
});

test('execution-output-runtime-sync marks failures without throwing to the caller prefetch flow', async () => {
  resetRuntimeState();
  const urlMock = mockObjectUrls();
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), '/api/v1/files/file-image-failed/download');
      return new Response('download failed', { status: 500 });
    },
  });

  try {
    const fileInfo = createFileInfo('file-image-failed');

    let thrown: unknown;
    try {
      await prefetchExecutionOutputRuntimeResource(fileInfo);
    } catch (error) {
      thrown = error;
    }

    assert.equal(thrown, undefined);
    assert.equal(getExecutionOutputRuntimeStatus('file-image-failed'), 'failed');
    assert.equal(getExecutionOutputRuntimeResource('file-image-failed'), null);
    assert.deepEqual(urlMock.created, []);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    urlMock.restore();
    resetRuntimeState();
  }
});

test('execution-output-runtime-sync keeps access-denied output failures sticky to avoid repeated downloads', async () => {
  resetRuntimeState();
  const urlMock = mockObjectUrls();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify({
        code: 403,
        error: 'AUTH_FORBIDDEN',
        message: '当前账户无权执行该操作。',
        timestamp: Date.now(),
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  try {
    const fileInfo = createFileInfo('file-image-denied');

    await prefetchExecutionOutputRuntimeResource(fileInfo);
    await prefetchExecutionOutputRuntimeResource(fileInfo);

    assert.equal(getExecutionOutputRuntimeStatus('file-image-denied'), 'failed');
    assert.equal(getExecutionOutputRuntimeResource('file-image-denied'), null);
    assert.deepEqual(fetchCalls, [
      '/api/v1/files/file-image-denied/download',
    ]);
    assert.deepEqual(urlMock.created, []);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    urlMock.restore();
    resetRuntimeState();
  }
});

test('execution-output-runtime-sync only revokes owned object urls during clear lifecycle', async () => {
  resetRuntimeState();
  const urlMock = mockObjectUrls();
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/files/file-image-owned/download') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const fileInfo = createFileInfo('file-image-owned');
    await ensureExecutionOutputRuntimeResource(fileInfo);
    registerExecutionOutputNodeRuntimeSource('node-owned-1', 'file-image-owned');

    assert.deepEqual(urlMock.created, ['blob:runtime-1', 'blob:runtime-2']);
    assert.deepEqual(urlMock.revoked, []);

    clearExecutionOutputRuntimeResources();

    assert.deepEqual(urlMock.revoked, ['blob:runtime-1', 'blob:runtime-2']);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    urlMock.restore();
    resetRuntimeState();
  }
});

test('execution-output runtime source unmount does not clear original source unless explicitly requested', async () => {
  resetRuntimeState();
  const urlMock = mockObjectUrls();
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/files/file-image-windowed/download') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const fileInfo = createFileInfo('file-image-windowed');
    await ensureExecutionOutputRuntimeResource(fileInfo);
    registerExecutionOutputNodeRuntimeSource('node-windowed', 'file-image-windowed', {
      workflowId: 'workflow-windowed',
    });
    const originalFile = imageOriginalSourceRegistry.getFile('node-windowed', 'file-image-windowed', {
      workflowId: 'workflow-windowed',
    });
    assert.ok(originalFile);

    unregisterExecutionOutputNodeRuntimeSource('node-windowed', 'file-image-windowed', {
      workflowId: 'workflow-windowed',
    });

    assert.equal(imageThumbnailRuntimeStore.get('node-windowed'), null);
    assert.equal(imageOriginalSourceRegistry.getFile('node-windowed', 'file-image-windowed', {
      workflowId: 'workflow-windowed',
    }), originalFile);

    unregisterExecutionOutputNodeRuntimeSource('node-windowed', 'file-image-windowed', {
      workflowId: 'workflow-windowed',
      clearOriginalSource: true,
    });
    assert.equal(imageOriginalSourceRegistry.getFile('node-windowed', 'file-image-windowed', {
      workflowId: 'workflow-windowed',
    }), null);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    urlMock.restore();
    resetRuntimeState();
  }
});

test('execution-output runtime clear preserves leased runtime files and original registry entries', async () => {
  resetRuntimeState();
  const urlMock = mockObjectUrls();
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/files/file-image-leased/download') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const fileInfo = createFileInfo('file-image-leased');
    const resource = await ensureExecutionOutputRuntimeResource(fileInfo);
    registerExecutionOutputNodeRuntimeSource('node-leased-output', 'file-image-leased', {
      workflowId: 'workflow-leased-output',
    });
    const lease = fileResourceLeaseManager.acquireLease(
      {
        workflowId: 'workflow-leased-output',
        nodeId: 'node-leased-output',
        fileId: 'file-image-leased',
        variant: 'original',
      },
      'upload',
      'test-upload',
    );

    assert.ok(resource?.file);
    assert.equal(imageOriginalSourceRegistry.getFile('node-leased-output', 'file-image-leased', {
      workflowId: 'workflow-leased-output',
    }), resource?.file);

    clearExecutionOutputRuntimeResources();

    assert.equal(getExecutionOutputRuntimeResource('file-image-leased')?.file, resource?.file);
    assert.equal(imageOriginalSourceRegistry.getFile('node-leased-output', 'file-image-leased', {
      workflowId: 'workflow-leased-output',
    }), resource?.file);
    assert.equal(imageThumbnailRuntimeStore.get('node-leased-output'), null);
    assert.deepEqual(urlMock.revoked, ['blob:runtime-1', 'blob:runtime-2']);
    assert.equal(getExecutionOutputRuntimeResource('file-image-leased')?.objectUrl, 'blob:runtime-3');

    fileResourceLeaseManager.releaseLease(lease.leaseId);
    clearExecutionOutputRuntimeResources();

    assert.equal(getExecutionOutputRuntimeResource('file-image-leased'), null);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    urlMock.restore();
    resetRuntimeState();
  }
});
