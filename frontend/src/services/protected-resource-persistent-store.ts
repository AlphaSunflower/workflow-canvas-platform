export type ProtectedResourceVariant = 'thumbnail' | 'preview' | 'download';

export interface ProtectedResourcePersistentMetadata {
  etag?: string;
  lastModified?: string;
  cacheControl?: string;
  contentType?: string;
}

export interface ProtectedResourcePersistentOptions {
  scope?: string;
  versionHint?: string;
}

export interface ProtectedResourcePersistentStore {
  get: (resourcePath: string, options?: ProtectedResourcePersistentOptions) => Promise<Blob | null>;
  put: (
    resourcePath: string,
    blob: Blob,
    metadata?: ProtectedResourcePersistentMetadata,
    options?: ProtectedResourcePersistentOptions,
  ) => Promise<void>;
  delete: (resourcePath: string, options?: ProtectedResourcePersistentOptions) => Promise<void>;
  clear: () => Promise<void>;
}

export interface ProtectedResourcePersistentStoreOptions {
  cacheName?: string;
  cacheStorage?: CacheStorage;
  now?: () => number;
}

interface ProtectedResourceCacheIdentity {
  fileId: string;
  variant: ProtectedResourceVariant;
}

const DEFAULT_CACHE_NAME = 'newworkflow-protected-resources-v1';
const CACHE_KEY_PREFIX = '/__newworkflow/protected-resources';

