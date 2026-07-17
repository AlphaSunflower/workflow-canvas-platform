import type { FileInfo, FileNodeData } from '@/types';
import { httpClient } from '@/api/client/http-client';
import { fetchProtectedResourceBlob } from '@/services/protected-resource';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import { imageThumbnailRuntimeStore } from '@/services/image/image-thumbnail-runtime-store';
import {
  fileManifestStore,
  fileResourceLeaseManager,
  type FileResourceManifestKey,
} from '@/services/file-resource';
import { createModuleLogger } from '@/utils';
import {
  createExecutionOutputAccessDeniedError,
  getExecutionOutputAccessDeniedMessage,
  isExecutionOutputAccessDeniedError,
} from './execution-output-access-error';

export type ExecutionOutputRuntimeSyncStatus =
  | 'idle'
  | 'syncing'
  | 'ready'
  | 'failed';

export interface ExecutionOutputRuntimeResource {
  fileId: string;
  backendFileId: string;
  file: File;
  fileType: FileInfo['fileType'];
  mimeType: string;
  objectUrl: string;
  fileInfo: FileInfo;
  syncedAt: number;
}

interface ExecutionOutputRuntimeEntry {
  status: ExecutionOutputRuntimeSyncStatus;
  resource?: ExecutionOutputRuntimeResource;
  error?: string;
  stickyFailure?: boolean;
  promise?: Promise<ExecutionOutputRuntimeResource | null>;
}

const log = createModuleLogger('execution-output-runtime-sync');

const runtimeEntries = new Map<string, ExecutionOutputRuntimeEntry>();
const runtimeFileInfoCache = new Map<string, FileInfo>();
const nodeBindingsByRuntimeKey = new Map<string, {
  nodeId: string;
  fileId: string;
  workflowId?: string | null;
}>();
const nodeBindingsByFileId = new Map<string, Set<string>>();
const nodeRuntimeListeners = new Map<string, Set<(resource: ExecutionOutputRuntimeResource) => void>>();

interface BackendExecutionOutputFileResponse {
  fileId: string;
  originalName: string;
  displayName: string;
  mimeType: string;
  fileType: 'image' | 'video' | 'ply' | 'unknown';
  sourceType: 'input' | 'intermediate' | 'output';
  sha256: string | null;
  size: number | null;
  extension: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: 'pending_upload' | 'ready';
  createdAt: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
}

export interface EnsureExecutionOutputRuntimeResourceOptions {
  signal?: AbortSignal;
  maxImmediateSyncBytes?: number;
}

function createRuntimeKey(nodeId: string, fileId: string): string {
  return `${nodeId}:${fileId}`;
}

function createRuntimeManifestKey(
  nodeId: string,
  fileId: string,
  workflowId?: string | null,
): FileResourceManifestKey {
  return {
    workflowId,
    nodeId,
    fileId,
    variant: 'original',
  };
}

function revokeResource(resource: ExecutionOutputRuntimeResource | undefined): void {
  if (resource?.objectUrl) {
    URL.revokeObjectURL(resource.objectUrl);
  }
}

function resolveFileName(fileInfo: FileInfo): string {
  const candidate = fileInfo.originalName?.trim()
    || fileInfo.name?.trim()
    || fileInfo.id;
  return candidate.length > 0 ? candidate : fileInfo.id;
}

function toBackendFileFormat(file: BackendExecutionOutputFileResponse): FileInfo['format'] {
  const extension = file.extension?.trim().toLowerCase();

  if (extension === 'ply') {
    return 'ply';
  }

  if (
    extension === 'jpg'
    || extension === 'jpeg'
    || extension === 'png'
    || extension === 'gif'
    || extension === 'webp'
    || extension === 'bmp'
    || extension === 'svg'
    || extension === 'mp4'
    || extension === 'webm'
    || extension === 'mov'
    || extension === 'avi'
    || extension === 'mkv'
  ) {
    return extension;
  }

  if (file.fileType === 'ply') {
    return 'ply';
  }

  if (file.fileType === 'video') {
    return 'mp4';
  }

  return 'png';
}

