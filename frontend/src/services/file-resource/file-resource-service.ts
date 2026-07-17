import { httpClient } from '@/api/client/http-client';
import type { FileNodeData } from '@/types';
import {
  getFileNodeImageOriginalUrl,
  getFileNodeImageThumbnailUrl,
} from '@/services/image/image-asset';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import { getRegisteredLocalArchiveFileByNode } from '@/services/local-workflow-assets';
import {
  localFileSourceStore,
  type RestoreLocalFileSourceResult,
} from '@/services/local-file-source-store';
import {
  ensureExecutionOutputRuntimeResourceByFileId,
  getExecutionOutputNodeFile,
} from '@/services/execution-output-runtime-sync';
import { fetchProtectedResourceBlob } from '@/services/protected-resource';
import type { BackendFileAssetResponse } from '../backend-file-binding.contracts';
import { fileManifestStore } from './file-manifest-store';
import { fileResourceLeaseManager } from './resource-lease-manager';
import { fileResourceDiagnostics } from './file-resource-diagnostics';
import type {
  FileResourceDiagnosticsMetadata,
  FileResourceHandle,
  FileResourceLease,
  FileResourceLeaseReason,
  FileResourceManifest,
  FileResourceManifestKey,
  FileResourcePurpose,
  FileResourceResolveOptions,
  FileResourceSelectedSource,
} from './file-resource.types';

interface FileResourceServiceDependencies {
  resolveRemoteBackendFileId?: (fileId: string, signal?: AbortSignal) => Promise<string | null>;
  fetchBlob?: (url: string, options?: { signal?: AbortSignal }) => Promise<Blob>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  restoreLocalFileSource?: (
    referenceId: string,
    options?: { requestPermission?: boolean },
  ) => Promise<RestoreLocalFileSourceResult>;
}

