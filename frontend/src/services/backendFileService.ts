import type { FileInfo, FileNodeData } from '@/types';
import { httpClient } from '@/api/client/http-client';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import { createError, createModuleLogger } from '@/utils';
import {
  fileManifestStore,
  resolveFileResource,
  type FileResourceDiagnosticsMetadata,
  type FileResourceHandle,
  type FileResourcePurpose,
} from './file-resource';
import type {
  BackendFileBindingScope,
  BackendFileAssetResponse,
  BackendFileRegisterResponse,
  BackendFileUploadResponse,
  CachedBackendFileBinding,
} from './backend-file-binding.contracts';
import { hashWorkflowFile } from './workflow-upload-hash';

export type EnsureBackendFilePurpose = Extract<FileResourcePurpose, 'upload-input' | 'prompt-reference'>;

export interface EnsureBackendFileOptions {
  signal?: AbortSignal;
  purpose?: EnsureBackendFilePurpose;
  workflowId?: string | null;
  authScope?: string | null;
}

export interface RegisterBackendBlobFileOptions extends EnsureBackendFileOptions {
  fileName?: string;
  displayName?: string;
  fileType?: 'image' | 'video' | 'ply' | 'unknown';
  sourceType?: 'input' | 'intermediate' | 'output';
  mimeType?: string;
}

export interface RuntimeNodeFileSourceOptions {
  workflowId?: string | null;
  authScope?: string | null;
}

export type BackendFileIdResolver = (
  node: FileNodeData,
  options?: EnsureBackendFileOptions,
) => Promise<string>;

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

const log = createModuleLogger('backend-file-service');
const localFileBindingCache = new Map<string, CachedBackendFileBinding>();
const sha256BindingCache = new Map<string, string>();
const backendFileInfoCache = new Map<string, FileInfo>();
let backendFileIdResolver: BackendFileIdResolver | null = null;

function normalizeScopePart(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : '*';
}

function createLocalBindingKey(
  node: Pick<FileNodeData, 'id' | 'fileId'>,
  scope: BackendFileBindingScope = {},
): string {
  return [
    normalizeScopePart(scope.workflowId),
    normalizeScopePart(scope.authScope),
    node.id.value,
    node.fileId,
  ].map((part) => encodeURIComponent(part)).join('|');
}

