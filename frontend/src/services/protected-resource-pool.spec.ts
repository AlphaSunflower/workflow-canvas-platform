import test from 'node:test';
import assert from 'node:assert/strict';

import { createProtectedResourcePool } from './protected-resource-pool';

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

test('protected resource pool reuses inflight blob and object url handles within retain window', async () => {
  const requests: string[] = [];
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  const timers = createTimerHarness();

  const pool = createProtectedResourcePool({
    fetchBlob: async (key) => {
      requests.push(key);
      return {
        blob: new Blob([key], { type: 'image/png' }),
      };
    },
    createObjectUrl: () => {
      const url = `blob:pool-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectUrl: (url) => {
      revokedUrls.push(url);
    },
    retainMs: 500,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  const [first, second] = await Promise.all([
    pool.acquireObjectUrl('/api/v1/files/file-1/preview', '/api/v1/files/file-1/preview'),
    pool.acquireObjectUrl('/api/v1/files/file-1/preview', '/api/v1/files/file-1/preview'),
  ]);

  assert.equal(first.url, 'blob:pool-1');
  assert.equal(second.url, 'blob:pool-1');
  assert.equal(requests.length, 1);

  first.release();
  second.release();
  assert.deepEqual(revokedUrls, []);

  const third = await pool.acquireObjectUrl('/api/v1/files/file-1/preview', '/api/v1/files/file-1/preview');
  assert.equal(third.url, 'blob:pool-1');
  assert.equal(requests.length, 1);
  third.release();

  timers.flushAll();
  assert.deepEqual(revokedUrls, ['blob:pool-1']);
});

test('protected resource pool keeps blob reusable across blob and object-url acquisitions', async () => {
  let requestCount = 0;
  const timers = createTimerHarness();

  const pool = createProtectedResourcePool({
    fetchBlob: async () => {
      requestCount += 1;
      return {
        blob: new Blob(['shared']),
      };
    },
    createObjectUrl: () => 'blob:shared',
    revokeObjectUrl: () => undefined,
    retainMs: 500,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  const blobHandle = await pool.acquireBlob('/api/v1/files/file-2/preview', '/api/v1/files/file-2/preview');
  const objectUrlHandle = await pool.acquireObjectUrl('/api/v1/files/file-2/preview', '/api/v1/files/file-2/preview');

  assert.equal(await blobHandle.blob.text(), 'shared');
  assert.equal(objectUrlHandle.url, 'blob:shared');
  assert.equal(requestCount, 1);

  blobHandle.release();
  objectUrlHandle.release();
});

test('protected resource pool aborts waiter without leaking retained entry lifecycle', async () => {
  const timers = createTimerHarness();
  let resolveBlob: ((blob: { blob: Blob }) => void) | undefined;
  let requestCount = 0;

  const pool = createProtectedResourcePool({
    fetchBlob: async () => {
      requestCount += 1;
      return new Promise<{ blob: Blob }>((resolve) => {
        resolveBlob = resolve;
      });
    },
    createObjectUrl: () => 'blob:abort',
    revokeObjectUrl: () => undefined,
    retainMs: 100,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  const controller = new AbortController();
  const pending = pool.acquireObjectUrl('/api/v1/files/file-3/preview', '/api/v1/files/file-3/preview', { signal: controller.signal });
  controller.abort();

  await assert.rejects(
    () => pending,
    (error: unknown) => {
      assert.equal((error as Error).name, 'AbortError');
      return true;
    },
  );

  resolveBlob?.({
    blob: new Blob(['late']),
  });
  const next = await pool.acquireObjectUrl('/api/v1/files/file-3/preview', '/api/v1/files/file-3/preview');
  assert.equal(next.url, 'blob:abort');
  assert.equal(requestCount, 1);
  next.release();
});

test('protected resource pool restores blob from persistent store before network fetch', async () => {
  let requestCount = 0;
  const persistentReads: string[] = [];
  const persistentWrites: string[] = [];

  const pool = createProtectedResourcePool({
    fetchBlob: async () => {
      requestCount += 1;
      return {
        blob: new Blob(['network']),
      };
    },
    persistentStore: {
      get: async (key) => {
        persistentReads.push(key);
        return new Blob(['persisted']);
      },
      put: async (key) => {
        persistentWrites.push(key);
      },
      delete: async () => undefined,
      clear: async () => undefined,
    },
  });

  const handle = await pool.acquireBlob('/api/v1/files/file-4/thumbnail#pv=v1', '/api/v1/files/file-4/thumbnail');

  assert.equal(await handle.blob.text(), 'persisted');
  assert.equal(handle.source, 'persistent');
  assert.equal(requestCount, 0);
  assert.deepEqual(persistentReads, ['/api/v1/files/file-4/thumbnail#pv=v1']);
  assert.deepEqual(persistentWrites, []);
  handle.release();
});

test('protected resource pool writes network result to persistent store and ignores store failures', async () => {
  let requestCount = 0;
  const persistentWrites: string[] = [];

  const pool = createProtectedResourcePool({
    fetchBlob: async () => {
      requestCount += 1;
      return {
        blob: new Blob(['network-v2']),
        metadata: {
          etag: '"v2"',
        },
      };
    },
    persistentStore: {
      get: async () => {
        throw new Error('persistent read failed');
      },
      put: async (key) => {
        persistentWrites.push(key);
        throw new Error('persistent write failed');
      },
      delete: async () => undefined,
      clear: async () => undefined,
    },
  });

  const handle = await pool.acquireBlob('/api/v1/files/file-5/preview#pv=v2', '/api/v1/files/file-5/preview');

  assert.equal(await handle.blob.text(), 'network-v2');
  assert.equal(handle.source, 'network');
  assert.equal(requestCount, 1);
  assert.deepEqual(persistentWrites, ['/api/v1/files/file-5/preview#pv=v2']);
  handle.release();
});

test('protected resource pool keeps download inflight requests single-flighted without persistent cache', async () => {
  let requestCount = 0;
  const persistentReads: string[] = [];
  const persistentWrites: string[] = [];
  let resolveFetch: ((value: { blob: Blob }) => void) | undefined;

  const pool = createProtectedResourcePool({
    fetchBlob: async () => {
      requestCount += 1;
      return new Promise<{ blob: Blob }>((resolve) => {
        resolveFetch = resolve;
      });
    },
    persistentStore: {
      get: async (key) => {
        persistentReads.push(key);
        return null;
      },
      put: async (key) => {
        persistentWrites.push(key);
      },
      delete: async () => undefined,
      clear: async () => undefined,
    },
    getPersistentOptions: () => null,
  });

  const firstPending = pool.acquireBlob('/api/v1/files/file-6/download', '/api/v1/files/file-6/download');
  const secondPending = pool.acquireBlob('/api/v1/files/file-6/download', '/api/v1/files/file-6/download');

  assert.equal(requestCount, 1);
  assert.deepEqual(persistentReads, []);

  resolveFetch?.({
    blob: new Blob(['download-original']),
  });

  const [first, second] = await Promise.all([firstPending, secondPending]);

  assert.equal(await first.blob.text(), 'download-original');
  assert.equal(await second.blob.text(), 'download-original');
  assert.equal(requestCount, 1);
  assert.deepEqual(persistentReads, []);
  assert.deepEqual(persistentWrites, []);

  first.release();
  second.release();
});

test('protected resource pool reuses and then revokes object url across repeated viewer sessions', async () => {
  let requestCount = 0;
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  const timers = createTimerHarness();

  const pool = createProtectedResourcePool({
    fetchBlob: async () => {
      requestCount += 1;
      return {
        blob: new Blob(['original-viewer'], { type: 'image/png' }),
      };
    },
    createObjectUrl: () => {
      const url = `blob:viewer-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectUrl: (url) => {
      revokedUrls.push(url);
    },
    retainMs: 250,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });

  const first = await pool.acquireObjectUrl('/api/v1/files/file-7/download', '/api/v1/files/file-7/download');
  assert.equal(first.url, 'blob:viewer-1');
  first.release();

  assert.deepEqual(pool.getSnapshot(), [{
    key: '/api/v1/files/file-7/download',
    hasBlob: true,
    hasObjectUrl: true,
    hasInflight: false,
    refCount: 0,
    waiterCount: 0,
    cleanupScheduled: true,
  }]);

  const second = await pool.acquireObjectUrl('/api/v1/files/file-7/download', '/api/v1/files/file-7/download');
  assert.equal(second.url, 'blob:viewer-1');
  second.release();

  const third = await pool.acquireObjectUrl('/api/v1/files/file-7/download', '/api/v1/files/file-7/download');
  assert.equal(third.url, 'blob:viewer-1');
  third.release();

  assert.equal(requestCount, 1);
  assert.deepEqual(createdUrls, ['blob:viewer-1']);
  assert.deepEqual(revokedUrls, []);

  timers.flushAll();

  assert.deepEqual(revokedUrls, ['blob:viewer-1']);
  assert.deepEqual(pool.getSnapshot(), []);
});
