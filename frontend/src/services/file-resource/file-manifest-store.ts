import type {
  FileResourceManifest,
  FileResourceManifestInput,
  FileResourceManifestKey,
  FileResourceStatus,
  FileResourceVariantManifest,
  MarkBackendReadyInput,
  MarkErrorInput,
  MarkLocalFileInput,
  MarkRuntimeFileInput,
} from './file-resource.types';

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

export function createFileResourceManifestKey(key: FileResourceManifestKey): string {
  return [
    normalizeOptionalString(key.workflowId) ?? '*',
    key.nodeId,
    key.fileId,
    normalizeOptionalString(key.authScope) ?? '*',
    key.variant ?? '*',
    normalizeVersion(key.version) ?? '*',
    normalizeOptionalString(key.etag) ?? '*',
  ].map((part) => encodeURIComponent(String(part))).join('|');
}

function normalizeKey(key: FileResourceManifestKey): Required<FileResourceManifestKey> {
  return {
    workflowId: normalizeOptionalString(key.workflowId),
    nodeId: key.nodeId,
    fileId: key.fileId,
    authScope: normalizeOptionalString(key.authScope),
    variant: key.variant ?? null,
    version: normalizeVersion(key.version),
    etag: normalizeOptionalString(key.etag),
  };
}

function deriveStatus(input: {
  backendFileId?: string | null;
  status?: FileResourceStatus;
  hasLocalFile?: boolean;
  hasRuntimeFile?: boolean;
  hasRemoteOriginal?: boolean;
}): FileResourceStatus {
  if (input.status) {
    return input.status;
  }

  if (normalizeOptionalString(input.backendFileId)) {
    return 'backend-ready';
  }

  if (input.hasLocalFile || input.hasRuntimeFile) {
    return 'local-only';
  }

  if (input.hasRemoteOriginal) {
    return 'upload-pending';
  }

  return 'missing';
}

function createOriginalVariantFromFile(file: Pick<File, 'type' | 'size'> | null | undefined): FileResourceVariantManifest | undefined {
  if (!file) {
    return undefined;
  }

  return {
    mimeType: file.type || undefined,
    size: file.size,
    updatedAt: Date.now(),
  };
}

export class FileManifestStore {
  private readonly manifests = new Map<string, FileResourceManifest>();

  upsert(input: FileResourceManifestInput): FileResourceManifest {
    const now = Date.now();
    const key = normalizeKey(input.key);
    const manifestKey = createFileResourceManifestKey(key);
    const existing = this.manifests.get(manifestKey);
    const next: FileResourceManifest = {
      key,
      manifestKey,
      workflowId: key.workflowId,
      nodeId: key.nodeId,
      fileId: key.fileId,
      authScope: key.authScope,
      variant: key.variant,
      version: key.version,
      etag: key.etag,
      backendFileId: input.backendFileId ?? existing?.backendFileId ?? null,
      sourceType: input.sourceType ?? existing?.sourceType ?? 'unknown',
      status: deriveStatus({
        backendFileId: input.backendFileId ?? existing?.backendFileId,
        status: input.status,
        hasLocalFile: input.hasLocalFile ?? existing?.hasLocalFile,
        hasRuntimeFile: input.hasRuntimeFile ?? existing?.hasRuntimeFile,
        hasRemoteOriginal: input.hasRemoteOriginal ?? existing?.hasRemoteOriginal,
      }),
      variants: {
        ...(existing?.variants ?? {}),
        ...(input.variants ?? {}),
      },
      hasLocalFile: input.hasLocalFile ?? existing?.hasLocalFile ?? false,
      hasRuntimeFile: input.hasRuntimeFile ?? existing?.hasRuntimeFile ?? false,
      hasRemoteOriginal: input.hasRemoteOriginal ?? existing?.hasRemoteOriginal ?? false,
      leaseCount: input.leaseCount ?? existing?.leaseCount ?? 0,
      lastAccessAt: input.lastAccessAt ?? now,
      lastError: input.lastError === undefined ? existing?.lastError ?? null : input.lastError,
      backendBinding: input.backendBinding === undefined ? existing?.backendBinding ?? null : input.backendBinding,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.manifests.set(manifestKey, next);
    return next;
  }

  get(key: FileResourceManifestKey): FileResourceManifest | null {
    return this.manifests.get(createFileResourceManifestKey(normalizeKey(key))) ?? null;
  }

  getByManifestKey(manifestKey: string): FileResourceManifest | null {
    return this.manifests.get(manifestKey) ?? null;
  }

  getAll(): FileResourceManifest[] {
    return Array.from(this.manifests.values());
  }

  markBackendReady(input: MarkBackendReadyInput): FileResourceManifest {
    return this.upsert({
      key: input.key,
      backendFileId: input.backendFileId,
      backendBinding: input.binding,
      status: 'backend-ready',
      hasRemoteOriginal: true,
      variants: input.variant ? { download: input.variant } : undefined,
    });
  }

  markLocalFile(input: MarkLocalFileInput): FileResourceManifest {
    const original = createOriginalVariantFromFile(input.file);
    return this.upsert({
      key: input.key,
      sourceType: input.sourceType ?? 'local-input',
      status: 'local-only',
      hasLocalFile: true,
      variants: original ? { original } : undefined,
      lastError: null,
    });
  }

  markRuntimeFile(input: MarkRuntimeFileInput): FileResourceManifest {
    const runtime = createOriginalVariantFromFile(input.file);
    return this.upsert({
      key: input.key,
      sourceType: input.sourceType ?? 'node-output',
      status: 'local-only',
      hasRuntimeFile: true,
      variants: runtime ? { runtime } : undefined,
      lastError: null,
    });
  }

  markError(input: MarkErrorInput): FileResourceManifest {
    return this.upsert({
      key: input.key,
      status: 'missing',
      lastError: {
        ...input.error,
        at: input.error.at ?? Date.now(),
      },
    });
  }

  removeInactive(activeKeys: Iterable<FileResourceManifestKey>): number {
    const active = new Set(Array.from(activeKeys, (key) => createFileResourceManifestKey(normalizeKey(key))));
    let removedCount = 0;

    Array.from(this.manifests.keys()).forEach((manifestKey) => {
      if (!active.has(manifestKey)) {
        this.manifests.delete(manifestKey);
        removedCount += 1;
      }
    });

    return removedCount;
  }

  clear(): void {
    this.manifests.clear();
  }
}

export const fileManifestStore = new FileManifestStore();