function createManifestKeyFromNode(
  node: Pick<FileNodeData, 'id' | 'fileId'>,
  scope: BackendFileBindingScope = {},
): {
  workflowId?: string | null;
  authScope?: string | null;
  nodeId: string;
  fileId: string;
} {
  return {
    workflowId: scope.workflowId,
    authScope: scope.authScope,
    nodeId: node.id.value,
    fileId: node.fileId,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNodeOutputSource(node: FileNodeData): boolean {
  return node.source?.type === 'node-output';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

function getFileResourceDiagnostics(error: unknown): FileResourceDiagnosticsMetadata | undefined {
  return error && typeof error === 'object'
    ? (error as { fileResourceDiagnostics?: FileResourceDiagnosticsMetadata }).fileResourceDiagnostics
    : undefined;
}

function hasRemoteBackendOriginal(node: FileNodeData): boolean {
  return typeof node.imageAsset?.variants.original?.url === 'string'
    && node.imageAsset.variants.original.url.startsWith('/api/v1/files/');
}

function shouldProbeRemoteBackendFile(node: FileNodeData): boolean {
  return isNodeOutputSource(node) || hasRemoteBackendOriginal(node);
}

function toBackendFileType(node: FileNodeData): 'image' | 'ply' | 'unknown' {
  if (node.type === 'image') {
    return 'image';
  }

  if (node.type === 'ply') {
    return 'ply';
  }

  return 'unknown';
}

function toBackendFileFormat(file: BackendFileAssetResponse): FileInfo['format'] {
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

  return file.fileType === 'ply' ? 'ply' : 'png';
}

function toBackendFileInfoType(file: BackendFileAssetResponse): FileInfo['fileType'] {
  if (file.fileType === 'ply') {
    return 'model3d';
  }

  if (file.fileType === 'video') {
    return 'video';
  }

  return 'image';
}

function toFileInfo(file: BackendFileAssetResponse): FileInfo {
  const resolvedName = file.displayName || file.originalName || file.fileId;
  const resolvedFormat = toBackendFileFormat(file);

  return {
    id: file.fileId,
    name: resolvedName,
    originalName: file.originalName,
    size: file.size ?? 0,
    mimeType: file.mimeType,
    format: resolvedFormat,
    fileType: toBackendFileInfoType(file),
    status: file.status === 'ready' ? 'ready' : 'uploading',
    hash: file.sha256 ?? '',
    path: file.downloadUrl ?? `/api/v1/files/${file.fileId}/download`,
    ...(file.thumbnailUrl || file.previewUrl || file.fileType === 'image'
      ? { thumbnailPath: file.thumbnailUrl ?? file.previewUrl ?? `/api/v1/files/${file.fileId}/thumbnail` }
      : {}),
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

async function parseApiEnvelope<T>(response: Response, operation: string): Promise<T> {
  let payload: ApiEnvelope<T>;

  try {
    payload = await response.json() as ApiEnvelope<T>;
  } catch (error) {
    throw createError('UNKNOWN_ERROR', 'Failed to parse backend file API response.', {
      module: 'backend-file-service',
      operation,
      timestamp: Date.now(),
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (payload.code !== 0 && payload.code !== 200) {
    throw createError('UNKNOWN_ERROR', payload.message || 'Backend file API request failed.', {
      module: 'backend-file-service',
      operation,
      timestamp: Date.now(),
      context: {
        code: payload.code,
      },
    });
  }

  return payload.data;
}

export function getCachedBackendFileBinding(
  node: Pick<FileNodeData, 'id' | 'fileId'>,
  scope: BackendFileBindingScope = {},
): CachedBackendFileBinding | null {
  return localFileBindingCache.get(createLocalBindingKey(node, scope)) ?? null;
}

export function cacheBackendFileBinding(
  node: Pick<FileNodeData, 'id' | 'fileId'>,
  binding: CachedBackendFileBinding,
  scope: BackendFileBindingScope = {},
): void {
  localFileBindingCache.set(createLocalBindingKey(node, scope), binding);
  fileManifestStore.markBackendReady({
    key: createManifestKeyFromNode(node, scope),
    backendFileId: binding.backendFileId,
    binding,
  });
}

export function getCachedBackendFileIdBySha256(sha256: string): string | null {
  return sha256BindingCache.get(sha256) ?? null;
}

export function cacheBackendFileIdBySha256(sha256: string, backendFileId: string): void {
  sha256BindingCache.set(sha256, backendFileId);
}

export function setBackendFileIdResolver(
  resolver: BackendFileIdResolver | null,
): BackendFileIdResolver | null {
  const previousResolver = backendFileIdResolver;
  backendFileIdResolver = resolver;
  return previousResolver;
}

export function registerRuntimeNodeFileSource(
  nodeId: string,
  fileId: string,
  file: File,
  options: RuntimeNodeFileSourceOptions = {},
): void {
  imageOriginalSourceRegistry.registerLocalFile(nodeId, fileId, file, {
    workflowId: options.workflowId,
    authScope: options.authScope,
  });
  fileManifestStore.markLocalFile({
    key: { workflowId: options.workflowId, authScope: options.authScope, nodeId, fileId },
    file,
  });
}

export function restoreRuntimeNodeFileSourceFromHandle(
  node: Pick<FileNodeData, 'id' | 'fileId'>,
  file: File,
  options: RuntimeNodeFileSourceOptions = {},
): void {
  registerRuntimeNodeFileSource(node.id.value, node.fileId, file, options);
}

export function hasRuntimeNodeFileSource(nodeId: string, fileId: string): boolean {
  return imageOriginalSourceRegistry.hasLocalFile(nodeId, fileId);
}

export function getRuntimeNodeFileSource(nodeId: string, fileId: string): File | null {
  return imageOriginalSourceRegistry.getFile(nodeId, fileId);
}

export function forceDeleteNodeResource(
  nodeId: string,
  fileId: string,
  options: RuntimeNodeFileSourceOptions = {},
): void {
  imageOriginalSourceRegistry.forceClearForDeletedNode(nodeId, fileId, options.workflowId);
  fileManifestStore.upsert({
    key: { workflowId: options.workflowId, authScope: options.authScope, nodeId, fileId },
    hasLocalFile: false,
  });
}

export function unregisterRuntimeNodeFileSource(
  nodeId: string,
  fileId: string,
  options: RuntimeNodeFileSourceOptions = {},
): void {
  forceDeleteNodeResource(nodeId, fileId, options);
}

export function clearRuntimeNodeFileSources(options: RuntimeNodeFileSourceOptions = {}): void {
  imageOriginalSourceRegistry.clearUnleased(options.workflowId);
}

export function syncRuntimeNodeFileSources(
  activeNodes: Iterable<Pick<FileNodeData, 'id' | 'fileId'>>,
  options: RuntimeNodeFileSourceOptions = {},
): void {
  imageOriginalSourceRegistry.sync(activeNodes, {
    workflowId: options.workflowId,
    preserveLeased: true,
  });
}

export async function resolveExistingBackendFileId(
  node: FileNodeData,
  optionsOrSignal?: EnsureBackendFileOptions | AbortSignal,
): Promise<string | null> {
  const options: EnsureBackendFileOptions = optionsOrSignal instanceof AbortSignal
    ? { signal: optionsOrSignal }
    : optionsOrSignal ?? {};
  if (isNonEmptyString(node.backendFileId)) {
    return node.backendFileId.trim();
  }

  const cachedBinding = getCachedBackendFileBinding(node, {
    workflowId: options.workflowId,
    authScope: options.authScope,
  });
  if (cachedBinding) {
    log.debug('resolveExistingBackendFileId', 'Using cached backend file id', {
      nodeId: node.id.value,
      localFileId: node.fileId,
      workflowId: options.workflowId ?? null,
      authScope: options.authScope ?? null,
      backendFileId: cachedBinding.backendFileId,
    });
    return cachedBinding.backendFileId;
  }

  if (!shouldProbeRemoteBackendFile(node)) {
    return null;
  }

  const remoteFileId = await ensureRemoteBackendFileId(node.fileId, options.signal);
  if (!remoteFileId) {
    return null;
  }

  cacheBackendFileBinding(node, {
    backendFileId: remoteFileId,
    sha256: '',
    size: node.fileSize,
    updatedAt: Date.now(),
  }, {
    workflowId: options.workflowId,
    authScope: options.authScope,
  });

  log.info('resolveExistingBackendFileId', 'Resolved backend file id from remote file probe', {
    nodeId: node.id.value,
    localFileId: node.fileId,
    workflowId: options.workflowId ?? null,
    authScope: options.authScope ?? null,
    backendFileId: remoteFileId,
  });

  return remoteFileId;
}

export async function getFileBlobFromNode(node: FileNodeData, signal?: AbortSignal): Promise<File> {
  return getFileBlobFromNodeWithOptions(node, { signal });
}

export async function getFileBlobFromNodeWithOptions(
  node: FileNodeData,
  options: EnsureBackendFileOptions = {},
): Promise<File> {
  let handle: FileResourceHandle | null = null;
  try {
    handle = await resolveFileResource(node, {
      purpose: 'upload-input',
      require: 'file',
      signal: options.signal,
      workflowId: options.workflowId,
      authScope: options.authScope,
      owner: `backend-file-service:get-file:${node.id.value}:${node.fileId}`,
    });
    if (handle.file) {
      return handle.file;
    }
    throw new Error('Resolved upload input did not include a file.');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw createError('FILE_CORRUPTED', 'Failed to locate an original file source to upload.', {
      module: 'backend-file-service',
      operation: 'getFileBlobFromNode',
      timestamp: Date.now(),
      context: {
        nodeId: node.id.value,
        localFileId: node.fileId,
        cause: error instanceof Error ? error.message : String(error),
        fileResourceDiagnostics: getFileResourceDiagnostics(error),
      },
    });
  } finally {
    handle?.release();
  }

  throw createError('FILE_CORRUPTED', 'Failed to locate an original file source to upload.', {
    module: 'backend-file-service',
    operation: 'getFileBlobFromNode',
    timestamp: Date.now(),
    context: {
      nodeId: node.id.value,
      localFileId: node.fileId,
    },
  });
}

export async function registerBackendFile(
  node: FileNodeData,
  file: File,
  sha256: string,
  signal?: AbortSignal,
): Promise<BackendFileRegisterResponse> {
  const result = await httpClient.post<BackendFileRegisterResponse>('/api/v1/files/register', {
    sha256,
    size: file.size,
    mimeType: file.type || node.mimeType || 'application/octet-stream',
    originalName: file.name || node.fileName,
    displayName: node.fileName,
    fileType: toBackendFileType(node),
    sourceType: 'input',
  }, {
    signal,
    timeout: 120000,
  });

  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

export async function registerBackendRawFile(
  file: File,
  sha256: string,
  options: RegisterBackendBlobFileOptions = {},
): Promise<BackendFileRegisterResponse> {
  const originalName = options.fileName?.trim() || file.name || 'workflow-file';
  const displayName = options.displayName?.trim() || originalName;
  const result = await httpClient.post<BackendFileRegisterResponse>('/api/v1/files/register', {
    sha256,
    size: file.size,
    mimeType: options.mimeType || file.type || 'application/octet-stream',
    originalName,
    displayName,
    fileType: options.fileType ?? 'unknown',
    sourceType: options.sourceType ?? 'input',
  }, {
    signal: options.signal,
    timeout: 120000,
  });

  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

export async function uploadBackendFile(
  uploadId: string,
  file: File,
  signal?: AbortSignal,
): Promise<BackendFileUploadResponse> {
  const response = await httpClient.requestRaw('POST', '/api/v1/files/upload', {
    body: file,
    contentType: file.type || 'application/octet-stream',
    headers: {
      'X-Upload-Id': uploadId,
    },
    timeout: 180000,
    signal,
  });

  if (!response.success) {
    throw response.error;
  }

  return parseApiEnvelope<BackendFileUploadResponse>(response.data, 'uploadBackendFile');
}

async function ensureRemoteBackendFileId(fileId: string, signal?: AbortSignal): Promise<string | null> {
  if (!isNonEmptyString(fileId)) {
    return null;
  }

  try {
    const result = await httpClient.get<BackendFileAssetResponse>(`/api/v1/files/${fileId}`, undefined, {
      signal,
      timeout: 15000,
    });

    if (!result.success) {
      return null;
    }

    return isNonEmptyString(result.data.fileId) ? result.data.fileId : null;
  } catch {
    return null;
  }
}

function assertValidBackendFileId(
  backendFileId: string | null | undefined,
  node: FileNodeData,
  operation: string,
): string {
  if (isNonEmptyString(backendFileId)) {
    return backendFileId.trim();
  }

  throw createError('FILE_REGISTER_FAILED', 'Failed to resolve a valid backend file id.', {
    module: 'backend-file-service',
    operation,
    timestamp: Date.now(),
    context: {
      nodeId: node.id.value,
      localFileId: node.fileId,
      backendFileId,
    },
  });
}

function assertValidRawBackendFileId(
  backendFileId: string | null | undefined,
  operation: string,
  context: Record<string, unknown>,
): string {
  if (isNonEmptyString(backendFileId)) {
    return backendFileId.trim();
  }

  throw createError('FILE_REGISTER_FAILED', 'Failed to resolve a valid backend file id.', {
    module: 'backend-file-service',
    operation,
    timestamp: Date.now(),
    context: {
      backendFileId,
      ...context,
    },
  });
}

function normalizeBlobFile(
  blob: Blob | File,
  options: RegisterBackendBlobFileOptions,
): File {
  const fileName = options.fileName?.trim()
    || (blob instanceof File && isNonEmptyString(blob.name) ? blob.name.trim() : 'workflow-file');
  const mimeType = options.mimeType || blob.type || 'application/octet-stream';

  if (
    blob instanceof File
    && fileName === blob.name
    && (!options.mimeType || options.mimeType === blob.type)
  ) {
    return blob;
  }

  return new File([blob], fileName, {
    type: mimeType,
    lastModified: blob instanceof File ? blob.lastModified : Date.now(),
  });
}

async function ensureBackendFileIdDirect(
  node: FileNodeData,
  options: EnsureBackendFileOptions = {},
): Promise<string> {
  const purpose = options.purpose ?? 'upload-input';
  const backendIdHandle = await resolveFileResource(node, {
    purpose,
    require: 'backendFileId',
      signal: options.signal,
      workflowId: options.workflowId,
      authScope: options.authScope,
      owner: `backend-file-service:${purpose}:ensure:${node.id.value}:${node.fileId}`,
    }).catch((error: unknown) => {
    log.debug('ensureBackendFileIdDirect', 'Backend id resolver did not satisfy file resource request', {
      nodeId: node.id.value,
      localFileId: node.fileId,
      purpose,
      fileResourceDiagnostics: getFileResourceDiagnostics(error),
    });
    return null;
  });
  if (backendIdHandle?.backendFileId) {
    const backendFileId = backendIdHandle.backendFileId;
    backendIdHandle.release();
    return backendFileId;
  }
  backendIdHandle?.release();

  const existingFileId = await resolveExistingBackendFileId(node, options);
  if (existingFileId) {
    return existingFileId;
  }

  const fileHandle = await resolveFileResource(node, {
    purpose,
    require: 'file',
    signal: options.signal,
    workflowId: options.workflowId,
    authScope: options.authScope,
    owner: `backend-file-service:${purpose}:ensure-file:${node.id.value}:${node.fileId}`,
  });
  const file = fileHandle.file;
  if (!file) {
    fileHandle.release();
    throw createError('FILE_CORRUPTED', 'Failed to locate an original file source to upload.', {
      module: 'backend-file-service',
      operation: 'ensureBackendFileIdDirect',
      timestamp: Date.now(),
      context: {
        nodeId: node.id.value,
        localFileId: node.fileId,
        fileResourceDiagnostics: fileHandle.diagnostics,
      },
    });
  }

  try {
    const sha256 = await hashWorkflowFile(file, options.signal);
    const sha256Cached = getCachedBackendFileIdBySha256(sha256);

    if (sha256Cached) {
      cacheBackendFileBinding(node, {
        backendFileId: sha256Cached,
        sha256,
        size: file.size,
        updatedAt: Date.now(),
      }, {
        workflowId: options.workflowId,
        authScope: options.authScope,
      });
      return sha256Cached;
    }

    const registerResult = await registerBackendFile(node, file, sha256, options.signal);
    const uploadResult = registerResult.uploadRequired && registerResult.uploadId
      ? await uploadBackendFile(registerResult.uploadId, file, options.signal)
      : null;
    const finalFileId = assertValidBackendFileId(
      uploadResult?.fileId ?? registerResult.fileId,
      node,
      'ensureBackendFileIdDirect',
    );

    cacheBackendFileBinding(node, {
      backendFileId: finalFileId,
      sha256,
      size: file.size,
      updatedAt: Date.now(),
    }, {
      workflowId: options.workflowId,
      authScope: options.authScope,
    });
    cacheBackendFileIdBySha256(sha256, finalFileId);

    log.info('ensureBackendFileIdDirect', 'Resolved backend file id directly', {
      nodeId: node.id.value,
      localFileId: node.fileId,
      backendFileId: finalFileId,
      uploaded: Boolean(uploadResult),
    });

    return finalFileId;
  } finally {
    fileHandle.release();
  }
}

export async function registerBackendBlobFile(
  blob: Blob | File,
  options: RegisterBackendBlobFileOptions = {},
): Promise<string> {
  throwIfAborted(options.signal);

  const file = normalizeBlobFile(blob, options);
  const sha256 = await hashWorkflowFile(file, options.signal);
  throwIfAborted(options.signal);

  const sha256Cached = getCachedBackendFileIdBySha256(sha256);
  if (sha256Cached) {
    return sha256Cached;
  }

  const registerResult = await registerBackendRawFile(file, sha256, {
    ...options,
    fileName: options.fileName ?? file.name,
    mimeType: options.mimeType ?? file.type,
  });
  const uploadResult = registerResult.uploadRequired && registerResult.uploadId
    ? await uploadBackendFile(registerResult.uploadId, file, options.signal)
    : null;
  const finalFileId = assertValidRawBackendFileId(
    uploadResult?.fileId ?? registerResult.fileId,
    'registerBackendBlobFile',
    {
      fileName: file.name,
      size: file.size,
      sha256,
      uploaded: Boolean(uploadResult),
    },
  );

  cacheBackendFileIdBySha256(sha256, finalFileId);

  log.info('registerBackendBlobFile', 'Registered backend blob file', {
    backendFileId: finalFileId,
    fileName: file.name,
    size: file.size,
    uploaded: Boolean(uploadResult),
  });

  return finalFileId;
}

export async function registerInpaintMaskFile(
  nodeId: string,
  blob: Blob | File,
  options: EnsureBackendFileOptions = {},
): Promise<string> {
  const normalizedNodeId = nodeId.trim() || 'node';
  return registerBackendBlobFile(blob, {
    ...options,
    fileName: `inpaint-mask-${normalizedNodeId}.png`,
    displayName: `inpaint-mask-${normalizedNodeId}.png`,
    fileType: 'image',
    sourceType: 'input',
    mimeType: 'image/png',
  });
}

export async function ensureBackendFileId(
  node: FileNodeData,
  options: EnsureBackendFileOptions = {},
): Promise<string> {
  if (backendFileIdResolver) {
    try {
      return assertValidBackendFileId(
        await backendFileIdResolver(node, options),
        node,
        'ensureBackendFileId',
      );
    } catch (error) {
      log.warn('ensureBackendFileId', 'Falling back to direct backend file sync', {
        nodeId: node.id.value,
        localFileId: node.fileId,
        reason: error instanceof Error ? error.message : 'registered resolver failed',
      });
    }
  }

  return ensureBackendFileIdDirect(node, options);
}

export async function getBackendFileInfo(fileId: string, signal?: AbortSignal): Promise<FileInfo> {
  const cached = backendFileInfoCache.get(fileId);
  if (cached) {
    return cached;
  }

  const result = await httpClient.get<BackendFileAssetResponse>(`/api/v1/files/${fileId}`, undefined, {
    signal,
    timeout: 30000,
  });

  if (!result.success) {
    throw result.error;
  }

  const fileInfo = toFileInfo(result.data);
  backendFileInfoCache.set(fileId, fileInfo);
  return fileInfo;
}

export function clearBackendFileBindingCache(): void {
  localFileBindingCache.clear();
  sha256BindingCache.clear();
  backendFileInfoCache.clear();
}

export const backendFileService = {
  ensureBackendFileId,
  getBackendFileInfo,
  getFileBlobFromNode,
  getFileBlobFromNodeWithOptions,
  registerRuntimeNodeFileSource,
  restoreRuntimeNodeFileSourceFromHandle,
  hasRuntimeNodeFileSource,
  getRuntimeNodeFileSource,
  forceDeleteNodeResource,
  unregisterRuntimeNodeFileSource,
  syncRuntimeNodeFileSources,
  clearRuntimeNodeFileSources,
  registerBackendFile,
  registerBackendRawFile,
  registerBackendBlobFile,
  registerInpaintMaskFile,
  uploadBackendFile,
  resolveExistingBackendFileId,
  getCachedBackendFileBinding,
  cacheBackendFileBinding,
  getCachedBackendFileIdBySha256,
  cacheBackendFileIdBySha256,
  clearBackendFileBindingCache,
};
