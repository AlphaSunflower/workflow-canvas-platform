import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProtectedResourceService,
  isEphemeralResourceUrl,
} from './protected-resource';
import type { ProtectedResourceOptions } from './protected-resource.types';

function createTimerHarness() {
  let nextId = 0;
  const timers = new Map<number, () => void>();

  return {
    setTimeoutImpl: ((callback: () => void) => {
      nextId += 1;
      timers.set(nextId, callback);
      return nextId as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutImpl: ((handle: ReturnType<typeof setTimeout>) => {
      timers.delete(handle as unknown as number);
    }) as typeof clearTimeout,
    flushAll: () => {
      const callbacks = Array.from(timers.values());
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

test('protected resource service single-flights protected object url requests and revokes after final release', async () => {
  const protectedRequests: string[] = [];
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  const timers = createTimerHarness();

  const service = createProtectedResourceService({
    fetchProtectedBlob: async (path: string, _options?: ProtectedResourceOptions) => {
      protectedRequests.push(path);
      return new Blob([path], { type: 'image/png' });
    },
    createObjectUrl: () => {
      const url = `blob:protected-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectUrl: (url: string) => {
      revokedUrls.push(url);
    },
    getCurrentOrigin: () => 'http://localhost:3000',
    retainMs: 300,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  const [firstHandle, secondHandle] = await Promise.all([
    service.acquireObjectUrl('/api/v1/files/file-1/preview'),
    service.acquireObjectUrl('http://localhost:3000/api/v1/files/file-1/preview'),
  ]);

  assert.equal(firstHandle.url, 'blob:protected-1');
  assert.equal(secondHandle.url, 'blob:protected-1');
  assert.equal(firstHandle.protected, true);
  assert.equal(secondHandle.protected, true);
  assert.deepEqual(protectedRequests, ['/api/v1/files/file-1/preview']);

  firstHandle.release();
  assert.deepEqual(revokedUrls, []);

  secondHandle.release();
  assert.deepEqual(revokedUrls, []);

  const thirdHandle = await service.acquireObjectUrl('/api/v1/files/file-1/preview');
  assert.equal(thirdHandle.url, 'blob:protected-1');
  assert.deepEqual(protectedRequests, ['/api/v1/files/file-1/preview']);
  thirdHandle.release();

  timers.flushAll();
  assert.deepEqual(revokedUrls, ['blob:protected-1']);
});

test('protected resource service treats api base origin file urls as protected resources', async () => {
  const protectedRequests: string[] = [];

  const service = createProtectedResourceService({
    fetchProtectedBlob: async (path: string) => {
      protectedRequests.push(path);
      return new Blob([path], { type: 'image/png' });
    },
    createObjectUrl: () => 'blob:protected-api-origin',
    revokeObjectUrl: () => undefined,
    getCurrentOrigin: () => 'http://localhost:3000',
    getApiOrigin: () => 'http://localhost:3100',
  });

  const handle = await service.acquireObjectUrl('http://localhost:3100/api/v1/files/file-2/download');

  assert.equal(handle.url, 'blob:protected-api-origin');
  assert.equal(handle.protected, true);
  assert.deepEqual(protectedRequests, ['/api/v1/files/file-2/download']);
  handle.release();
});

test('protected resource service passes through non-protected urls without object url allocation', async () => {
  let protectedRequestCount = 0;
  let externalRequestCount = 0;
  let objectUrlCount = 0;

  const service = createProtectedResourceService({
    fetchProtectedBlob: async () => {
      protectedRequestCount += 1;
      return new Blob();
    },
    fetchExternalBlob: async () => {
      externalRequestCount += 1;
      return new Blob(['external']);
    },
    createObjectUrl: () => {
      objectUrlCount += 1;
      return 'blob:unused';
    },
  });

  const handle = await service.acquireObjectUrl('https://example.com/image.png');
  assert.equal(handle.url, 'https://example.com/image.png');
  assert.equal(handle.protected, false);
  handle.release();

  const blob = await service.fetchBlob('https://example.com/image.png');
  assert.equal(await blob.text(), 'external');
  assert.equal(protectedRequestCount, 0);
  assert.equal(externalRequestCount, 1);
  assert.equal(objectUrlCount, 0);
});

test('protected resource service releases inflight cache entry after aborted acquire', async () => {
  let protectedRequestCount = 0;
  const timers = createTimerHarness();

  const service = createProtectedResourceService({
    fetchProtectedBlob: async () => {
      protectedRequestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return new Blob(['preview']);
    },
    createObjectUrl: () => 'blob:protected-preview',
    revokeObjectUrl: () => undefined,
    retainMs: 100,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => service.acquireObjectUrl('/api/v1/files/file-2/preview', { signal: controller.signal }),
    (error: unknown) => {
      assert.equal((error as Error).name, 'AbortError');
      return true;
    },
  );

  const handle = await service.acquireObjectUrl('/api/v1/files/file-2/preview');
  assert.equal(handle.url, 'blob:protected-preview');
  assert.equal(protectedRequestCount, 1);
  handle.release();
});

test('protected resource service reuses protected blob fetches without forcing object url allocation', async () => {
  let protectedRequestCount = 0;
  let objectUrlCount = 0;

  const service = createProtectedResourceService({
    fetchProtectedBlob: async () => {
      protectedRequestCount += 1;
      return new Blob(['blob-only']);
    },
    createObjectUrl: () => {
      objectUrlCount += 1;
      return `blob:generated-${objectUrlCount}`;
    },
  });

  const firstBlob = await service.fetchBlob('/api/v1/files/file-9/preview');
  const secondBlob = await service.fetchBlob('/api/v1/files/file-9/preview');

  assert.equal(await firstBlob.text(), 'blob-only');
  assert.equal(await secondBlob.text(), 'blob-only');
  assert.equal(protectedRequestCount, 1);
  assert.equal(objectUrlCount, 0);
});

test('protected resource service restores protected thumbnails from persistent cache across service instances', async () => {
  let protectedRequestCount = 0;
  const store = new Map<string, Blob>();

  const createService = () => createProtectedResourceService({
    fetchProtectedBlob: async () => {
      protectedRequestCount += 1;
      return {
        blob: new Blob(['network-thumbnail']),
        metadata: {
          etag: '"thumb-v1"',
        },
      };
    },
    persistentStore: {
      get: async (key) => store.get(key) ?? null,
      put: async (key, blob) => {
        store.set(key, blob);
      },
      delete: async (key) => {
        store.delete(key);
      },
      clear: async () => {
        store.clear();
      },
    },
    getAuthScope: () => 'user-a',
  });

  const firstBlob = await createService().fetchBlob('/api/v1/files/file-persisted/thumbnail');
  const secondBlob = await createService().fetchBlob('/api/v1/files/file-persisted/thumbnail');

  assert.equal(await firstBlob.text(), 'network-thumbnail');
  assert.equal(await secondBlob.text(), 'network-thumbnail');
  assert.equal(protectedRequestCount, 1);
});

test('protected resource service refreshes persistent cache when network returns a new version', async () => {
  const writes: Array<{ key: string; text: string; etag?: string }> = [];
  const store = new Map<string, Blob>();
  let version = 1;

  const service = createProtectedResourceService({
    fetchProtectedBlob: async () => ({
      blob: new Blob([`network-v${version}`]),
      metadata: {
        etag: `"v${version}"`,
      },
    }),
    persistentStore: {
      get: async (key) => store.get(key) ?? null,
      put: async (key, blob, metadata) => {
        writes.push({
          key,
          text: await blob.text(),
          etag: metadata?.etag,
        });
        store.set(key, blob);
      },
      delete: async (key) => {
        store.delete(key);
      },
      clear: async () => {
        store.clear();
      },
    },
    getAuthScope: () => 'user-a',
    retainMs: 0,
  });

  const first = await service.fetchBlob('/api/v1/files/file-versioned/preview');
  service.clear();
  version = 2;
  store.clear();
  const second = await service.fetchBlob('/api/v1/files/file-versioned/preview');

  assert.equal(await first.text(), 'network-v1');
  assert.equal(await second.text(), 'network-v2');
  assert.deepEqual(writes.map((write) => write.etag), ['"v1"', '"v2"']);
});

test('protected resource service falls back to network when persistent cache fails', async () => {
  let protectedRequestCount = 0;

  const service = createProtectedResourceService({
    fetchProtectedBlob: async () => {
      protectedRequestCount += 1;
      return {
        blob: new Blob(['network-after-cache-failure']),
        metadata: {
          etag: '"fallback"',
        },
      };
    },
    persistentStore: {
      get: async () => {
        throw new Error('cache read failed');
      },
      put: async () => {
        throw new Error('cache write failed');
      },
      delete: async () => undefined,
      clear: async () => undefined,
    },
    getAuthScope: () => 'user-a',
  });

  const blob = await service.fetchBlob('/api/v1/files/file-cache-failure/preview');

  assert.equal(await blob.text(), 'network-after-cache-failure');
  assert.equal(protectedRequestCount, 1);
});

test('protected resource service persists thumbnail and preview by default but not download', async () => {
  const protectedRequests: string[] = [];
  const persistentReads: Array<{ key: string; scope?: string }> = [];
  const persistentWrites: Array<{ key: string; scope?: string; text: string }> = [];

  const service = createProtectedResourceService({
    fetchProtectedBlob: async (path) => {
      protectedRequests.push(path);
      return {
        blob: new Blob([path], { type: 'image/png' }),
        metadata: {
          etag: `"${path}"`,
          contentType: 'image/png',
        },
      };
    },
    persistentStore: {
      get: async (key, options) => {
        persistentReads.push({
          key,
          scope: options?.scope,
        });
        return null;
      },
      put: async (key, blob, _metadata, options) => {
        persistentWrites.push({
          key,
          scope: options?.scope,
          text: await blob.text(),
        });
      },
      delete: async () => undefined,
      clear: async () => undefined,
    },
    getAuthScope: () => 'user-a',
    retainMs: 0,
  });

  const thumbnailPath = '/api/v1/files/file-cache-boundary/thumbnail';
  const previewPath = '/api/v1/files/file-cache-boundary/preview';
  const downloadPath = '/api/v1/files/file-cache-boundary/download';

  await service.fetchBlob(thumbnailPath);
  await service.fetchBlob(previewPath);
  await service.fetchBlob(downloadPath);

  assert.deepEqual(protectedRequests, [
    thumbnailPath,
    previewPath,
    downloadPath,
  ]);
  assert.deepEqual(persistentReads, [
    { key: thumbnailPath, scope: 'user-a' },
    { key: previewPath, scope: 'user-a' },
  ]);
  assert.deepEqual(persistentWrites, [
    { key: thumbnailPath, scope: 'user-a', text: thumbnailPath },
    { key: previewPath, scope: 'user-a', text: previewPath },
  ]);
});

test('protected resource service caches access-denied failures for protected file paths', async () => {
  let protectedRequestCount = 0;

  const service = createProtectedResourceService({
    fetchProtectedBlob: async () => {
      protectedRequestCount += 1;
      const error = new Error('当前账户无权执行该操作。') as Error & {
        code: string;
        context: Record<string, unknown>;
      };
      error.code = 'AUTH_FORBIDDEN';
      error.context = {
        status: 403,
      };
      throw error;
    },
  });

  await assert.rejects(
    () => service.fetchBlob('/api/v1/files/file-denied/download'),
    (error: unknown) => {
      const appError = error as {
        code?: string;
        message?: string;
        context?: { accessDenied?: unknown };
      };
      assert.equal(appError.code, 'DOWNLOAD_ERROR');
      assert.ok((appError.message ?? '').includes('产物文件不可访问'));
      assert.equal(appError.context?.accessDenied, true);
      return true;
    },
  );
  await assert.rejects(
    () => service.fetchBlob('/api/v1/files/file-denied/download'),
    (error: unknown) => {
      const appError = error as {
        code?: string;
        message?: string;
        context?: { accessDenied?: unknown };
      };
      assert.equal(appError.code, 'DOWNLOAD_ERROR');
      assert.ok((appError.message ?? '').includes('产物文件不可访问'));
      assert.equal(appError.context?.accessDenied, true);
      return true;
    },
  );

  assert.equal(protectedRequestCount, 1);
});

test('protected resource service clear revokes retained object urls immediately', async () => {
  const revokedUrls: string[] = [];
  const service = createProtectedResourceService({
    fetchProtectedBlob: async () => new Blob(['preview']),
    createObjectUrl: () => 'blob:protected-clear',
    revokeObjectUrl: (url) => {
      revokedUrls.push(url);
    },
    retainMs: 500,
  });

  const handle = await service.acquireObjectUrl('/api/v1/files/file-10/preview');
  handle.release();
  service.clear();

  assert.deepEqual(revokedUrls, ['blob:protected-clear']);
  assert.deepEqual(service.getDebugSnapshot(), []);
});

test('protected resource service session clear also clears persistent protected cache', async () => {
  let persistentClearCount = 0;
  const revokedUrls: string[] = [];
  const service = createProtectedResourceService({
    fetchProtectedBlob: async () => ({
      blob: new Blob(['download'], { type: 'image/png' }),
      metadata: {
        etag: 'etag-session-clear',
      },
    }),
    createObjectUrl: () => 'blob:protected-session-clear',
    revokeObjectUrl: (url) => {
      revokedUrls.push(url);
    },
    persistentStore: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
      clear: async () => {
        persistentClearCount += 1;
      },
    },
  });

  const handle = await service.acquireObjectUrl('/api/v1/files/file-session/download');
  handle.release();
  service.clearSession();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(revokedUrls, ['blob:protected-session-clear']);
  assert.equal(persistentClearCount, 1);
  assert.deepEqual(service.getDebugSnapshot(), []);
});

test('isEphemeralResourceUrl treats blob, runtime and file urls as ephemeral', () => {
  assert.equal(isEphemeralResourceUrl('blob:http://localhost/a'), true);
  assert.equal(isEphemeralResourceUrl('runtime:thumbnail-1'), true);
  assert.equal(isEphemeralResourceUrl('file:///tmp/a.png'), true);
  assert.equal(isEphemeralResourceUrl('/api/v1/files/a/thumbnail'), false);
});
