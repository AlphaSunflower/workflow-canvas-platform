import { httpClient } from '@/api/client/http-client';
import type { AppError } from '@/types';
import { createProtectedResourcePool } from './protected-resource-pool';
import {
  protectedResourcePersistentStore,
  type ProtectedResourcePersistentStore,
} from './protected-resource-persistent-store';
import type {
  ProtectedResourceBlobHandle,
  ProtectedResourceFetchResult,
  ProtectedResourceHandle,
  ProtectedResourceOptions,
} from './protected-resource.types';
import {
  createExecutionOutputAccessDeniedError,
  isExecutionOutputAccessDeniedError,
} from './execution-output-access-error';

const PROTECTED_FILE_PATH_PREFIX = '/api/v1/files/';
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

export function isEphemeralResourceUrl(url: string | null | undefined): boolean {
  return typeof url === 'string'
    && (url.startsWith('blob:') || url.startsWith('runtime:') || url.startsWith('file:'));
}

interface ProtectedResourceService {
  acquireBlob: (url: string, options?: ProtectedResourceOptions) => Promise<ProtectedResourceBlobHandle>;
  acquireObjectUrl: (url: string, options?: ProtectedResourceOptions) => Promise<ProtectedResourceHandle>;
  clear: () => void;
  clearSession: () => void;
  fetchBlob: (url: string, options?: ProtectedResourceOptions) => Promise<Blob>;
  getDebugSnapshot: ReturnType<typeof createProtectedResourcePool>['getSnapshot'];
  isProtectedUrl: (url: string) => boolean;
}

interface CreateProtectedResourceServiceOptions {
  fetchProtectedBlob?: (path: string, options?: ProtectedResourceOptions) => Promise<Blob | ProtectedResourceFetchResult>;
  fetchExternalBlob?: (url: string, options?: ProtectedResourceOptions) => Promise<Blob>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  persistentStore?: ProtectedResourcePersistentStore | null;
  getCurrentOrigin?: () => string | undefined;
  getApiOrigin?: () => string | undefined;
  getAuthScope?: () => string | undefined;
  retainMs?: number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

interface ProtectedAccessFailureEntry {
  error: AppError;
  fileId: string;
}

function createAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }

  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createDefaultExternalBlobFetcher(): (url: string, options?: ProtectedResourceOptions) => Promise<Blob> {
  return async (url, options) => {
    const response = await fetch(url, { signal: options?.signal });
    if (!response.ok) {
      throw new Error(`FETCH_RESOURCE_FAILED:${response.status}`);
    }

    return response.blob();
  };
}

function isProtectedResourceFetchResult(value: Blob | ProtectedResourceFetchResult): value is ProtectedResourceFetchResult {
  return typeof value === 'object' && value !== null && 'blob' in value;
}

function normalizeFetchResult(value: Blob | ProtectedResourceFetchResult): ProtectedResourceFetchResult {
  return isProtectedResourceFetchResult(value)
    ? value
    : { blob: value };
}

function createDefaultProtectedBlobFetcher(): (path: string, options?: ProtectedResourceOptions) => Promise<ProtectedResourceFetchResult> {
  return async (path, requestOptions) => {
    const result = await httpClient.requestRaw('GET', path, {
      signal: requestOptions?.signal,
    });

    if (!result.success) {
      throw result.error;
    }

    const response = result.data;
    return {
      blob: await response.blob(),
      metadata: {
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
        cacheControl: response.headers.get('cache-control') ?? undefined,
        contentType: response.headers.get('content-type') ?? undefined,
      },
    };
  };
}

function createAuthScope(): string | undefined {
  const token = httpClient.getAuthToken();
  return token ? `auth:${token}` : undefined;
}

function createPoolKey(protectedPath: string, options?: ProtectedResourceOptions): string {
  const version = options?.persistentVersion?.trim();
  return version
    ? `${protectedPath}#pv=${encodeURIComponent(version)}`
    : protectedPath;
}

