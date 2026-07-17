import type {
  FileNodeData,
  LocalWorkflowArchive,
  LocalWorkflowEmbeddedAsset,
  Result,
  Workflow,
} from '@/types';
import { fileService } from '@/services/file/file-service';
import {
  buildImportedImageAssets,
  createEmptyImageAsset,
  imageOriginalSourceRegistry,
  imageImportPreviewService,
  registerLocalImageImportRuntime,
} from '@/services/image';
import { createError, createModuleLogger, isFileNodeData } from '@/utils';

const log = createModuleLogger('local-workflow-assets');
const LOCAL_ARCHIVE_SOURCE_BOUNDARY = 'runtime-only-archive';

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isPathLikeOriginalPath(value: string): boolean {
  return (
    value.startsWith('file:') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.startsWith('~/') ||
    value.startsWith('~\\') ||
    /^[A-Za-z]:/.test(value) ||
    value.includes('/') ||
    value.includes('\\')
  );
}

function getDisplayNameFromOriginalPath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith('file:')) {
    try {
      const fileUrl = new URL(value);
      const pathname = decodeURIComponent(fileUrl.pathname);
      const urlBasename = pathname.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
      return getNonEmptyString(urlBasename) ?? value;
    } catch {
      return value;
    }
  }

  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return getNonEmptyString(normalized.split('/').pop()) ?? value;
}

interface RegisteredLocalFileResource {
  workflowId?: string | null;
  nodeId: string;
  fileId: string;
  file: File;
  registeredAt: number;
}

interface LocalArchiveFileRegistryOptions {
  workflowId?: string | null;
}

const localFileRegistry = new Map<string, RegisteredLocalFileResource>();
const latestLocalFileRegistryKeys = new Map<string, string>();

function createAssetError(
  message: string,
  operation: string,
  context?: Record<string, unknown>,
): ReturnType<typeof createError> {
  return createError('STORAGE_ERROR', message, {
    module: 'local-workflow-assets',
    operation,
    timestamp: Date.now(),
    context,
  });
}