function toBackendFileInfoType(file: BackendExecutionOutputFileResponse): FileInfo['fileType'] {
  if (file.fileType === 'ply') {
    return 'model3d';
  }

  if (file.fileType === 'video') {
    return 'video';
  }

  return 'image';
}

function toRuntimeFileInfo(file: BackendExecutionOutputFileResponse): FileInfo {
  const resolvedName = file.displayName || file.originalName || file.fileId;

  return {
    id: file.fileId,
    name: resolvedName,
    originalName: file.originalName || resolvedName,
    size: file.size ?? 0,
    mimeType: file.mimeType,
    format: toBackendFileFormat(file),
    fileType: toBackendFileInfoType(file),
    status: file.status === 'ready' ? 'ready' : 'uploading',
    hash: file.sha256 ?? '',
    path: file.downloadUrl ?? `/api/v1/files/${file.fileId}/download`,
    ...(file.thumbnailUrl ? { thumbnailPath: file.thumbnailUrl } : {}),
    ...(file.previewUrl ? { previewPath: file.previewUrl } : {}),
    metadata: {
      ...(typeof file.width === 'number' ? { width: file.width } : {}),
      ...(typeof file.height === 'number' ? { height: file.height } : {}),
      ...(typeof file.duration === 'number' ? { duration: file.duration } : {}),
    },
    source: {
      type: 'node-output',
    },
    timestamp: {
      created: Date.parse(file.createdAt) || Date.now(),
      updated: Date.parse(file.createdAt) || Date.now(),
    },
  };
}

function shouldSkipImmediateSync(
  fileInfo: FileInfo,
  options: EnsureExecutionOutputRuntimeResourceOptions,
): boolean {
  const limit = options.maxImmediateSyncBytes;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return false;
  }

  return fileInfo.size > limit;
}

function createFileFromBlob(fileInfo: FileInfo, blob: Blob): File {
  return new File([blob], resolveFileName(fileInfo), {
    type: blob.type || fileInfo.mimeType || 'application/octet-stream',
    lastModified: Date.now(),
  });
}

interface ExecutionOutputNodeRuntimeSourceOptions {
  workflowId?: string | null;
  clearOriginalSource?: boolean;
}

function markRuntimeResourceManifest(
  nodeId: string,
  fileId: string,
  resource: ExecutionOutputRuntimeResource,
  options: ExecutionOutputNodeRuntimeSourceOptions = {},
): void {
  const key = createRuntimeManifestKey(nodeId, fileId, options.workflowId);
  fileManifestStore.markRuntimeFile({
    key,
    file: resource.file,
    sourceType: 'node-output',
  });
  fileManifestStore.markBackendReady({
    key,
    backendFileId: resource.backendFileId,
    variant: {
      url: resource.fileInfo.path,
      mimeType: resource.mimeType,
      width: resource.fileInfo.metadata?.width,
      height: resource.fileInfo.metadata?.height,
      size: resource.file.size || resource.fileInfo.size,
      updatedAt: resource.syncedAt,
    },
  });
}

function bindImageRuntimeToNode(
  nodeId: string,
  fileId: string,
  resource: ExecutionOutputRuntimeResource,
  options: ExecutionOutputNodeRuntimeSourceOptions = {},
): void {
  const thumbnailObjectUrl = URL.createObjectURL(resource.file);

  imageOriginalSourceRegistry.registerLocalFile(nodeId, fileId, resource.file, {
    workflowId: options.workflowId,
  });
  // The thumbnail runtime store owns this derived object URL and is responsible for revoking it.
  imageThumbnailRuntimeStore.upsert(nodeId, {
    blob: resource.file,
    objectUrl: thumbnailObjectUrl,
    objectUrlOwner: 'thumbnail-store',
    mimeType: resource.mimeType,
    status: 'ready',
  });
}

function bindRuntimeResourceToNode(
  nodeId: string,
  fileId: string,
  resource: ExecutionOutputRuntimeResource,
  options: ExecutionOutputNodeRuntimeSourceOptions = {},
): void {
  if (resource.fileType === 'image') {
    bindImageRuntimeToNode(nodeId, fileId, resource, options);
  }
  markRuntimeResourceManifest(nodeId, fileId, resource, options);
}