function parseProtectedResourcePath(resourcePath: string): ProtectedResourceCacheIdentity | null {
  const normalizedPath = resourcePath.split('#')[0] ?? resourcePath;
  const match = normalizedPath.match(/^\/api\/v1\/files\/([^/?#]+)\/(thumbnail|preview|download)(?:[?#].*)?$/);
  if (!match) {
    return null;
  }

  return {
    fileId: decodeURIComponent(match[1] ?? ''),
    variant: match[2] as ProtectedResourceVariant,
  };
}

function normalizeScope(scope: string | undefined): string {
  return scope && scope.trim().length > 0 ? scope.trim() : 'default';
}

function normalizeVersion(
  metadata?: ProtectedResourcePersistentMetadata,
  options?: ProtectedResourcePersistentOptions,
): string | null {
  const versionHint = options?.versionHint?.trim();
  if (versionHint) {
    return versionHint;
  }

  const etag = metadata?.etag?.trim();
  if (etag) {
    return etag;
  }

  const lastModified = metadata?.lastModified?.trim();
  if (lastModified) {
    return lastModified;
  }

  return null;
}

function encodePart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function createCachePath(
  identity: ProtectedResourceCacheIdentity,
  version: string,
  scope: string,
): string {
  return [
    CACHE_KEY_PREFIX,
    encodePart(normalizeScope(scope)),
    encodePart(identity.fileId),
    identity.variant,
    encodePart(version),
  ].join('/');
}

function createCacheUrl(cachePath: string): string {
  const origin = typeof globalThis.location?.origin === 'string'
    ? globalThis.location.origin
    : 'http://newworkflow.local';
  return new URL(cachePath, origin).toString();
}

function getCachePathFromRequest(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

function isSameScopeResource(
  request: Request,
  identity: ProtectedResourceCacheIdentity,
  scope: string,
): boolean {
  const path = getCachePathFromRequest(request);
  const prefix = [
    CACHE_KEY_PREFIX,
    encodePart(normalizeScope(scope)),
    encodePart(identity.fileId),
    identity.variant,
  ].join('/');

  return path.startsWith(`${prefix}/`);
}

function getStoredAt(response: Response): number {
  const value = Number(response.headers.get('x-newworkflow-stored-at'));
  return Number.isFinite(value) ? value : 0;
}

function getStoredVersion(response: Response): string | null {
  const version = response.headers.get('x-newworkflow-version')?.trim();
  return version && version.length > 0 ? version : null;
}

async function openCache(cacheStorage: CacheStorage | undefined, cacheName: string): Promise<Cache | null> {
  if (!cacheStorage) {
    return null;
  }

  return cacheStorage.open(cacheName);
}

export function createProtectedResourcePersistentStore(
  options: ProtectedResourcePersistentStoreOptions = {},
): ProtectedResourcePersistentStore {
  const cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
  const cacheStorage = options.cacheStorage ?? (typeof globalThis.caches !== 'undefined' ? globalThis.caches : undefined);
  const now = options.now ?? Date.now;

  async function findLatestResponse(
    cache: Cache,
    identity: ProtectedResourceCacheIdentity,
    scope: string,
  ): Promise<{
    request: Request;
    response: Response;
  } | null> {
    const requests = await cache.keys();
    let latest: {
      request: Request;
      response: Response;
    } | null = null;

    for (const request of requests) {
      if (!isSameScopeResource(request, identity, scope)) {
        continue;
      }

      const response = await cache.match(request);
      if (!response) {
        continue;
      }

      if (!getStoredVersion(response)) {
        continue;
      }

      if (!latest || getStoredAt(response) > getStoredAt(latest.response)) {
        latest = {
          request,
          response,
        };
      }
    }

    return latest;
  }

  async function deleteStaleEntries(
    cache: Cache,
    identity: ProtectedResourceCacheIdentity,
    scope: string,
    retainedCacheUrl?: string,
  ): Promise<void> {
    const requests = await cache.keys();
    await Promise.all(requests.map(async (request) => {
      if (!isSameScopeResource(request, identity, scope)) {
        return;
      }

      if (retainedCacheUrl && request.url === retainedCacheUrl) {
        return;
      }

      await cache.delete(request);
    }));
  }

  return {
    async get(resourcePath, requestOptions): Promise<Blob | null> {
      const identity = parseProtectedResourcePath(resourcePath);
      if (!identity) {
        return null;
      }

      const cache = await openCache(cacheStorage, cacheName);
      if (!cache) {
        return null;
      }

      const scope = normalizeScope(requestOptions?.scope);
      const versionHint = requestOptions?.versionHint?.trim();
      if (versionHint) {
        const response = await cache.match(new Request(createCacheUrl(createCachePath(identity, versionHint, scope))));
        if (!response || getStoredVersion(response) !== versionHint) {
          return null;
        }

        return response.blob();
      }

      const latest = await findLatestResponse(cache, identity, scope);
      return latest ? latest.response.blob() : null;
    },

    async put(resourcePath, blob, metadata, requestOptions): Promise<void> {
      const identity = parseProtectedResourcePath(resourcePath);
      const version = normalizeVersion(metadata, requestOptions);
      if (!identity || !version) {
        return;
      }

      const cache = await openCache(cacheStorage, cacheName);
      if (!cache) {
        return;
      }

      const scope = normalizeScope(requestOptions?.scope);
      const cacheUrl = createCacheUrl(createCachePath(identity, version, scope));
      const headers = new Headers();
      headers.set('x-newworkflow-file-id', identity.fileId);
      headers.set('x-newworkflow-variant', identity.variant);
      headers.set('x-newworkflow-version', version);
      headers.set('x-newworkflow-stored-at', String(now()));
      if (metadata?.etag) {
        headers.set('etag', metadata.etag);
      }
      if (metadata?.lastModified) {
        headers.set('last-modified', metadata.lastModified);
      }
      if (metadata?.cacheControl) {
        headers.set('cache-control', metadata.cacheControl);
      }
      if (metadata?.contentType || blob.type) {
        headers.set('content-type', metadata?.contentType ?? blob.type);
      }

      await cache.put(new Request(cacheUrl), new Response(blob, {
        headers,
      }));
      await deleteStaleEntries(cache, identity, scope, cacheUrl);
    },

    async delete(resourcePath, requestOptions): Promise<void> {
      const identity = parseProtectedResourcePath(resourcePath);
      if (!identity) {
        return;
      }

      const cache = await openCache(cacheStorage, cacheName);
      if (!cache) {
        return;
      }

      await deleteStaleEntries(cache, identity, normalizeScope(requestOptions?.scope));
    },

    async clear(): Promise<void> {
      if (!cacheStorage) {
        return;
      }

      await cacheStorage.delete(cacheName);
    },
  };
}

export const protectedResourcePersistentStore = createProtectedResourcePersistentStore();
