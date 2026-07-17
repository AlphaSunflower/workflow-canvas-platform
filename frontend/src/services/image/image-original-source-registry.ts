import {
  createFileResourceManifestKey,
  fileManifestStore,
  fileResourceLeaseManager,
} from '@/services/file-resource';
import type { FileResourceManifestKey } from '@/services/file-resource';

export interface ImageOriginalSourceEntryMetadata {
  workflowId?: string | null;
  authScope?: string | null;
  version?: string | number | null;
  etag?: string | null;
}

export interface ImageOriginalSourceEntry extends ImageOriginalSourceEntryMetadata {
  nodeId: string;
  fileId: string;
  file?: File;
  originalUrl?: string;
  objectUrl?: string;
  registeredAt: number;
}

export type ImageOriginalSourceMatchKind = 'exact' | 'loose-scoped' | 'latest';

export interface ImageOriginalSourceLookupResult {
  entry: Readonly<ImageOriginalSourceEntry>;
  matchKind: ImageOriginalSourceMatchKind;
}

interface ImageOriginalSourceRegistryUnregisterOptions {
  force?: boolean;
  preserveLeased?: boolean;
  workflowId?: string | null;
}

interface ImageOriginalSourceRegistrySyncOptions {
  preserveLeased?: boolean;
  workflowId?: string | null;
}

interface ImageOriginalSourceRegistryClearOptions {
  force?: boolean;
  preserveLeased?: boolean;
  workflowId?: string | null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeVersion(value: string | number | null | undefined): string | number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  return normalizeOptionalString(value);
}

function createEntryKey(
  nodeId: string,
  fileId: string,
  metadata: ImageOriginalSourceEntryMetadata = {},
): string {
  return createFileResourceManifestKey({
    workflowId: metadata.workflowId,
    nodeId,
    fileId,
    authScope: metadata.authScope,
    variant: 'original',
    version: metadata.version,
    etag: metadata.etag,
  });
}

function createLegacyKey(nodeId: string, fileId: string): string {
  return `${nodeId}:${fileId}`;
}

function createScopedLatestKey(
  nodeId: string,
  fileId: string,
  metadata: ImageOriginalSourceEntryMetadata = {},
): string {
  const normalizedMetadata = normalizeEntryMetadata(metadata);
  return [
    normalizedMetadata.workflowId ?? '*',
    normalizedMetadata.authScope ?? '*',
    nodeId,
    fileId,
  ].join('|');
}

function createManifestKey(entry: Pick<ImageOriginalSourceEntry, 'nodeId' | 'fileId' | 'workflowId' | 'authScope' | 'version' | 'etag'>): FileResourceManifestKey {
  return {
    workflowId: entry.workflowId,
    nodeId: entry.nodeId,
    fileId: entry.fileId,
    authScope: entry.authScope,
    variant: 'original',
    version: entry.version,
    etag: entry.etag,
  };
}

function normalizeEntryMetadata(metadata: ImageOriginalSourceEntryMetadata = {}): ImageOriginalSourceEntryMetadata {
  return {
    workflowId: normalizeOptionalString(metadata.workflowId),
    authScope: normalizeOptionalString(metadata.authScope),
    version: normalizeVersion(metadata.version),
    etag: normalizeOptionalString(metadata.etag),
  };
}

function hasScopedMetadata(metadata: ImageOriginalSourceEntryMetadata): boolean {
  return Boolean(
    normalizeOptionalString(metadata.workflowId)
    || normalizeOptionalString(metadata.authScope)
    || normalizeVersion(metadata.version) !== null
    || normalizeOptionalString(metadata.etag),
  );
}

function isSameScope(
  entry: ImageOriginalSourceEntry,
  metadata: ImageOriginalSourceEntryMetadata,
): boolean {
  return entry.workflowId === metadata.workflowId
    && entry.authScope === metadata.authScope;
}