function normalizeWorkflowId(workflowId: string | null | undefined): string | null {
  const normalized = workflowId?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function createLegacyRegistryKey(nodeId: string, fileId: string): string {
  return `${nodeId}:${fileId}`;
}

function createRegistryKey(
  nodeId: string,
  fileId: string,
  options: LocalArchiveFileRegistryOptions = {},
): string {
  return [
    normalizeWorkflowId(options.workflowId) ?? '*',
    nodeId,
    fileId,
  ].map((part) => encodeURIComponent(part)).join('|');
}

function getAssetKind(node: FileNodeData): LocalWorkflowEmbeddedAsset['kind'] {
  switch (node.type) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'ply':
      return 'ply';
    default:
      return 'unknown';
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToBlob(data: string, mimeType = 'application/octet-stream'): Blob {
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function sanitizeArchiveSourceMetadata(node: FileNodeData): Record<string, unknown> {
  if (node.source.type !== 'imported') {
    return node.source as unknown as Record<string, unknown>;
  }

  const originalPath = getNonEmptyString(node.source.originalPath);
  const legacyOriginalPath = originalPath && isPathLikeOriginalPath(originalPath)
    ? originalPath
    : undefined;
  const sourceDisplayName = getNonEmptyString(node.source.sourceDisplayName)
    ?? getDisplayNameFromOriginalPath(originalPath)
    ?? node.fileName;
  const localSource = node.source.localSource;

  return {
    type: 'imported',
    importMethod: 'local',
    ...(sourceDisplayName ? { sourceDisplayName } : {}),
    ...(legacyOriginalPath ? { originalPath: legacyOriginalPath } : {}),
    ...(typeof node.source.importedAt === 'number' ? { importedAt: node.source.importedAt } : {}),
    ...(node.source.uploadedBy ? { uploadedBy: node.source.uploadedBy } : {}),
    ...(localSource
      ? {
          localSource: {
            status: localSource.status === 'available' ? 'linked' : localSource.status,
            ...(localSource.referenceId ? { referenceId: localSource.referenceId } : {}),
            ...(localSource.kind ? { kind: localSource.kind } : {}),
            ...(localSource.permissionState ? { permissionState: localSource.permissionState } : {}),
          },
        }
      : {}),
  };
}

function createArchiveRuntimeFileSource(node: FileNodeData): FileNodeData['source'] {
  if (node.source.type !== 'imported') {
    return node.source;
  }

  const originalPath = getNonEmptyString(node.source.originalPath);
  const legacyOriginalPath = originalPath && isPathLikeOriginalPath(originalPath)
    ? originalPath
    : undefined;

  return {
    type: 'imported',
    importMethod: 'local',
    sourceDisplayName: getNonEmptyString(node.source.sourceDisplayName)
      ?? getDisplayNameFromOriginalPath(originalPath)
      ?? node.fileName,
    ...(legacyOriginalPath ? { originalPath: legacyOriginalPath } : {}),
    importedAt: node.source.importedAt ?? node.timestamp.created,
    ...(node.source.uploadedBy ? { uploadedBy: node.source.uploadedBy } : {}),
    localSource: {
      status: 'runtime-only',
      kind: 'runtime',
    },
  };
}

function stripRuntimeFileNodeResources(node: FileNodeData): FileNodeData {
  if (node.type === 'image') {
    return {
      ...node,
      imageAsset: createEmptyImageAsset(node.fileId, node.metadata, 'local'),
      thumbnailUrl: undefined,
      previewUrl: undefined,
      status: 'idle',
    };
  }

  return {
    ...node,
    thumbnailUrl: undefined,
    previewUrl: undefined,
    status: 'idle',
  };
}

async function restoreImageThumbnailRuntime(node: FileNodeData, file: File): Promise<void> {
  const preprocessResult = await fileService.preprocessImportFile({
    file,
    kind: 'image',
    thumbnail: {
      maxWidth: 512,
      maxHeight: 512,
    },
  }).catch((error) => {
    log.warn(
      'restoreImageThumbnailRuntime',
      `Failed to restore image thumbnail runtime: ${file.name}`,
      error instanceof Error ? { errorMessage: error.message } : undefined,
    );
    return undefined;
  });

  const restoredImageAssets = buildImportedImageAssets(node.id.value, preprocessResult, node.metadata, {
    fileId: node.fileId,
  });
  const sessionId = `local-archive:${node.id.value}:${node.fileId}`;

  if (preprocessResult?.kind === 'image' && preprocessResult.thumbnailBlob && preprocessResult.thumbnailUrl) {
    imageImportPreviewService.resolve(node.id.value, {
      sessionId,
      fileId: node.fileId,
      blob: preprocessResult.thumbnailBlob,
      objectUrl: preprocessResult.thumbnailUrl,
      width: restoredImageAssets.metadata?.width,
      height: restoredImageAssets.metadata?.height,
      mimeType: preprocessResult.thumbnailMimeType,
    });
    return;
  }

  imageImportPreviewService.fail(node.id.value, {
    sessionId,
    fileId: node.fileId,
    fileName: file.name,
    fileSize: file.size,
    source: 'local-archive-restore',
    error: 'thumbnail-unavailable',
    failureCode: preprocessResult?.kind === 'image' ? preprocessResult.thumbnailFailure?.failureCode : undefined,
    message: preprocessResult?.kind === 'image' ? preprocessResult.thumbnailFailure?.message : undefined,
    retryable: preprocessResult?.kind === 'image' ? preprocessResult.thumbnailFailure?.retryable : undefined,
    detail: preprocessResult?.kind === 'image' ? preprocessResult.thumbnailFailure : undefined,
  });
}

export function getRegisteredLocalArchiveResource(
  nodeId: string,
  fileId: string,
  options: LocalArchiveFileRegistryOptions = {},
): Readonly<RegisteredLocalFileResource> | null {
  if (options.workflowId !== undefined) {
    return localFileRegistry.get(createRegistryKey(nodeId, fileId, options)) ?? null;
  }

  const latestKey = latestLocalFileRegistryKeys.get(createLegacyRegistryKey(nodeId, fileId));
  return latestKey ? localFileRegistry.get(latestKey) ?? null : null;
}

export function getRegisteredLocalArchiveFile(
  nodeId: string,
  fileId: string,
  options: LocalArchiveFileRegistryOptions = {},
): File | null {
  return getRegisteredLocalArchiveResource(nodeId, fileId, options)?.file ?? null;
}

export function getRegisteredLocalArchiveFileByNode(
  node: Pick<FileNodeData, 'id' | 'fileId'>,
  options: LocalArchiveFileRegistryOptions = {},
): File | null {
  return getRegisteredLocalArchiveFile(node.id.value, node.fileId, options);
}

export function registerLocalArchiveFile(
  nodeId: string,
  fileId: string,
  file: File,
  options: LocalArchiveFileRegistryOptions = {},
): void {
  const workflowId = normalizeWorkflowId(options.workflowId);
  const key = createRegistryKey(nodeId, fileId, { workflowId });
  localFileRegistry.set(key, {
    workflowId,
    nodeId,
    fileId,
    file,
    registeredAt: Date.now(),
  });
  latestLocalFileRegistryKeys.set(createLegacyRegistryKey(nodeId, fileId), key);
}

export function unregisterLocalArchiveFile(
  nodeId: string,
  fileId: string,
  options: LocalArchiveFileRegistryOptions = {},
): void {
  const keys = options.workflowId !== undefined
    ? [createRegistryKey(nodeId, fileId, options)]
    : Array.from(localFileRegistry.entries())
      .filter(([, resource]) => resource.nodeId === nodeId && resource.fileId === fileId)
      .map(([key]) => key);

  keys.forEach((key) => {
    localFileRegistry.delete(key);
  });
  refreshLatestLocalArchiveKey(nodeId, fileId);
}

export function clearLocalArchiveFileRegistry(options: LocalArchiveFileRegistryOptions = {}): void {
  if (options.workflowId === undefined) {
    localFileRegistry.clear();
    latestLocalFileRegistryKeys.clear();
    return;
  }

  const workflowId = normalizeWorkflowId(options.workflowId);
  Array.from(localFileRegistry.entries()).forEach(([key, resource]) => {
    if (resource.workflowId === workflowId) {
      localFileRegistry.delete(key);
      refreshLatestLocalArchiveKey(resource.nodeId, resource.fileId);
    }
  });
}

function refreshLatestLocalArchiveKey(nodeId: string, fileId: string): void {
  const legacyKey = createLegacyRegistryKey(nodeId, fileId);
  const replacement = Array.from(localFileRegistry.entries())
    .reverse()
    .find(([, resource]) => resource.nodeId === nodeId && resource.fileId === fileId);

  if (replacement) {
    latestLocalFileRegistryKeys.set(legacyKey, replacement[0]);
    return;
  }

  latestLocalFileRegistryKeys.delete(legacyKey);
}

export async function collectEmbeddedLocalArchiveAssets(
  workflow: Workflow,
): Promise<Result<LocalWorkflowEmbeddedAsset[]>> {
  const fileNodes = Object.values(workflow.nodes).filter((node): node is FileNodeData => isFileNodeData(node));
  const embeddedAssets: LocalWorkflowEmbeddedAsset[] = [];

  try {
    for (const node of fileNodes) {
      const registered = getRegisteredLocalArchiveResource(node.id.value, node.fileId, {
        workflowId: workflow.id,
      }) ?? getRegisteredLocalArchiveResource(node.id.value, node.fileId);
      if (!registered) {
        continue;
      }

      const data = arrayBufferToBase64(await registered.file.arrayBuffer());
      embeddedAssets.push({
        id: `${node.id.value}:${node.fileId}`,
        nodeId: node.id.value,
        fileId: node.fileId,
        kind: getAssetKind(node),
        fileName: node.fileName,
        mimeType: registered.file.type || node.mimeType || 'application/octet-stream',
        size: registered.file.size || node.fileSize,
        encoding: 'base64',
        data,
        width: node.metadata.width,
        height: node.metadata.height,
        duration: node.metadata.duration,
        metadata: {
          source: sanitizeArchiveSourceMetadata(node),
          localSourceBoundary: LOCAL_ARCHIVE_SOURCE_BOUNDARY,
          localSourceScope: 'archive-import-runtime',
        },
        createdAt: node.timestamp.created,
        updatedAt: node.timestamp.updated,
      });
    }

    return {
      success: true,
      data: embeddedAssets,
    };
  } catch (error) {
    log.error('collectEmbeddedLocalArchiveAssets', 'Failed to collect embedded assets', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: createAssetError(
        'Failed to collect local workflow assets.',
        'collectEmbeddedLocalArchiveAssets',
      ),
    };
  }
}

export async function restoreEmbeddedLocalArchiveAssets(
  archive: LocalWorkflowArchive,
): Promise<Result<Workflow>> {
  const nextWorkflow: Workflow = {
    ...archive.workflow,
    nodes: { ...archive.workflow.nodes },
  };

  try {
    archive.embeddedAssets.forEach((asset) => {
      const targetNode = nextWorkflow.nodes[asset.nodeId];
      if (!targetNode || !isFileNodeData(targetNode)) {
        return;
      }

      const blob = base64ToBlob(asset.data, asset.mimeType);
      const file = new File([blob], asset.fileName, {
        type: asset.mimeType,
        lastModified: asset.updatedAt,
      });
      registerLocalArchiveFile(targetNode.id.value, targetNode.fileId, file, {
        workflowId: nextWorkflow.id,
      });

      if (targetNode.type === 'image') {
        registerLocalImageImportRuntime(targetNode.id.value, file, {
          fileId: targetNode.fileId,
          sessionId: `local-archive:${targetNode.id.value}:${targetNode.fileId}`,
          workflowId: nextWorkflow.id,
        });
      } else {
        imageOriginalSourceRegistry.registerLocalFile(targetNode.id.value, targetNode.fileId, file, {
          workflowId: nextWorkflow.id,
        });
      }

      const baseNode: FileNodeData = {
        ...targetNode,
        fileName: asset.fileName,
        fileSize: asset.size,
        mimeType: asset.mimeType,
        source: createArchiveRuntimeFileSource({
          ...targetNode,
          fileName: asset.fileName,
        }),
        metadata: {
          ...targetNode.metadata,
          ...(typeof asset.width === 'number' ? { width: asset.width } : {}),
          ...(typeof asset.height === 'number' ? { height: asset.height } : {}),
          ...(typeof asset.duration === 'number' ? { duration: asset.duration } : {}),
        },
      };

      nextWorkflow.nodes[asset.nodeId] = stripRuntimeFileNodeResources(baseNode);
    });

    await Promise.all(
      Object.values(nextWorkflow.nodes)
        .filter((node): node is FileNodeData => isFileNodeData(node) && node.type === 'image')
        .map((node) => {
          const file = getRegisteredLocalArchiveFileByNode(node, {
            workflowId: nextWorkflow.id,
          });
          return file ? restoreImageThumbnailRuntime(node, file) : Promise.resolve();
        }),
    );

    return {
      success: true,
      data: nextWorkflow,
    };
  } catch (error) {
    log.error('restoreEmbeddedLocalArchiveAssets', 'Failed to restore embedded assets', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: createAssetError(
        'Failed to restore local workflow assets.',
        'restoreEmbeddedLocalArchiveAssets',
      ),
    };
  }
}