function registerNodeBinding(
  nodeId: string,
  fileId: string,
  options: ExecutionOutputNodeRuntimeSourceOptions = {},
): void {
  const runtimeKey = createRuntimeKey(nodeId, fileId);
  nodeBindingsByRuntimeKey.set(runtimeKey, {
    nodeId,
    fileId,
    workflowId: options.workflowId,
  });
  const boundNodeIds = nodeBindingsByFileId.get(fileId) ?? new Set<string>();
  boundNodeIds.add(nodeId);
  nodeBindingsByFileId.set(fileId, boundNodeIds);
}

function unregisterNodeBinding(nodeId: string, fileId: string): void {
  const runtimeKey = createRuntimeKey(nodeId, fileId);
  nodeBindingsByRuntimeKey.delete(runtimeKey);
  const boundNodeIds = nodeBindingsByFileId.get(fileId);
  if (!boundNodeIds) {
    return;
  }

  boundNodeIds.delete(nodeId);
  if (boundNodeIds.size === 0) {
    nodeBindingsByFileId.delete(fileId);
  }
}

function applyRuntimeResourceToRegisteredNodes(fileId: string, resource: ExecutionOutputRuntimeResource): void {
  const boundNodeIds = nodeBindingsByFileId.get(fileId);
  if (boundNodeIds && boundNodeIds.size > 0) {
    boundNodeIds.forEach((nodeId) => {
      const binding = nodeBindingsByRuntimeKey.get(createRuntimeKey(nodeId, fileId));
      bindRuntimeResourceToNode(nodeId, fileId, resource, {
        workflowId: binding?.workflowId,
      });
    });
  }

  nodeRuntimeListeners.get(fileId)?.forEach((listener) => {
    listener(resource);
  });
}

async function downloadRuntimeResource(
  fileInfo: FileInfo,
  signal?: AbortSignal,
): Promise<ExecutionOutputRuntimeResource> {
  let blob: Blob;
  try {
    blob = await fetchProtectedResourceBlob(fileInfo.path, { signal });
  } catch (error) {
    if (isExecutionOutputAccessDeniedError(error)) {
      throw createExecutionOutputAccessDeniedError({
        fileId: fileInfo.id,
        module: 'execution-output-runtime-sync',
        operation: 'downloadRuntimeResource',
        cause: error,
        path: fileInfo.path,
      });
    }
    throw error;
  }
  const file = createFileFromBlob(fileInfo, blob);
  const objectUrl = URL.createObjectURL(file);

  return {
    fileId: fileInfo.id,
    backendFileId: fileInfo.id,
    file,
    fileType: fileInfo.fileType,
    mimeType: file.type || fileInfo.mimeType || 'application/octet-stream',
    objectUrl,
    fileInfo,
    syncedAt: Date.now(),
  };
}

export async function getExecutionOutputRuntimeFileInfo(
  fileId: string,
  signal?: AbortSignal,
): Promise<FileInfo> {
  const cached = runtimeFileInfoCache.get(fileId);
  if (cached) {
    return cached;
  }

  const result = await httpClient.get<BackendExecutionOutputFileResponse>(`/api/v1/files/${fileId}`, undefined, {
    signal,
    timeout: 30000,
  });

  if (!result.success) {
    if (isExecutionOutputAccessDeniedError(result.error)) {
      throw createExecutionOutputAccessDeniedError({
        fileId,
        module: 'execution-output-runtime-sync',
        operation: 'getExecutionOutputRuntimeFileInfo',
        cause: result.error,
      });
    }
    throw result.error;
  }

  const fileInfo = toRuntimeFileInfo(result.data);
  runtimeFileInfoCache.set(fileId, fileInfo);
  return fileInfo;
}

export function getExecutionOutputRuntimeStatus(fileId: string): ExecutionOutputRuntimeSyncStatus {
  return runtimeEntries.get(fileId)?.status ?? 'idle';
}