function shouldUsePersistentCacheByDefault(protectedPath: string): boolean {
  const normalizedPath = protectedPath.split('#')[0] ?? protectedPath;
  return /^\/api\/v1\/files\/[^/?#]+\/(?:thumbnail|preview)(?:[?#].*)?$/.test(normalizedPath);
}

export function createProtectedResourceService(
  options: CreateProtectedResourceServiceOptions = {},
): ProtectedResourceService {
  const fetchProtectedBlob = options.fetchProtectedBlob ?? createDefaultProtectedBlobFetcher();
  const fetchExternalBlob = options.fetchExternalBlob ?? createDefaultExternalBlobFetcher();
  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob): string => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string): void => URL.revokeObjectURL(url));
  const persistentStore = options.persistentStore === undefined
    ? protectedResourcePersistentStore
    : options.persistentStore;
  const getAuthScope = options.getAuthScope ?? createAuthScope;
  const getCurrentOrigin = options.getCurrentOrigin ?? ((): string | undefined => {
    if (typeof window === 'undefined' || !window.location?.origin) {
      return undefined;
    }

    return window.location.origin;
  });
  const getApiOrigin = options.getApiOrigin ?? ((): string | undefined => {
    const baseUrl = httpClient.getBaseURL().trim();
    if (!baseUrl) {
      return undefined;
    }

    try {
      return new URL(baseUrl, getCurrentOrigin() ?? undefined).origin;
    } catch {
      return undefined;
    }
  });
  const pool = createProtectedResourcePool({
    fetchBlob: async (path, requestOptions): Promise<ProtectedResourceFetchResult> => normalizeFetchResult(await fetchProtectedBlob(path, requestOptions)),
    createObjectUrl,
    revokeObjectUrl,
    persistentStore: persistentStore ?? undefined,
    getPersistentOptions: (path, requestOptions): { scope: string | undefined; versionHint: string | undefined } | null => {
      const persistentEnabled = requestOptions?.persistentEnabled;
      if (persistentEnabled !== true && !shouldUsePersistentCacheByDefault(path)) {
        return null;
      }

      return {
        scope: getAuthScope(),
        versionHint: requestOptions?.persistentVersion,
      };
    },
    retainMs: options.retainMs,
    setTimeoutImpl: options.setTimeoutImpl,
    clearTimeoutImpl: options.clearTimeoutImpl,
  });
  const accessFailureCache = new Map<string, ProtectedAccessFailureEntry>();

  function resolveFileIdFromProtectedPath(protectedPath: string): string | null {
    const matched = protectedPath.match(/^\/api\/v1\/files\/([^/]+)\//);
    return matched?.[1] ?? null;
  }

  function getCachedAccessFailure(protectedPath: string): AppError | null {
    return accessFailureCache.get(protectedPath)?.error ?? null;
  }

  function cacheAccessFailure(protectedPath: string, error: unknown): AppError {
    const fileId = resolveFileIdFromProtectedPath(protectedPath) ?? protectedPath;
    const normalized = createExecutionOutputAccessDeniedError({
      fileId,
      module: 'protected-resource',
      operation: 'fetchBlob',
      cause: error,
      path: protectedPath,
    });
    accessFailureCache.set(protectedPath, {
      error: normalized,
      fileId,
    });
    return normalized;
  }

  function clearAccessFailureForPath(protectedPath: string): void {
    accessFailureCache.delete(protectedPath);
  }

  function resolveProtectedPath(url: string): string | null {
    const trimmed = url.trim();
    if (!trimmed) {
      return null;
    }

    if (!ABSOLUTE_URL_PATTERN.test(trimmed) && trimmed.startsWith(PROTECTED_FILE_PATH_PREFIX)) {
      return trimmed;
    }

    if (isEphemeralResourceUrl(trimmed) || trimmed.startsWith('data:')) {
      return null;
    }

    const currentOrigin = getCurrentOrigin();
    const apiOrigin = getApiOrigin();
    const allowedOrigins = [currentOrigin, apiOrigin].filter((value, index, collection): value is string => (
      typeof value === 'string'
      && value.length > 0
      && collection.indexOf(value) === index
    ));
    if (allowedOrigins.length === 0) {
      return null;
    }

    try {
      const parsed = new URL(trimmed, currentOrigin ?? apiOrigin);
      if (!allowedOrigins.includes(parsed.origin) || !parsed.pathname.startsWith(PROTECTED_FILE_PATH_PREFIX)) {
        return null;
      }

      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return null;
    }
  }

  async function fetchBlob(url: string, requestOptions?: ProtectedResourceOptions): Promise<Blob> {
    const protectedPath = resolveProtectedPath(url);
    if (protectedPath) {
      const cachedFailure = getCachedAccessFailure(protectedPath);
      if (cachedFailure) {
        throw cachedFailure;
      }

      try {
        const poolKey = createPoolKey(protectedPath, requestOptions);
        const blob = await pool.fetchBlob(poolKey, protectedPath, {
          ...requestOptions,
        });
        clearAccessFailureForPath(protectedPath);
        return blob;
      } catch (error) {
        if (isExecutionOutputAccessDeniedError(error)) {
          throw cacheAccessFailure(protectedPath, error);
        }
        throw error;
      }
    }

    return fetchExternalBlob(url, requestOptions);
  }

  async function acquireObjectUrl(
    url: string,
    requestOptions?: ProtectedResourceOptions,
  ): Promise<ProtectedResourceHandle> {
    const protectedPath = resolveProtectedPath(url);
    if (!protectedPath) {
      throwIfAborted(requestOptions?.signal);
      return {
        url,
        protected: false,
        release: (): void => undefined,
      };
    }

    const cachedFailure = getCachedAccessFailure(protectedPath);
    if (cachedFailure) {
      throw cachedFailure;
    }

    let handle;
    try {
      const poolKey = createPoolKey(protectedPath, requestOptions);
      handle = await pool.acquireObjectUrl(poolKey, protectedPath, {
        ...requestOptions,
      });
      clearAccessFailureForPath(protectedPath);
    } catch (error) {
      if (isExecutionOutputAccessDeniedError(error)) {
        throw cacheAccessFailure(protectedPath, error);
      }
      throw error;
    }
    return {
      url: handle.url,
      protected: true,
      blob: handle.blob,
      release: handle.release,
    };
  }

  async function acquireBlob(
    url: string,
    requestOptions?: ProtectedResourceOptions,
  ): Promise<ProtectedResourceBlobHandle> {
    const protectedPath = resolveProtectedPath(url);
    if (!protectedPath) {
      return {
        blob: await fetchExternalBlob(url, requestOptions),
        protected: false,
        release: (): void => undefined,
      };
    }

    const cachedFailure = getCachedAccessFailure(protectedPath);
    if (cachedFailure) {
      throw cachedFailure;
    }

    let handle;
    try {
      const poolKey = createPoolKey(protectedPath, requestOptions);
      handle = await pool.acquireBlob(poolKey, protectedPath, {
        ...requestOptions,
      });
      clearAccessFailureForPath(protectedPath);
    } catch (error) {
      if (isExecutionOutputAccessDeniedError(error)) {
        throw cacheAccessFailure(protectedPath, error);
      }
      throw error;
    }
    return {
      blob: handle.blob,
      protected: true,
      release: handle.release,
    };
  }

  function isProtectedUrl(url: string): boolean {
    return resolveProtectedPath(url) !== null;
  }

  function clear(): void {
    pool.clear();
    accessFailureCache.clear();
  }

  function clearSession(): void {
    clear();
    void persistentStore?.clear();
  }

  return {
    acquireBlob,
    acquireObjectUrl,
    clear,
    clearSession,
    fetchBlob,
    getDebugSnapshot: pool.getSnapshot,
    isProtectedUrl,
  };
}

export const protectedResourceService = createProtectedResourceService();

export function isProtectedResourceUrl(url: string): boolean {
  return protectedResourceService.isProtectedUrl(url);
}

export function fetchProtectedResourceBlob(
  url: string,
  options?: ProtectedResourceOptions,
): Promise<Blob> {
  return protectedResourceService.fetchBlob(url, options);
}

export function acquireProtectedResourceUrl(
  url: string,
  options?: ProtectedResourceOptions,
): Promise<ProtectedResourceHandle> {
  return protectedResourceService.acquireObjectUrl(url, options);
}

export function acquireProtectedResourceBlob(
  url: string,
  options?: ProtectedResourceOptions,
): Promise<{ blob: Blob; protected: boolean; release: () => void }> {
  return protectedResourceService.acquireBlob(url, options);
}

export function clearProtectedResourceCache(): void {
  protectedResourceService.clear();
}

export function clearProtectedResourceSessionCache(): void {
  protectedResourceService.clearSession();
}

export type {
  ProtectedResourceBlobHandle,
  ProtectedResourceFetchResult,
  ProtectedResourceHandle,
  ProtectedResourceOptions,
} from './protected-resource.types';
