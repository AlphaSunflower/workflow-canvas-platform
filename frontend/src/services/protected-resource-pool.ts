import type {
  ProtectedResourcePersistentOptions,
  ProtectedResourcePersistentStore,
} from './protected-resource-persistent-store';
import type {
  ProtectedResourceFetchResult,
  ProtectedResourceOptions,
} from './protected-resource.types';

export interface ProtectedBlobHandle {
  key: string;
  blob: Blob;
  release: () => void;
  source: 'memory' | 'persistent' | 'network';
}

export interface ProtectedObjectUrlHandle extends ProtectedBlobHandle {
  url: string;
}

export interface ProtectedResourcePoolSnapshotEntry {
  key: string;
  hasBlob: boolean;
  hasObjectUrl: boolean;
  hasInflight: boolean;
  refCount: number;
  waiterCount: number;
  cleanupScheduled: boolean;
}

export interface ProtectedResourcePoolOptions {
  fetchBlob: (
    resourcePath: string,
    options?: ProtectedResourceOptions,
  ) => Promise<ProtectedResourceFetchResult>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  persistentStore?: ProtectedResourcePersistentStore;
  getPersistentOptions?: (key: string, options?: ProtectedResourceOptions) => ProtectedResourcePersistentOptions | null | undefined;
  retainMs?: number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export interface ProtectedResourcePool {
  acquireBlob: (
    key: string,
    resourcePath: string,
    requestOptions?: ProtectedResourceOptions,
  ) => Promise<ProtectedBlobHandle>;
  acquireObjectUrl: (
    key: string,
    resourcePath: string,
    requestOptions?: ProtectedResourceOptions,
  ) => Promise<ProtectedObjectUrlHandle>;
  clear: () => void;
  fetchBlob: (
    key: string,
    resourcePath: string,
    requestOptions?: ProtectedResourceOptions,
  ) => Promise<Blob>;
  getSnapshot: () => ProtectedResourcePoolSnapshotEntry[];
}

interface ProtectedResourcePoolEntry {
  blob?: Blob;
  objectUrl?: string;
  inflight?: Promise<Blob>;
  lastResolvedSource?: 'memory' | 'persistent' | 'network';
  refCount: number;
  waiterCount: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
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

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const handleAbort = (): void => {
      reject(createAbortError());
    };

    signal.addEventListener('abort', handleAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      },
    );
  });
}