export function getExecutionOutputRuntimeResource(fileId: string): ExecutionOutputRuntimeResource | null {
  const entry = runtimeEntries.get(fileId);
  const resource = entry?.resource;
  if (!entry || !resource) {
    return null;
  }

  if (!resource.objectUrl) {
    const objectUrl = URL.createObjectURL(resource.file);
    const refreshedResource: ExecutionOutputRuntimeResource = {
      ...resource,
      objectUrl,
    };
    runtimeEntries.set(fileId, {
      ...entry,
      resource: refreshedResource,
    });
    return refreshedResource;
  }

  return resource;
}

export function getExecutionOutputRuntimeError(fileId: string): string | null {
  return runtimeEntries.get(fileId)?.error ?? null;
}

export function registerExecutionOutputNodeRuntimeSource(
  nodeId: string,
  fileId: string,
  options: ExecutionOutputNodeRuntimeSourceOptions = {},
): void {
  registerNodeBinding(nodeId, fileId, options);

  const resource = getExecutionOutputRuntimeResource(fileId);
  if (!resource) {
    return;
  }

  bindRuntimeResourceToNode(nodeId, fileId, resource, options);
}

export function unregisterExecutionOutputNodeRuntimeSource(
  nodeId: string,
  fileId: string,
  options: ExecutionOutputNodeRuntimeSourceOptions = {},
): void {
  unregisterNodeBinding(nodeId, fileId);
  if (options.clearOriginalSource === true) {
    imageOriginalSourceRegistry.unregister(nodeId, fileId, {
      workflowId: options.workflowId,
      preserveLeased: true,
    });
  }
  imageThumbnailRuntimeStore.clearNode(nodeId);
}

export function subscribeExecutionOutputNodeRuntime(
  fileId: string,
  listener: (resource: ExecutionOutputRuntimeResource) => void,
): () => void {
  const listeners = nodeRuntimeListeners.get(fileId) ?? new Set<(resource: ExecutionOutputRuntimeResource) => void>();
  listeners.add(listener);
  nodeRuntimeListeners.set(fileId, listeners);

  return (): void => {
    const currentListeners = nodeRuntimeListeners.get(fileId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      nodeRuntimeListeners.delete(fileId);
    }
  };
}

export function registerExecutionOutputNodeOriginalSource(
  nodeId: string,
  fileId: string,
  resource: ExecutionOutputRuntimeResource | null = getExecutionOutputRuntimeResource(fileId),
  options: ExecutionOutputNodeRuntimeSourceOptions = {},
): boolean {
  if (resource?.fileType !== 'image') {
    return false;
  }

  imageOriginalSourceRegistry.registerLocalFile(nodeId, fileId, resource.file, {
    workflowId: options.workflowId,
  });
  markRuntimeResourceManifest(nodeId, fileId, resource, options);
  return true;
}

export async function ensureExecutionOutputRuntimeResource(
  fileInfo: FileInfo,
  options: EnsureExecutionOutputRuntimeResourceOptions = {},
): Promise<ExecutionOutputRuntimeResource | null> {
  runtimeFileInfoCache.set(fileInfo.id, fileInfo);

  const existing = runtimeEntries.get(fileInfo.id);
  if (existing?.status === 'ready' && existing.resource) {
    return existing.resource;
  }

  if (existing?.status === 'failed' && existing.stickyFailure) {
    return null;
  }

  if (existing?.promise) {
    return existing.promise;
  }

  if (shouldSkipImmediateSync(fileInfo, options)) {
    log.info('ensureExecutionOutputRuntimeResource', 'Skipped immediate execution output sync because file exceeded configured limit', {
      fileId: fileInfo.id,
      size: fileInfo.size,
      maxImmediateSyncBytes: options.maxImmediateSyncBytes,
    });
    return null;
  }

  const promise = downloadRuntimeResource(fileInfo, options.signal)
    .then((resource) => {
      const previous = runtimeEntries.get(fileInfo.id)?.resource;
      if (previous && previous !== resource) {
        revokeResource(previous);
      }

      runtimeEntries.set(fileInfo.id, {
        status: 'ready',
        resource,
      });
      applyRuntimeResourceToRegisteredNodes(fileInfo.id, resource);

      log.info('ensureExecutionOutputRuntimeResource', 'Synchronized execution output resource', {
        fileId: fileInfo.id,
        fileType: fileInfo.fileType,
        size: resource.file.size,
      });

      return resource;
    })
    .catch((error: unknown) => {
      const stickyFailure = isExecutionOutputAccessDeniedError(error);
      const errorMessage = stickyFailure
        ? getExecutionOutputAccessDeniedMessage(fileInfo.id)
        : error instanceof Error
          ? error.message
          : 'Failed to synchronize execution output resource.';

      runtimeEntries.set(fileInfo.id, {
        status: 'failed',
        error: errorMessage,
        stickyFailure,
      });

      const logMethod = stickyFailure ? 'info' : 'warn';
      log[logMethod]('ensureExecutionOutputRuntimeResource', 'Failed to synchronize execution output resource', {
        fileId: fileInfo.id,
        fileType: fileInfo.fileType,
        stickyFailure,
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });

      return null;
    });

  runtimeEntries.set(fileInfo.id, {
    status: 'syncing',
    promise,
  });

  return promise;
}