function shouldPreserveLeased(
  entry: ImageOriginalSourceEntry,
  options: ImageOriginalSourceRegistryUnregisterOptions | ImageOriginalSourceRegistryClearOptions,
): boolean {
  if (options.force) {
    return false;
  }

  const preserveLeased = options.preserveLeased ?? true;
  return preserveLeased && fileResourceLeaseManager.isLeased(createManifestKey(entry));
}

type ImageOriginalSourceRegistryListener = () => void;

class ImageOriginalSourceRegistry {
  private readonly entries = new Map<string, ImageOriginalSourceEntry>();
  private readonly latestKeys = new Map<string, string>();
  private readonly latestScopedKeys = new Map<string, string>();
  private readonly listeners = new Map<string, Set<ImageOriginalSourceRegistryListener>>();
  private globalRevision = 0;

  subscribe(nodeId: string, fileId: string, listener: ImageOriginalSourceRegistryListener): () => void {
    const key = createLegacyKey(nodeId, fileId);
    const listeners = this.listeners.get(key) ?? new Set<ImageOriginalSourceRegistryListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return (): void => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  getRevision(nodeId: string, fileId: string): number {
    const entry = this.get(nodeId, fileId);
    return this.globalRevision + (entry?.registeredAt ?? 0);
  }

  private emit(nodeId: string, fileId: string): void {
    this.globalRevision += 1;
    this.listeners.get(createLegacyKey(nodeId, fileId))?.forEach((listener) => listener());
  }

  registerLocalFile(
    nodeId: string,
    fileId: string,
    file: File,
    metadata: ImageOriginalSourceEntryMetadata = {},
  ): void {
    const normalizedMetadata = normalizeEntryMetadata(metadata);
    const key = createEntryKey(nodeId, fileId, normalizedMetadata);
    const previous = this.entries.get(key) ?? this.get(nodeId, fileId);
    if (previous?.objectUrl) {
      URL.revokeObjectURL(previous.objectUrl);
    }

    const entry: ImageOriginalSourceEntry = {
      nodeId,
      fileId,
      ...normalizedMetadata,
      file,
      originalUrl: previous?.originalUrl,
      registeredAt: Date.now(),
    };
    this.entries.set(key, entry);
    this.latestKeys.set(createLegacyKey(nodeId, fileId), key);
    this.latestScopedKeys.set(createScopedLatestKey(nodeId, fileId, entry), key);
    fileManifestStore.markLocalFile({
      key: createManifestKey(entry),
      file,
    });
    this.emit(nodeId, fileId);
  }

  registerRemoteOriginal(
    nodeId: string,
    fileId: string,
    originalUrl: string | undefined,
    metadata: ImageOriginalSourceEntryMetadata = {},
  ): void {
    if (!originalUrl) {
      return;
    }

    const normalizedMetadata = normalizeEntryMetadata(metadata);
    const key = createEntryKey(nodeId, fileId, normalizedMetadata);
    const previous = this.entries.get(key) ?? this.get(nodeId, fileId);
    const entry: ImageOriginalSourceEntry = {
      nodeId,
      fileId,
      ...normalizedMetadata,
      file: previous?.file,
      originalUrl,
      objectUrl: previous?.objectUrl,
      registeredAt: previous?.registeredAt ?? Date.now(),
    };
    this.entries.set(key, entry);
    this.latestKeys.set(createLegacyKey(nodeId, fileId), key);
    this.latestScopedKeys.set(createScopedLatestKey(nodeId, fileId, entry), key);
    fileManifestStore.upsert({
      key: createManifestKey(entry),
      hasRemoteOriginal: true,
      variants: {
        original: {
          url: originalUrl,
          updatedAt: Date.now(),
        },
      },
    });
    this.emit(nodeId, fileId);
  }

  get(
    nodeId: string,
    fileId: string,
    metadata: ImageOriginalSourceEntryMetadata = {},
  ): Readonly<ImageOriginalSourceEntry> | null {
    return this.lookup(nodeId, fileId, metadata)?.entry ?? null;
  }

  lookup(
    nodeId: string,
    fileId: string,
    metadata: ImageOriginalSourceEntryMetadata = {},
  ): ImageOriginalSourceLookupResult | null {
    const normalizedMetadata = normalizeEntryMetadata(metadata);
    const direct = this.entries.get(createEntryKey(nodeId, fileId, normalizedMetadata));
    if (direct) {
      return {
        entry: direct,
        matchKind: 'exact',
      };
    }

    if (hasScopedMetadata(normalizedMetadata)) {
      const latestScoped = this.getLatestScopedEntry(nodeId, fileId, normalizedMetadata);
      if (latestScoped) {
        return {
          entry: latestScoped,
          matchKind: 'loose-scoped',
        };
      }
    }

    if (hasScopedMetadata(normalizedMetadata)) {
      return null;
    }

    const latestKey = this.latestKeys.get(createLegacyKey(nodeId, fileId));
    const latest = latestKey ? this.entries.get(latestKey) ?? null : null;
    return latest
      ? {
        entry: latest,
        matchKind: 'latest',
      }
      : null;
  }

  getFile(nodeId: string, fileId: string, metadata: ImageOriginalSourceEntryMetadata = {}): File | null {
    return this.get(nodeId, fileId, metadata)?.file ?? null;
  }

  hasLocalFile(nodeId: string, fileId: string, metadata: ImageOriginalSourceEntryMetadata = {}): boolean {
    return Boolean(this.get(nodeId, fileId, metadata)?.file);
  }

  getOriginalUrl(nodeId: string, fileId: string, metadata: ImageOriginalSourceEntryMetadata = {}): string | undefined {
    return this.get(nodeId, fileId, metadata)?.originalUrl;
  }

  getOrCreateObjectUrl(nodeId: string, fileId: string, metadata: ImageOriginalSourceEntryMetadata = {}): string | undefined {
    const entry = this.get(nodeId, fileId, metadata);
    if (!entry?.file) {
      return entry?.originalUrl;
    }

    if (entry.objectUrl) {
      return entry.objectUrl;
    }

    const objectUrl = URL.createObjectURL(entry.file);
    const key = createEntryKey(entry.nodeId, entry.fileId, entry);
    this.entries.set(key, {
      ...entry,
      objectUrl,
    });
    return objectUrl;
  }

  reportObjectUrlFailure(nodeId: string, fileId: string, attemptedUrl: string): boolean {
    const entry = this.get(nodeId, fileId);
    if (!entry?.file || !entry.objectUrl || entry.objectUrl !== attemptedUrl) {
      return false;
    }

    URL.revokeObjectURL(entry.objectUrl);
    const key = createEntryKey(entry.nodeId, entry.fileId, entry);
    this.entries.set(key, {
      ...entry,
      objectUrl: undefined,
    });
    this.emit(nodeId, fileId);
    return true;
  }

  unregister(
    nodeId: string,
    fileId: string,
    options: ImageOriginalSourceRegistryUnregisterOptions = {},
  ): boolean {
    const entry = this.get(nodeId, fileId, options);
    if (!entry) {
      return false;
    }

    if (options.workflowId !== undefined && normalizeOptionalString(options.workflowId) !== entry.workflowId) {
      return false;
    }

    if (shouldPreserveLeased(entry, options)) {
      return false;
    }

    this.deleteEntry(entry);
    return true;
  }

  sync(
    activeNodes: Iterable<{ id: { value: string }; fileId: string } & ImageOriginalSourceEntryMetadata>,
    options: ImageOriginalSourceRegistrySyncOptions = {},
  ): void {
    const activeKeys = new Set<string>();
    const activeLegacyKeys = new Set<string>();
    for (const node of activeNodes) {
      activeKeys.add(createEntryKey(node.id.value, node.fileId, node));
      activeLegacyKeys.add(createLegacyKey(node.id.value, node.fileId));
    }

    Array.from(this.entries.values()).forEach((entry) => {
      if (options.workflowId !== undefined && normalizeOptionalString(options.workflowId) !== entry.workflowId) {
        return;
      }

      if (
        !activeKeys.has(createEntryKey(entry.nodeId, entry.fileId, entry))
        && !activeLegacyKeys.has(createLegacyKey(entry.nodeId, entry.fileId))
      ) {
        this.unregister(entry.nodeId, entry.fileId, {
          workflowId: entry.workflowId,
          preserveLeased: options.preserveLeased ?? true,
        });
      }
    });
  }

  clear(options: ImageOriginalSourceRegistryClearOptions = {}): void {
    Array.from(this.entries.values()).forEach((entry) => {
      if (options.workflowId !== undefined && normalizeOptionalString(options.workflowId) !== entry.workflowId) {
        return;
      }

      if (shouldPreserveLeased(entry, options)) {
        return;
      }

      this.deleteEntry(entry);
    });
  }

  clearUnleased(workflowId?: string | null): void {
    this.clear({
      workflowId,
      preserveLeased: true,
    });
  }

  forceClearForDeletedNode(nodeId: string, fileId: string, workflowId?: string | null): boolean {
    return this.unregister(nodeId, fileId, {
      workflowId,
      force: true,
      preserveLeased: false,
    });
  }

  clearWorkflowUnleased(workflowId: string | null): void {
    this.clear({
      workflowId,
      preserveLeased: true,
    });
  }

  private deleteEntry(entry: ImageOriginalSourceEntry): void {
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }

    const entryKey = createEntryKey(entry.nodeId, entry.fileId, entry);
    this.entries.delete(entryKey);
    const legacyKey = createLegacyKey(entry.nodeId, entry.fileId);
    if (this.latestKeys.get(legacyKey) === entryKey) {
      this.latestKeys.delete(legacyKey);
      const replacement = Array.from(this.entries.entries())
        .find(([, candidate]) => candidate.nodeId === entry.nodeId && candidate.fileId === entry.fileId);
      if (replacement) {
        this.latestKeys.set(legacyKey, replacement[0]);
      }
    }
    const scopedLatestKey = createScopedLatestKey(entry.nodeId, entry.fileId, entry);
    if (this.latestScopedKeys.get(scopedLatestKey) === entryKey) {
      this.latestScopedKeys.delete(scopedLatestKey);
      const replacement = Array.from(this.entries.entries())
        .reverse()
        .find(([, candidate]) => (
          candidate.nodeId === entry.nodeId
          && candidate.fileId === entry.fileId
          && isSameScope(candidate, entry)
        ));
      if (replacement) {
        this.latestScopedKeys.set(scopedLatestKey, replacement[0]);
      }
    }
    fileManifestStore.upsert({
      key: createManifestKey(entry),
      hasLocalFile: false,
      hasRuntimeFile: false,
    });
    this.emit(entry.nodeId, entry.fileId);
  }

  private getLatestScopedEntry(
    nodeId: string,
    fileId: string,
    metadata: ImageOriginalSourceEntryMetadata,
  ): ImageOriginalSourceEntry | null {
    const scopedLatestKey = this.latestScopedKeys.get(createScopedLatestKey(nodeId, fileId, metadata));
    const scopedLatestEntry = scopedLatestKey ? this.entries.get(scopedLatestKey) ?? null : null;
    if (scopedLatestEntry?.file && isSameScope(scopedLatestEntry, metadata)) {
      return scopedLatestEntry;
    }

    return Array.from(this.entries.values())
      .reverse()
      .find((entry) => (
        entry.nodeId === nodeId
        && entry.fileId === fileId
        && Boolean(entry.file)
        && isSameScope(entry, metadata)
      )) ?? null;
  }
}

export const imageOriginalSourceRegistry = new ImageOriginalSourceRegistry();
