import { createModuleLogger } from '@/utils';

const log = createModuleLogger('local-file-source-store');

const DB_NAME = 'workflow-local-file-sources';
const DB_VERSION = 1;
const STORE_NAME = 'sources';

type LocalFilePermissionState = PermissionState | 'missing' | 'unsupported' | 'unavailable';

export interface BrowserFileSystemPermissionDescriptorLike {
  mode?: 'read' | 'readwrite';
}

export interface BrowserFileSystemFileHandleLike {
  kind?: 'file';
  name?: string;
  getFile: () => Promise<File>;
  queryPermission?: (
    descriptor?: BrowserFileSystemPermissionDescriptorLike,
  ) => Promise<PermissionState>;
  requestPermission?: (
    descriptor?: BrowserFileSystemPermissionDescriptorLike,
  ) => Promise<PermissionState>;
}

export interface LocalFileSourceStoreRecord {
  referenceId: string;
  handle: BrowserFileSystemFileHandleLike;
  fileName: string;
  size?: number;
  mimeType?: string;
  updatedAt: number;
  permissionState?: PermissionState;
}

interface LocalFileSourceStoreDriver {
  get(referenceId: string): Promise<LocalFileSourceStoreRecord | null>;
  set(record: LocalFileSourceStoreRecord): Promise<void>;
  delete(referenceId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface RestoreLocalFileSourceResult {
  status: 'ready' | 'permission-required' | 'missing' | 'unsupported';
  file?: File;
  handle?: BrowserFileSystemFileHandleLike;
  permissionState?: LocalFilePermissionState;
}

export interface LocalFileSourceStore {
  supportsPersistentHandles(): boolean;
  save(record: LocalFileSourceStoreRecord): Promise<void>;
  get(referenceId: string): Promise<LocalFileSourceStoreRecord | null>;
  delete(referenceId: string): Promise<void>;
  clear(): Promise<void>;
  queryPermission(referenceId: string): Promise<LocalFilePermissionState>;
  requestPermission(referenceId: string): Promise<LocalFilePermissionState>;
  restore(referenceId: string, options?: { requestPermission?: boolean }): Promise<RestoreLocalFileSourceResult>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function createMemoryDriver(): LocalFileSourceStoreDriver {
  const records = new Map<string, LocalFileSourceStoreRecord>();

  return {
    async get(referenceId): Promise<LocalFileSourceStoreRecord | null> {
      return records.get(referenceId) ?? null;
    },
    async set(record): Promise<void> {
      records.set(record.referenceId, record);
    },
    async delete(referenceId): Promise<void> {
      records.delete(referenceId);
    },
    async clear(): Promise<void> {
      records.clear();
    },
  };
}

function supportsIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (): void => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, {
          keyPath: 'referenceId',
        });
      }
    };

    request.onsuccess = (): void => {
      resolve(request.result);
    };

    request.onerror = (): void => {
      reject(request.error ?? new Error('Failed to open IndexedDB.'));
    };
  });
}

function createIndexedDbDriver(): LocalFileSourceStoreDriver {
  const databasePromise = openDatabase();

  const runTransaction = async <T>(
    mode: IDBTransactionMode,
    execute: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
  ): Promise<T> => {
    const database = await databasePromise;

    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);

      transaction.onerror = (): void => {
        reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      };

      execute(store, resolve, reject);
    });
  };

  return {
    get(referenceId): Promise<LocalFileSourceStoreRecord | null> {
      return runTransaction('readonly', (store, resolve, reject) => {
        const request = store.get(referenceId);
        request.onsuccess = (): void => resolve((request.result as LocalFileSourceStoreRecord | undefined) ?? null);
        request.onerror = (): void => reject(request.error ?? new Error('Failed to read local file source.'));
      });
    },
    set(record): Promise<void> {
      return runTransaction<void>('readwrite', (store, resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = (): void => resolve(undefined);
        request.onerror = (): void => reject(request.error ?? new Error('Failed to write local file source.'));
      });
    },
    delete(referenceId): Promise<void> {
      return runTransaction<void>('readwrite', (store, resolve, reject) => {
        const request = store.delete(referenceId);
        request.onsuccess = (): void => resolve(undefined);
        request.onerror = (): void => reject(request.error ?? new Error('Failed to delete local file source.'));
      });
    },
    clear(): Promise<void> {
      return runTransaction<void>('readwrite', (store, resolve, reject) => {
        const request = store.clear();
        request.onsuccess = (): void => resolve(undefined);
        request.onerror = (): void => reject(request.error ?? new Error('Failed to clear local file source store.'));
      });
    },
  };
}