export function createProtectedResourcePool(options: ProtectedResourcePoolOptions): ProtectedResourcePool {
  const fetchBlob = options.fetchBlob;
  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob): string => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string): void => URL.revokeObjectURL(url));
  const persistentStore = options.persistentStore;
  const getPersistentOptions = options.getPersistentOptions ?? ((): undefined => undefined);
  const retainMs = options.retainMs ?? 750;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const entries = new Map<string, ProtectedResourcePoolEntry>();

  function getOrCreateEntry(key: string): ProtectedResourcePoolEntry {
    const current = entries.get(key);
    if (current) {
      cancelCleanup(current);
      return current;
    }

    const entry: ProtectedResourcePoolEntry = {
      refCount: 0,
      waiterCount: 0,
    };
    entries.set(key, entry);
    return entry;
  }

  function cancelCleanup(entry: ProtectedResourcePoolEntry): void {
    if (!entry.cleanupTimer) {
      return;
    }

    clearTimeoutImpl(entry.cleanupTimer);
    entry.cleanupTimer = undefined;
  }

  function canDispose(entry: ProtectedResourcePoolEntry): boolean {
    return entry.refCount <= 0 && entry.waiterCount <= 0 && !entry.inflight;
  }

  function disposeEntry(key: string, entry: ProtectedResourcePoolEntry): void {
    if (!canDispose(entry)) {
      return;
    }

    cancelCleanup(entry);
    if (entry.objectUrl) {
      revokeObjectUrl(entry.objectUrl);
    }

    entries.delete(key);
  }

  function scheduleCleanup(key: string, entry: ProtectedResourcePoolEntry): void {
    if (!canDispose(entry)) {
      return;
    }

    if (!entry.blob && !entry.objectUrl) {
      entries.delete(key);
      return;
    }

    if (entry.cleanupTimer) {
      return;
    }

    if (retainMs <= 0) {
      disposeEntry(key, entry);
      return;
    }

    entry.cleanupTimer = setTimeoutImpl(() => {
      entry.cleanupTimer = undefined;
      disposeEntry(key, entry);
    }, retainMs);
  }

  function loadBlob(
    key: string,
    resourcePath: string,
    entry: ProtectedResourcePoolEntry,
    requestOptions?: ProtectedResourceOptions,
  ): Promise<Blob> {
    if (entry.blob) {
      entry.lastResolvedSource = 'memory';
      return Promise.resolve(entry.blob);
    }

    if (entry.inflight) {
      return entry.inflight;
    }

    entry.inflight = (async (): Promise<Blob> => {
      const persistentOptions = requestOptions?.persistentEnabled === false
        ? null
        : getPersistentOptions(key, requestOptions);
      if (persistentStore && persistentOptions !== null) {
        try {
          const persisted = await persistentStore.get(key, persistentOptions);
          if (persisted) {
            entry.blob = persisted;
            entry.lastResolvedSource = 'persistent';
            return persisted;
          }
        } catch {
          // Persistent cache failure must not block network fallback.
        }
      }

      const result = await fetchBlob(resourcePath, requestOptions);
      const blob = result.blob;
      entry.blob = blob;
      entry.lastResolvedSource = 'network';
      if (persistentStore && persistentOptions !== null && result.metadata) {
        try {
          await persistentStore.put(key, blob, result.metadata, persistentOptions);
        } catch {
          // Ignore persistent cache write failures to keep primary fetch path healthy.
        }
      }

      return blob;
    })()
      .catch((error) => {
        if (!entry.blob && !entry.objectUrl) {
          entries.delete(key);
        }
        throw error;
      })
      .finally(() => {
        entry.inflight = undefined;
        scheduleCleanup(key, entry);
      });

    return entry.inflight;
  }

  function releaseHandle(key: string, entry: ProtectedResourcePoolEntry): void {
    entry.refCount = Math.max(0, entry.refCount - 1);
    scheduleCleanup(key, entry);
  }

  async function acquireBlob(
    key: string,
    resourcePath: string,
    requestOptions?: ProtectedResourceOptions
  ): Promise<ProtectedBlobHandle> {
    throwIfAborted(requestOptions?.signal);

    const entry = getOrCreateEntry(key);
    entry.waiterCount += 1;
    let acquired = false;
    let released = false;

    try {
      const blob = entry.blob ?? await withAbort(loadBlob(key, resourcePath, entry, requestOptions), requestOptions?.signal);
      throwIfAborted(requestOptions?.signal);

      entry.refCount += 1;
      acquired = true;

      return {
        key,
        blob,
        source: entry.lastResolvedSource ?? 'memory',
        release: (): void => {
          if (released) {
            return;
          }

          released = true;
          releaseHandle(key, entry);
        },
      };
    } finally {
      entry.waiterCount = Math.max(0, entry.waiterCount - 1);
      if (!acquired) {
        scheduleCleanup(key, entry);
      }
    }
  }

  async function acquireObjectUrl(
    key: string,
    resourcePath: string,
    requestOptions?: ProtectedResourceOptions
  ): Promise<ProtectedObjectUrlHandle> {
    throwIfAborted(requestOptions?.signal);

    const entry = getOrCreateEntry(key);
    entry.waiterCount += 1;
    let acquired = false;
    let released = false;

    try {
      const blob = entry.blob ?? await withAbort(loadBlob(key, resourcePath, entry, requestOptions), requestOptions?.signal);
      throwIfAborted(requestOptions?.signal);

      if (!entry.objectUrl) {
        entry.objectUrl = createObjectUrl(blob);
      }

      entry.refCount += 1;
      acquired = true;

      return {
        key,
        blob,
        url: entry.objectUrl,
        source: entry.lastResolvedSource ?? 'memory',
        release: (): void => {
          if (released) {
            return;
          }

          released = true;
          releaseHandle(key, entry);
        },
      };
    } finally {
      entry.waiterCount = Math.max(0, entry.waiterCount - 1);
      if (!acquired) {
        scheduleCleanup(key, entry);
      }
    }
  }

  async function fetchBlobValue(
    key: string,
    resourcePath: string,
    requestOptions?: ProtectedResourceOptions
  ): Promise<Blob> {
    const handle = await acquireBlob(key, resourcePath, requestOptions);
    try {
      return handle.blob;
    } finally {
      handle.release();
    }
  }

  function clear(): void {
    entries.forEach((entry, key) => {
      cancelCleanup(entry);
      if (entry.objectUrl) {
        revokeObjectUrl(entry.objectUrl);
      }
      entries.delete(key);
    });
  }

  function getSnapshot(): ProtectedResourcePoolSnapshotEntry[] {
    return Array.from(entries.entries()).map(([key, entry]) => ({
      key,
      hasBlob: Boolean(entry.blob),
      hasObjectUrl: Boolean(entry.objectUrl),
      hasInflight: Boolean(entry.inflight),
      refCount: entry.refCount,
      waiterCount: entry.waiterCount,
      cleanupScheduled: Boolean(entry.cleanupTimer),
    }));
  }

  return {
    acquireBlob,
    acquireObjectUrl,
    clear,
    fetchBlob: fetchBlobValue,
    getSnapshot,
  };
}
