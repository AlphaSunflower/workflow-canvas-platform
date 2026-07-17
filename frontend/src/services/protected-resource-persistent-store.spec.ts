import test from 'node:test';
import assert from 'node:assert/strict';

import { createProtectedResourcePersistentStore } from './protected-resource-persistent-store';

class MemoryCache {
  private readonly entries = new Map<string, Response>();

  async keys(): Promise<Request[]> {
    return Array.from(this.entries.keys()).map((url) => new Request(url));
  }

  async match(request: Request): Promise<Response | undefined> {
    const response = this.entries.get(request.url);
    return response ? response.clone() : undefined;
  }

  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, response.clone());
  }

  async delete(request: Request): Promise<boolean> {
    return this.entries.delete(request.url);
  }
}

class MemoryCacheStorage {
  private readonly cachesMap = new Map<string, MemoryCache>();

  async open(name: string): Promise<MemoryCache> {
    const cache = this.cachesMap.get(name) ?? new MemoryCache();
    this.cachesMap.set(name, cache);
    return cache;
  }

  async delete(name: string): Promise<boolean> {
    return this.cachesMap.delete(name);
  }
}

test('persistent store returns latest version for same file variant and scope', async () => {
  const cacheStorage = new MemoryCacheStorage() as unknown as CacheStorage;
  const store = createProtectedResourcePersistentStore({
    cacheStorage,
    now: (() => {
      let current = 100;
      return () => ++current;
    })(),
  });

  await store.put('/api/v1/files/file-1/preview', new Blob(['v1']), {
    etag: '"v1"',
  }, {
    scope: 'user-a',
  });
  await store.put('/api/v1/files/file-1/preview', new Blob(['v2']), {
    etag: '"v2"',
  }, {
    scope: 'user-a',
  });

  const hit = await store.get('/api/v1/files/file-1/preview', { scope: 'user-a' });
  assert.equal(await hit?.text(), 'v2');
});

test('persistent store honors version hint and misses when requested version is absent', async () => {
  const cacheStorage = new MemoryCacheStorage() as unknown as CacheStorage;
  const store = createProtectedResourcePersistentStore({
    cacheStorage,
    now: (() => {
      let current = 200;
      return () => ++current;
    })(),
  });

  await store.put('/api/v1/files/file-1/preview', new Blob(['v1']), {
    etag: '"v1"',
  }, {
    scope: 'user-a',
  });

  const exactHit = await store.get('/api/v1/files/file-1/preview', {
    scope: 'user-a',
    versionHint: '"v1"',
  });
  const exactMiss = await store.get('/api/v1/files/file-1/preview', {
    scope: 'user-a',
    versionHint: '"v2"',
  });

  assert.equal(await exactHit?.text(), 'v1');
  assert.equal(exactMiss, null);
});

test('persistent store isolates scopes for protected resources', async () => {
  const cacheStorage = new MemoryCacheStorage() as unknown as CacheStorage;
  const store = createProtectedResourcePersistentStore({
    cacheStorage,
  });

  await store.put('/api/v1/files/file-2/thumbnail', new Blob(['owner-a']), {
    etag: '"owner-a"',
  }, {
    scope: 'owner-a',
  });

  const ownerA = await store.get('/api/v1/files/file-2/thumbnail', { scope: 'owner-a' });
  const ownerB = await store.get('/api/v1/files/file-2/thumbnail', { scope: 'owner-b' });

  assert.equal(await ownerA?.text(), 'owner-a');
  assert.equal(ownerB, null);
});

test('persistent store ignores writes without stable version metadata', async () => {
  const cacheStorage = new MemoryCacheStorage() as unknown as CacheStorage;
  const store = createProtectedResourcePersistentStore({
    cacheStorage,
  });

  await store.put('/api/v1/files/file-3/download', new Blob(['no-version']), undefined, {
    scope: 'user-a',
  });

  const hit = await store.get('/api/v1/files/file-3/download', { scope: 'user-a' });
  assert.equal(hit, null);
});