interface RemoteOriginalSource {
  url: string;
  backendFileId?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeResourceRequestUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed, typeof window === 'undefined' ? undefined : window.location.origin);
    if (parsed.pathname.startsWith('/api/v1/files/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function shouldSkipRemoteDownloadUrl(options: FileResourceResolveOptions, url: string): boolean {
  const normalized = normalizeResourceRequestUrl(url);
  return Boolean(
    normalized &&
    options.skipRemoteDownloadUrls
      ?.map((candidate) => normalizeResourceRequestUrl(candidate))
      .includes(normalized),
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isNodeOutputSource(node: FileNodeData): boolean {
  return node.source?.type === 'node-output';
}

function getLeaseReason(purpose: FileResourcePurpose): FileResourceLeaseReason | null {
  switch (purpose) {
    case 'upload-input':
      return 'upload';
    case 'prompt-reference':
      return 'prompt-reference';
    case 'viewer-original':
      return 'viewer';
    case 'inpaint-editor-original':
      return 'inpaint-editor';
    case 'export-original':
      return 'export';
    case 'runtime-output':
      return 'runtime-sync';
    case 'canvas-thumbnail':
      return null;
  }
}

function shouldUseBackendDownloadFallback(purpose: FileResourcePurpose): boolean {
  return purpose === 'viewer-original'
    || purpose === 'inpaint-editor-original'
    || purpose === 'export-original';
}

function shouldProbeRemoteBackendFileForOriginalFallback(node: FileNodeData): boolean {
  return isNodeOutputSource(node)
    || Boolean(getFileNodeImageOriginalUrl(node))
    || (node.imageAsset?.source === 'remote' && Boolean(getFileNodeImageThumbnailUrl(node)));
}

function createManifestKey(node: FileNodeData, options: FileResourceResolveOptions): FileResourceManifestKey {
  return {
    workflowId: options.workflowId,
    nodeId: node.id.value,
    fileId: node.fileId,
    authScope: options.authScope,
    variant: options.purpose === 'canvas-thumbnail' ? 'thumbnail' : 'original',
    version: options.version,
    etag: options.etag,
  };
}

function toFileFromBlob(node: FileNodeData, blob: Blob): File {
  if (blob instanceof File) {
    return blob;
  }

  return new File([blob], node.fileName, {
    type: blob.type || node.mimeType || 'application/octet-stream',
    lastModified: Date.now(),
  });
}

function createRemoteDownloadVariant(blob: Blob, remoteUrl: string): {
  url: string;
  mimeType?: string;
  size: number;
  updatedAt: number;
} {
  return {
    url: remoteUrl,
    mimeType: blob.type || undefined,
    size: blob.size,
    updatedAt: Date.now(),
  };
}

function assertRenderableImageDownloadBlob(node: FileNodeData, blob: Blob, remoteUrl: string): void {
  if (blob.size <= 0) {
    throw new Error(`Remote original download returned an empty image resource: ${remoteUrl}`);
  }

  const mimeType = blob.type.trim().toLowerCase();
  if (node.type === 'image' && mimeType && !mimeType.startsWith('image/')) {
    throw new Error(`Remote original download returned a non-image resource (${blob.type}) for ${node.fileName}.`);
  }
}

async function resolveDefaultRemoteBackendFileId(fileId: string, signal?: AbortSignal): Promise<string | null> {
  if (!isNonEmptyString(fileId)) {
    return null;
  }

  const result = await httpClient.get<BackendFileAssetResponse>(`/api/v1/files/${fileId}`, undefined, {
    signal,
    timeout: 30000,
  });

  if (!result.success) {
    return null;
  }

  return isNonEmptyString(result.data.fileId) ? result.data.fileId : null;
}

export class FileResourceService {
  private readonly resolveRemoteBackendFileId: NonNullable<FileResourceServiceDependencies['resolveRemoteBackendFileId']>;
  private readonly fetchBlob: NonNullable<FileResourceServiceDependencies['fetchBlob']>;
  private readonly createObjectUrl: NonNullable<FileResourceServiceDependencies['createObjectUrl']>;
  private readonly revokeObjectUrl: NonNullable<FileResourceServiceDependencies['revokeObjectUrl']>;
  private readonly restoreLocalFileSource: NonNullable<FileResourceServiceDependencies['restoreLocalFileSource']>;

  constructor(dependencies: FileResourceServiceDependencies = {}) {
    this.resolveRemoteBackendFileId = dependencies.resolveRemoteBackendFileId ?? resolveDefaultRemoteBackendFileId;
    this.fetchBlob = dependencies.fetchBlob ?? ((url, options): Promise<Blob> => fetchProtectedResourceBlob(url, options));
    this.createObjectUrl = dependencies.createObjectUrl ?? ((blob): string => URL.createObjectURL(blob));
    this.revokeObjectUrl = dependencies.revokeObjectUrl ?? ((url): void => URL.revokeObjectURL(url));
    this.restoreLocalFileSource = dependencies.restoreLocalFileSource
      ?? ((referenceId, restoreOptions): Promise<RestoreLocalFileSourceResult> => (
        localFileSourceStore.restore(referenceId, restoreOptions)
      ));
  }

  async resolveFileResource(
    node: FileNodeData,
    options: FileResourceResolveOptions,
  ): Promise<FileResourceHandle> {
    const fallbackChain: FileResourceSelectedSource[] = [];
    const manifestKey = createManifestKey(node, options);
    const manifest = fileManifestStore.get(manifestKey);
    const lease = this.acquireLeaseIfNeeded(manifestKey, node, options);
    let ownedObjectUrl: string | null = null;
    const release = (): void => {
      if (ownedObjectUrl) {
        this.revokeObjectUrl(ownedObjectUrl);
        ownedObjectUrl = null;
      }
      if (lease) {
        fileResourceLeaseManager.releaseLease(lease.leaseId);
      }
    };

    const complete = (
      source: FileResourceSelectedSource,
      partial: Omit<FileResourceHandle, 'purpose' | 'require' | 'selectedSource' | 'fallbackChain' | 'diagnostics' | 'release'>,
      detail?: Record<string, unknown>,
    ): FileResourceHandle => {
      const diagnostics = this.createDiagnostics(node, options, source, fallbackChain, lease);
      fileResourceDiagnostics.recordResolved(diagnostics, detail);
      return {
        purpose: options.purpose,
        require: options.require,
        selectedSource: source,
        fallbackChain,
        diagnostics,
        release,
        ...partial,
      };
    };
    const createAttemptDiagnostics = (selectedSource: FileResourceSelectedSource): FileResourceDiagnosticsMetadata => (
      this.createDiagnostics(node, options, selectedSource, fallbackChain, lease)
    );
    const recordSourceAttempt = (source: FileResourceSelectedSource, detail?: Record<string, unknown>): void => {
      fileResourceDiagnostics.recordSourceAttempt(createAttemptDiagnostics(source), source, detail);
    };
    const recordSourceFailed = (source: FileResourceSelectedSource, error: unknown, detail?: Record<string, unknown>): void => {
      fileResourceDiagnostics.recordSourceFailed(
        createAttemptDiagnostics(source),
        source,
        getErrorMessage(error, `File resource source ${source} failed.`),
        detail,
      );
    };

    try {
      fileResourceDiagnostics.recordAttempt(createAttemptDiagnostics('unresolved'), {
        allowRemoteDownload: options.allowRemoteDownload !== false,
        manifest: this.createManifestDiagnostics(manifest),
      });

      if (options.purpose === 'canvas-thumbnail') {
        fallbackChain.push('thumbnail');
        recordSourceAttempt('thumbnail');
        const displayUrl = getFileNodeImageThumbnailUrl(node);
        if (displayUrl) {
          return complete('thumbnail', {
            displayUrl,
          });
        }
        recordSourceFailed('thumbnail', 'Canvas thumbnail source is unavailable.');
        throw new Error('Canvas thumbnail source is unavailable.');
      }

      if (options.require === 'backendFileId') {
        fallbackChain.push('backend-id');
        recordSourceAttempt('backend-id');
        const backendFileId = await this.resolveBackendFileId(node, options);
        if (backendFileId) {
          fileManifestStore.markBackendReady({
            key: manifestKey,
            backendFileId,
          });
          return complete('backend-id', {
            backendFileId,
          });
        }

        recordSourceFailed('backend-id', 'Backend file id is unavailable for this resource.');
        throw new Error('Backend file id is unavailable for this resource.');
      }

      fallbackChain.push('execution-runtime-file');
      recordSourceAttempt('execution-runtime-file');
      const runtimeFile = getExecutionOutputNodeFile(node);
      if (runtimeFile) {
        return this.completeWithFile(node, options, runtimeFile, complete, 'execution-runtime-file', (objectUrl) => {
          ownedObjectUrl = objectUrl;
        });
      }
      recordSourceFailed('execution-runtime-file', 'Execution runtime file is unavailable.');

      fallbackChain.push('registry-file');
      recordSourceAttempt('registry-file');
      const registryLookup = imageOriginalSourceRegistry.lookup(node.id.value, node.fileId, {
        workflowId: options.workflowId,
        authScope: options.authScope,
        version: options.version,
        etag: options.etag,
      });
      if (registryLookup?.entry.file) {
        if (registryLookup.matchKind === 'loose-scoped') {
          fileResourceDiagnostics.recordSourceAttempt(createAttemptDiagnostics('registry-file'), 'registry-file', {
            matchKind: 'loose-scoped',
            reason: 'exact version/etag miss; using latest local original within workflow/auth scope',
            requestedVersion: options.version ?? null,
            requestedEtag: options.etag ?? null,
            entryVersion: registryLookup.entry.version ?? null,
            entryEtag: registryLookup.entry.etag ?? null,
          });
        }
        return this.completeWithFile(node, options, registryLookup.entry.file, complete, 'registry-file', (objectUrl) => {
          ownedObjectUrl = objectUrl;
        }, {
          registryMatchKind: registryLookup.matchKind,
          registryVersion: registryLookup.entry.version ?? null,
          registryEtag: registryLookup.entry.etag ?? null,
        });
      }
      recordSourceFailed('registry-file', 'Original registry file is unavailable.');

      fallbackChain.push('local-handle');
      recordSourceAttempt('local-handle');
      const localArchiveFile = getRegisteredLocalArchiveFileByNode(node, {
        workflowId: options.workflowId,
      });
      if (localArchiveFile) {
        imageOriginalSourceRegistry.registerLocalFile(node.id.value, node.fileId, localArchiveFile, {
          workflowId: options.workflowId,
          authScope: options.authScope,
          version: options.version,
          etag: options.etag,
        });
        return this.completeWithFile(node, options, localArchiveFile, complete, 'local-handle', (objectUrl) => {
          ownedObjectUrl = objectUrl;
        });
      }
      const restoredLocalFile = await this.restoreLocalSourceFile(node, options);
      if (restoredLocalFile) {
        return this.completeWithFile(node, options, restoredLocalFile, complete, 'local-handle', (objectUrl) => {
          ownedObjectUrl = objectUrl;
        });
      }
      recordSourceFailed('local-handle', 'Local handle or local archive file is unavailable.');

      if (isNodeOutputSource(node)) {
        fallbackChain.push('runtime-sync');
        recordSourceAttempt('runtime-sync');
        try {
          const syncedResource = await ensureExecutionOutputRuntimeResourceByFileId(node.fileId, {
            signal: options.signal,
          });
          if (syncedResource?.file) {
            return this.completeWithFile(node, options, syncedResource.file, complete, 'runtime-sync', (objectUrl) => {
              ownedObjectUrl = objectUrl;
            });
          }
          recordSourceFailed('runtime-sync', 'Runtime sync did not return a file.');
        } catch (error) {
          recordSourceFailed('runtime-sync', error);
        }
      }

      if (options.allowRemoteDownload !== false) {
        fallbackChain.push('remote-download');
        recordSourceAttempt('remote-download');
        const remoteOriginalSource = await this.resolveRemoteOriginalSource(node, options, manifest);
        if (remoteOriginalSource) {
          if (shouldSkipRemoteDownloadUrl(options, remoteOriginalSource.url)) {
            recordSourceFailed('remote-download', 'Remote download URL was skipped because it already failed during this resolution.', {
              url: remoteOriginalSource.url,
            });
            throw new Error('Remote download URL was skipped because it already failed during this resolution.');
          }
          try {
            const blob = await this.fetchBlob(remoteOriginalSource.url, { signal: options.signal });
            assertRenderableImageDownloadBlob(node, blob, remoteOriginalSource.url);
            return this.completeWithRemoteDownload(
              node,
              options,
              blob,
              complete,
              'remote-download',
              remoteOriginalSource.url,
              remoteOriginalSource.backendFileId,
              (objectUrl) => {
                ownedObjectUrl = objectUrl;
              },
            );
          } catch (error) {
            recordSourceFailed('remote-download', error, {
              url: remoteOriginalSource.url,
            });
            throw error;
          }
        }
        recordSourceFailed('remote-download', 'Remote original URL is unavailable.');
      }

      throw new Error('No file resource source could satisfy the request.');
    } catch (error) {
      release();
      const diagnostics = this.createDiagnostics(node, options, 'unresolved', fallbackChain, lease);
      fileResourceDiagnostics.recordFailed(
        diagnostics,
        error instanceof Error ? error.message : 'Failed to resolve file resource.',
      );
      if (error && typeof error === 'object') {
        (error as { fileResourceDiagnostics?: FileResourceDiagnosticsMetadata }).fileResourceDiagnostics = diagnostics;
      }
      throw error;
    }
  }

  private async resolveRemoteOriginalSource(
    node: FileNodeData,
    options: FileResourceResolveOptions,
    manifest: FileResourceManifest | null,
  ): Promise<RemoteOriginalSource | undefined> {
    const imageOriginalUrl = getFileNodeImageOriginalUrl(node);
    if (imageOriginalUrl) {
      return {
        url: imageOriginalUrl,
        backendFileId: node.backendFileId ?? manifest?.backendFileId ?? undefined,
      };
    }

    const backendFileId = isNonEmptyString(node.backendFileId)
      ? node.backendFileId.trim()
      : manifest?.backendFileId ?? undefined;
    if (shouldUseBackendDownloadFallback(options.purpose) && isNonEmptyString(backendFileId)) {
      return {
        url: `/api/v1/files/${encodeURIComponent(backendFileId.trim())}/download`,
        backendFileId: backendFileId.trim(),
      };
    }

    if (shouldUseBackendDownloadFallback(options.purpose)) {
      const resolvedBackendFileId = shouldProbeRemoteBackendFileForOriginalFallback(node)
        ? await this.resolveRemoteBackendFileId(node.fileId, options.signal)
        : null;
      if (isNonEmptyString(resolvedBackendFileId)) {
        return {
          url: `/api/v1/files/${encodeURIComponent(resolvedBackendFileId.trim())}/download`,
          backendFileId: resolvedBackendFileId.trim(),
        };
      }
    }

    return undefined;
  }

  private async restoreLocalSourceFile(
    node: FileNodeData,
    options: FileResourceResolveOptions,
  ): Promise<File | null> {
    const localSource = node.source.type === 'imported' ? node.source.localSource : undefined;
    const referenceId = localSource?.referenceId;
    if (!isNonEmptyString(referenceId)) {
      return null;
    }

    const restored = await this.restoreLocalFileSource(referenceId.trim(), {
      requestPermission: true,
    });
    if (restored.status !== 'ready' || !restored.file) {
      return null;
    }

    imageOriginalSourceRegistry.registerLocalFile(node.id.value, node.fileId, restored.file, {
      workflowId: options.workflowId,
      authScope: options.authScope,
      version: options.version,
      etag: options.etag,
    });
    return restored.file;
  }

  private acquireLeaseIfNeeded(
    key: FileResourceManifestKey,
    node: FileNodeData,
    options: FileResourceResolveOptions,
  ): FileResourceLease | null {
    const reason = getLeaseReason(options.purpose);
    if (!reason) {
      return null;
    }

    return fileResourceLeaseManager.acquireLease(
      key,
      reason,
      options.owner ?? `${options.purpose}:${node.id.value}:${node.fileId}`,
      { ttlMs: options.leaseTtlMs },
    );
  }

  private async resolveBackendFileId(
    node: FileNodeData,
    options: FileResourceResolveOptions,
  ): Promise<string | null> {
    if (isNonEmptyString(node.backendFileId)) {
      return node.backendFileId.trim();
    }

    if (isNodeOutputSource(node) || Boolean(getFileNodeImageOriginalUrl(node))) {
      return this.resolveRemoteBackendFileId(node.fileId, options.signal);
    }

    return null;
  }

  private completeWithFile(
    _node: FileNodeData,
    options: FileResourceResolveOptions,
    file: File,
    complete: (
      source: FileResourceSelectedSource,
      partial: Omit<FileResourceHandle, 'purpose' | 'require' | 'selectedSource' | 'fallbackChain' | 'diagnostics' | 'release'>,
      detail?: Record<string, unknown>,
    ) => FileResourceHandle,
    source: FileResourceSelectedSource,
    retainObjectUrl?: (objectUrl: string) => void,
    detail?: Record<string, unknown>,
  ): FileResourceHandle {
    if (options.require === 'file') {
      return complete(source, { file }, detail);
    }
    if (options.require === 'blob') {
      return complete(source, { blob: file }, detail);
    }
    if (options.require === 'objectUrl' || options.require === 'displayUrl') {
      const objectUrl = this.createObjectUrl(file);
      retainObjectUrl?.(objectUrl);
      return complete(source, {
        objectUrl,
        displayUrl: objectUrl,
      }, detail);
    }

    return complete(source, { file }, detail);
  }

  private completeWithRemoteDownload(
    node: FileNodeData,
    options: FileResourceResolveOptions,
    blob: Blob,
    complete: (
      source: FileResourceSelectedSource,
      partial: Omit<FileResourceHandle, 'purpose' | 'require' | 'selectedSource' | 'fallbackChain' | 'diagnostics' | 'release'>,
      detail?: Record<string, unknown>,
    ) => FileResourceHandle,
    source: FileResourceSelectedSource,
    remoteUrl: string,
    backendFileId: string | undefined,
    retainObjectUrl?: (objectUrl: string) => void,
  ): FileResourceHandle {
    const file = toFileFromBlob(node, blob);
    const manifestKey = createManifestKey(node, options);
    const downloadVariant = createRemoteDownloadVariant(file, remoteUrl);
    const resolvedBackendFileId = backendFileId ?? node.backendFileId ?? node.fileId;

    imageOriginalSourceRegistry.registerLocalFile(node.id.value, node.fileId, file, {
      workflowId: options.workflowId,
      authScope: options.authScope,
      version: options.version,
      etag: options.etag,
    });
    fileManifestStore.markLocalFile({
      key: manifestKey,
      file,
      sourceType: isNodeOutputSource(node) ? 'node-output' : 'remote-backend',
    });
    fileManifestStore.markBackendReady({
      key: manifestKey,
      backendFileId: resolvedBackendFileId,
      variant: downloadVariant,
    });
    const diagnosticDetail = {
      remoteDownloadVariant: downloadVariant,
    };

    if (options.require === 'file') {
      return complete(source, { file }, diagnosticDetail);
    }
    if (options.require === 'blob') {
      return complete(source, { blob: file }, diagnosticDetail);
    }
    if (options.require === 'objectUrl' || options.require === 'displayUrl') {
      const objectUrl = this.createObjectUrl(file);
      retainObjectUrl?.(objectUrl);
      return complete(source, {
        objectUrl,
        displayUrl: objectUrl,
      }, diagnosticDetail);
    }

    return complete(source, { displayUrl: remoteUrl }, diagnosticDetail);
  }

  private createDiagnostics(
    node: FileNodeData,
    options: FileResourceResolveOptions,
    selectedSource: FileResourceSelectedSource,
    fallbackChain: FileResourceSelectedSource[],
    lease: FileResourceLease | null,
  ): FileResourceDiagnosticsMetadata {
    return {
      purpose: options.purpose,
      require: options.require,
      workflowId: options.workflowId ?? null,
      nodeId: node.id.value,
      fileId: node.fileId,
      backendFileId: node.backendFileId ?? null,
      authScope: options.authScope ?? null,
      selectedSource,
      fallbackChain: [...fallbackChain],
      leaseId: lease?.leaseId ?? null,
    };
  }

  private createManifestDiagnostics(manifest: FileResourceManifest | null): Record<string, unknown> | null {
    if (!manifest) {
      return null;
    }

    return {
      status: manifest.status,
      sourceType: manifest.sourceType,
      hasLocalFile: manifest.hasLocalFile,
      hasRuntimeFile: manifest.hasRuntimeFile,
      hasRemoteOriginal: manifest.hasRemoteOriginal,
      leaseCount: manifest.leaseCount,
      lastError: manifest.lastError,
      variants: Object.keys(manifest.variants),
    };
  }
}

export const fileResourceService = new FileResourceService();

export function resolveFileResource(
  node: FileNodeData,
  options: FileResourceResolveOptions,
): Promise<FileResourceHandle> {
  return fileResourceService.resolveFileResource(node, options);
}