export async function ensureExecutionOutputRuntimeResourceByFileId(
  fileId: string,
  options: EnsureExecutionOutputRuntimeResourceOptions = {},
): Promise<ExecutionOutputRuntimeResource | null> {
  try {
    const fileInfo = await getExecutionOutputRuntimeFileInfo(fileId, options.signal);
    return ensureExecutionOutputRuntimeResource(fileInfo, options);
  } catch (error) {
    const stickyFailure = isExecutionOutputAccessDeniedError(error);
    runtimeEntries.set(fileId, {
      status: 'failed',
      error: stickyFailure
        ? getExecutionOutputAccessDeniedMessage(fileId)
        : error instanceof Error
          ? error.message
          : 'Failed to resolve execution output file information.',
      stickyFailure,
    });

    const logMethod = stickyFailure ? 'info' : 'warn';
    log[logMethod]('ensureExecutionOutputRuntimeResourceByFileId', 'Failed to resolve execution output file information', {
      fileId,
      stickyFailure,
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

export async function prefetchExecutionOutputRuntimeResource(
  fileInfo: FileInfo,
  options: EnsureExecutionOutputRuntimeResourceOptions = {},
): Promise<void> {
  await ensureExecutionOutputRuntimeResource(fileInfo, options);
}

export async function prefetchExecutionOutputRuntimeResourceByFileId(
  fileId: string,
  options: EnsureExecutionOutputRuntimeResourceOptions = {},
): Promise<void> {
  await ensureExecutionOutputRuntimeResourceByFileId(fileId, options);
}

export function resolveExecutionOutputNodePreviewUrl(
  node: Pick<FileNodeData, 'type' | 'fileId'>,
): string | undefined {
  const resource = getExecutionOutputRuntimeResource(node.fileId);
  if (!resource) {
    return undefined;
  }

  return resource.objectUrl;
}

export function getExecutionOutputNodeFile(
  node: Pick<FileNodeData, 'fileId'>,
): File | null {
  return getExecutionOutputRuntimeResource(node.fileId)?.file ?? null;
}

function getRuntimeBindingsForFileId(fileId: string): Array<[string, {
  nodeId: string;
  fileId: string;
  workflowId?: string | null;
}]> {
  return Array.from(nodeBindingsByRuntimeKey.entries())
    .filter(([, binding]) => binding.fileId === fileId);
}

function isRuntimeBindingLeased(binding: {
  nodeId: string;
  fileId: string;
  workflowId?: string | null;
}): boolean {
  return (
    fileResourceLeaseManager.isLeased(createRuntimeManifestKey(binding.nodeId, binding.fileId, binding.workflowId))
    || fileResourceLeaseManager.isLeased(createRuntimeManifestKey(binding.nodeId, binding.fileId))
  );
}

function isRuntimeFileLeased(fileId: string): boolean {
  const bindings = getRuntimeBindingsForFileId(fileId);
  if (bindings.some(([, binding]) => isRuntimeBindingLeased(binding))) {
    return true;
  }

  return fileResourceLeaseManager.getLeaseSnapshot().leases.some((lease) => (
    lease.fileId === fileId
    && (lease.key.variant === 'original' || lease.key.variant === 'runtime' || lease.key.variant == null)
  ));
}

interface ClearExecutionOutputRuntimeResourceOptions {
  force?: boolean;
}

function revokeRuntimeObjectUrlOnly(fileId: string, entry: ExecutionOutputRuntimeEntry): void {
  const resource = entry.resource;
  if (!resource?.objectUrl) {
    return;
  }

  URL.revokeObjectURL(resource.objectUrl);
  runtimeEntries.set(fileId, {
    ...entry,
    resource: {
      ...resource,
      objectUrl: '',
    },
  });
}

function markRuntimeResourceCleared(binding: {
  nodeId: string;
  fileId: string;
  workflowId?: string | null;
}): void {
  fileManifestStore.upsert({
    key: createRuntimeManifestKey(binding.nodeId, binding.fileId, binding.workflowId),
    hasRuntimeFile: false,
  });
}

export function clearExecutionOutputRuntimeResource(
  fileId: string,
  options: ClearExecutionOutputRuntimeResourceOptions = {},
): void {
  const entry = runtimeEntries.get(fileId);
  if (!entry) {
    runtimeFileInfoCache.delete(fileId);
    nodeRuntimeListeners.delete(fileId);
    return;
  }

  const bindings = getRuntimeBindingsForFileId(fileId);
  const isLeased = !options.force && isRuntimeFileLeased(fileId);

  if (isLeased) {
    revokeRuntimeObjectUrlOnly(fileId, entry);
    bindings.forEach(([, binding]) => {
      imageOriginalSourceRegistry.unregister(binding.nodeId, binding.fileId, {
        workflowId: binding.workflowId,
        preserveLeased: true,
      });
      imageThumbnailRuntimeStore.clearNode(binding.nodeId);
    });
    return;
  }

  revokeResource(entry.resource);
  runtimeEntries.delete(fileId);
  runtimeFileInfoCache.delete(fileId);

  bindings.forEach(([key, binding]) => {
    imageOriginalSourceRegistry.unregister(binding.nodeId, binding.fileId, {
      workflowId: binding.workflowId,
      force: options.force,
      preserveLeased: options.force ? false : true,
    });
    imageThumbnailRuntimeStore.clearNode(binding.nodeId);
    markRuntimeResourceCleared(binding);
    nodeBindingsByRuntimeKey.delete(key);
  });
  nodeBindingsByFileId.delete(fileId);
  nodeRuntimeListeners.delete(fileId);
}

export function clearExecutionOutputRuntimeResources(
  options: ClearExecutionOutputRuntimeResourceOptions = {},
): void {
  Array.from(runtimeEntries.keys()).forEach((fileId) => clearExecutionOutputRuntimeResource(fileId, options));
}

export const executionOutputRuntimeSyncService = {
  ensure: ensureExecutionOutputRuntimeResource,
  ensureByFileId: ensureExecutionOutputRuntimeResourceByFileId,
  prefetch: prefetchExecutionOutputRuntimeResource,
  prefetchByFileId: prefetchExecutionOutputRuntimeResourceByFileId,
  getResource: getExecutionOutputRuntimeResource,
  getError: getExecutionOutputRuntimeError,
  getFileInfo: getExecutionOutputRuntimeFileInfo,
  getStatus: getExecutionOutputRuntimeStatus,
  registerNodeRuntimeSource: registerExecutionOutputNodeRuntimeSource,
  unregisterNodeRuntimeSource: unregisterExecutionOutputNodeRuntimeSource,
  subscribeNodeRuntime: subscribeExecutionOutputNodeRuntime,
  registerNodeOriginalSource: registerExecutionOutputNodeOriginalSource,
  resolveNodePreviewUrl: resolveExecutionOutputNodePreviewUrl,
  getNodeFile: getExecutionOutputNodeFile,
  clear: clearExecutionOutputRuntimeResource,
  clearAll: clearExecutionOutputRuntimeResources,
};