function createDriver(): LocalFileSourceStoreDriver {
  if (!supportsIndexedDb()) {
    return createMemoryDriver();
  }

  try {
    return createIndexedDbDriver();
  } catch (error) {
    log.warn('createDriver', 'Falling back to memory local file source store', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return createMemoryDriver();
  }
}

async function resolvePermissionState(
  handle: BrowserFileSystemFileHandleLike,
  requestPermission: boolean,
): Promise<LocalFilePermissionState> {
  if (!handle.queryPermission && !handle.requestPermission) {
    return 'unsupported';
  }

  const query = requestPermission
    ? handle.requestPermission?.({ mode: 'read' })
    : handle.queryPermission?.({ mode: 'read' });
  const state = await query;
  return state ?? 'unsupported';
}

export function createLocalFileSourceReferenceId(nodeId: string, fileId: string): string {
  return `local-file-source:${nodeId}:${fileId}`;
}

export function createLocalFileSourceStore(
  driver: LocalFileSourceStoreDriver = createDriver(),
): LocalFileSourceStore {
  return {
    supportsPersistentHandles(): boolean {
      return supportsIndexedDb();
    },
    async save(record): Promise<void> {
      await driver.set(record);
    },
    async get(referenceId): Promise<LocalFileSourceStoreRecord | null> {
      return driver.get(referenceId);
    },
    async delete(referenceId): Promise<void> {
      await driver.delete(referenceId);
    },
    async clear(): Promise<void> {
      await driver.clear();
    },
    async queryPermission(referenceId): Promise<LocalFilePermissionState> {
      const record = await driver.get(referenceId);
      if (!record) {
        return 'missing';
      }

      return resolvePermissionState(record.handle, false);
    },
    async requestPermission(referenceId): Promise<LocalFilePermissionState> {
      const record = await driver.get(referenceId);
      if (!record) {
        return 'missing';
      }

      return resolvePermissionState(record.handle, true);
    },
    async restore(
      referenceId,
      options = {},
    ): Promise<RestoreLocalFileSourceResult> {
      const record = await driver.get(referenceId);
      if (!record) {
        return {
          status: 'missing',
          permissionState: 'missing',
        };
      }

      const permissionState = await resolvePermissionState(
        record.handle,
        options.requestPermission === true,
      );

      if (permissionState !== 'granted') {
        return {
          status: permissionState === 'unsupported' ? 'unsupported' : 'permission-required',
          permissionState,
          handle: record.handle,
        };
      }

      try {
        const file = await record.handle.getFile();
        return {
          status: 'ready',
          file,
          handle: record.handle,
          permissionState,
        };
      } catch (error) {
        log.warn('restore', 'Failed to restore local file source from handle', {
          referenceId,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        return {
          status: 'missing',
          permissionState,
          handle: record.handle,
        };
      }
    },
  };
}

export function createLocalFileSourceStoreRecord(
  referenceId: string,
  handle: BrowserFileSystemFileHandleLike,
  file: File,
  permissionState?: PermissionState,
): LocalFileSourceStoreRecord {
  return {
    referenceId,
    handle,
    fileName: isNonEmptyString(file.name) ? file.name : handle.name ?? referenceId,
    ...(typeof file.size === 'number' ? { size: file.size } : {}),
    ...(isNonEmptyString(file.type) ? { mimeType: file.type } : {}),
    updatedAt: Date.now(),
    ...(permissionState ? { permissionState } : {}),
  };
}

export const localFileSourceStore = createLocalFileSourceStore();
