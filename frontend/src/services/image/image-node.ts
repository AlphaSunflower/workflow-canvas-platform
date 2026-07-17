import type { FileMetadata, FileNodeData, ImageAsset } from '@/types';
import type { FilePreprocessResult } from '@/services/file/file-preprocess.types';
import {
  createEmptyImageAsset,
  createLocalImageAsset,
  getFileNodeImageThumbnailUrl,
} from './image-asset';
import { imageManager } from './image-manager';
import { imageImportPreviewService } from './image-import-preview.service';
import { imageOriginalSourceRegistry } from './image-original-source-registry';
import { imageThumbnailRuntimeStore } from './image-thumbnail-runtime-store';

export interface ImportedImageAssets {
  imageAsset?: ImageAsset;
  metadata?: Pick<FileMetadata, 'width' | 'height'>;
  thumbnailUrl?: string;
  thumbnailReady?: boolean;
  thumbnailUnavailable?: boolean;
  needsNodePatch?: boolean;
}

export interface LocalImageDraftResult {
  imageAsset?: ImageAsset;
}

export interface RemoteImageAssetOptions {
  thumbnailUrl?: string;
  originalUrl?: string;
  thumbnailSize?: Pick<FileMetadata, 'width' | 'height'>;
  updatedAt?: number;
  includeOriginal?: boolean;
  version?: number;
  getUrl?: (fileId: string, type: 'thumbnail' | 'download') => string;
}

export interface ClearAllImageResourcesOptions {
  workflowId?: string | null;
  clearOriginals?: boolean;
  forceOriginals?: boolean;
}

export function hasRestorableLocalFileSource(
  node: Pick<FileNodeData, 'source'>,
): boolean {
  const source = node.source;
  const referenceId = source.localSource?.referenceId;

  return (
    source.type === 'imported' &&
    (
      source.localSource?.status === 'available' ||
      source.localSource?.status === 'linked'
    ) &&
    typeof referenceId === 'string' &&
    referenceId.trim().length > 0
  );
}

export function shouldUseRemoteFileResourceFallback(
  node: Pick<FileNodeData, 'source' | 'type'>,
): boolean {
  if (node.type !== 'image') {
    return true;
  }

  return !hasRestorableLocalFileSource(node);
}

export function buildRemoteImageAsset(
  fileId: string,
  metadata: FileMetadata = {},
  options: RemoteImageAssetOptions = {}
): {
  imageAsset: ImageAsset;
  thumbnailUrl: string;
} {
  const getUrl = options?.getUrl ?? ((targetFileId, type): string => {
    const baseUrl = '/api/v1/files';
    switch (type) {
      case 'thumbnail':
        return `${baseUrl}/${targetFileId}/thumbnail`;
      case 'download':
        return `${baseUrl}/${targetFileId}/download`;
    }
  });
  const includeOriginal = options?.includeOriginal ?? true;
  const thumbnailUrl = options.thumbnailUrl ?? getUrl(fileId, 'thumbnail');
  const originalUrl = options.originalUrl ?? getUrl(fileId, 'download');
  const thumbnailWidth = options.thumbnailSize?.width;
  const thumbnailHeight = options.thumbnailSize?.height;
  const variantUpdatedAt = options.updatedAt;

  return {
    imageAsset: {
      assetId: fileId,
      source: 'remote',
      variants: {
        thumbnail: {
          url: thumbnailUrl,
          ...(typeof thumbnailWidth === 'number' ? { width: thumbnailWidth } : {}),
          ...(typeof thumbnailHeight === 'number' ? { height: thumbnailHeight } : {}),
          ...(typeof variantUpdatedAt === 'number' ? { updatedAt: variantUpdatedAt } : {}),
        },
        ...(includeOriginal
          ? {
            original: {
              url: originalUrl,
              width: metadata.width,
              height: metadata.height,
              ...(typeof variantUpdatedAt === 'number' ? { updatedAt: variantUpdatedAt } : {}),
            },
          }
          : {}),
      },
      intrinsicSize: (
        typeof metadata.width === 'number' &&
        metadata.width > 0 &&
        typeof metadata.height === 'number' &&
        metadata.height > 0
      )
        ? {
          width: metadata.width,
          height: metadata.height,
        }
        : undefined,
      version: options?.version ?? 1,
    },
    thumbnailUrl,
  };
}

export function registerLocalImageImportRuntime(
  nodeId: string,
  file: File,
  options: {
    sessionId?: string;
    fileId: string;
    workflowId?: string | null;
  },
): void {
  imageImportPreviewService.begin(nodeId, {
    sessionId: options.sessionId,
    fileId: options.fileId,
    file,
    workflowId: options.workflowId,
  });
}

export function createLocalImageNodeDraft(
  nodeId: string,
  file: File,
  fileNode: FileNodeData,
  options: {
    sessionId?: string;
    fileId?: string;
    workflowId?: string | null;
  } = {}
): LocalImageDraftResult {
  const fileId = options.fileId ?? fileNode.fileId;
  registerLocalImageImportRuntime(nodeId, file, {
    sessionId: options.sessionId,
    fileId,
    workflowId: options.workflowId,
  });

  return {
    imageAsset: fileNode.type === 'image'
      ? createEmptyImageAsset(fileId, {
        width: fileNode.metadata.width,
        height: fileNode.metadata.height,
      }, 'local')
      : fileNode.imageAsset,
  };
}

export function applyImportedImageAssets(
  fileNode: FileNodeData,
  nodeType: 'image' | 'video',
  imageAssets: ImportedImageAssets
): FileNodeData {
  if (nodeType !== 'image' || fileNode.type !== 'image') {
    return {
      ...fileNode,
      thumbnailUrl: imageAssets.thumbnailUrl ?? fileNode.thumbnailUrl,
      status: 'idle',
      timestamp: {
        ...fileNode.timestamp,
        updated: Date.now(),
      },
    };
  }

  return {
    ...fileNode,
    imageAsset: createLocalImageAsset(
      fileNode.fileId,
      {
        width: imageAssets.metadata?.width ?? fileNode.metadata.width,
        height: imageAssets.metadata?.height ?? fileNode.metadata.height,
      },
      imageAssets.imageAsset?.variants,
      {
        previous: fileNode.imageAsset,
      }
    ),
    thumbnailUrl: imageAssets.thumbnailUrl ?? fileNode.thumbnailUrl,
    metadata: {
      ...fileNode.metadata,
      ...(typeof imageAssets.metadata?.width === 'number' ? { width: imageAssets.metadata.width } : {}),
      ...(typeof imageAssets.metadata?.height === 'number' ? { height: imageAssets.metadata.height } : {}),
    },
    status: 'idle',
    timestamp: {
      ...fileNode.timestamp,
      updated: Date.now(),
    },
  };
}

export function buildImportedImageAssets(
  nodeId: string,
  result: FilePreprocessResult | undefined,
  fallbackMetadata: Pick<FileMetadata, 'width' | 'height' | 'duration'> = {},
  options: {
    fileId?: string;
  } = {}
): ImportedImageAssets {
  if (!result) {
    return {
      metadata: fallbackMetadata,
      thumbnailReady: false,
      thumbnailUnavailable: true,
      needsNodePatch: false,
    };
  }

  const resolvedMetadata = {
    ...fallbackMetadata,
    ...result.metadata,
  };

  if (result.kind === 'image') {
    const assetFileId = options.fileId ?? nodeId;
    const thumbnailReady = Boolean(result.thumbnailBlob && result.thumbnailUrl);

    return {
      imageAsset: createLocalImageAsset(assetFileId, resolvedMetadata, {}),
      metadata: resolvedMetadata,
      thumbnailUrl: undefined,
      thumbnailReady,
      thumbnailUnavailable: !thumbnailReady,
      needsNodePatch: false,
    };
  }

  return {
    metadata: resolvedMetadata,
    thumbnailUrl: result.thumbnailUrl,
    thumbnailReady: Boolean(result.thumbnailUrl),
    thumbnailUnavailable: !result.thumbnailUrl,
    needsNodePatch: true,
  };
}

export function removeLocalImageOriginal(fileNode: FileNodeData): FileNodeData {
  if (fileNode.type !== 'image') {
    return {
      ...fileNode,
      thumbnailUrl: undefined,
      status: 'error',
      timestamp: {
        ...fileNode.timestamp,
        updated: Date.now(),
      },
    };
  }

  return {
    ...fileNode,
    imageAsset: createLocalImageAsset(
      fileNode.fileId,
      {
        width: fileNode.metadata.width,
        height: fileNode.metadata.height,
      },
      {
        ...fileNode.imageAsset?.variants,
        original: undefined,
      },
      {
        previous: fileNode.imageAsset,
      }
    ),
    thumbnailUrl: undefined,
    status: 'error',
    timestamp: {
      ...fileNode.timestamp,
      updated: Date.now(),
    },
  };
}

export function markImageNodeImportError(fileNode: FileNodeData): FileNodeData {
  return {
    ...removeLocalImageOriginal(fileNode),
    status: 'error',
    timestamp: {
      ...fileNode.timestamp,
      updated: Date.now(),
    },
  };
}

export function getRenderableImageUrls(node: Pick<FileNodeData, 'type' | 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'previewUrl' | 'metadata'>): {
  thumbnailUrl?: string;
} {
  if (node.type !== 'image') {
    return {
      thumbnailUrl: node.thumbnailUrl,
    };
  }

  return {
    thumbnailUrl: getFileNodeImageThumbnailUrl(node),
  };
}

export function hasRenderableImagePreview(
  node: Pick<FileNodeData, 'type' | 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'previewUrl' | 'metadata'>
): boolean {
  if (node.type === 'image') {
    const urls = getRenderableImageUrls(node);
    return Boolean(urls.thumbnailUrl);
  }

  return Boolean(node.thumbnailUrl || node.previewUrl);
}

export function reportNodeImageLoadFailure(
  nodeId: string,
  fileName: string,
  mode: 'canvas' | 'original',
  options: {
    startedAt?: number;
    requestKey?: string;
    attemptedUrl?: string;
    reason?: string;
  } = {}
): void {
  imageManager.reportLoadFailure(
    nodeId,
    mode === 'original'
      ? `Failed to load viewer image: ${fileName}`
      : `Failed to load image: ${fileName}`,
    options.startedAt ?? Date.now(),
    mode,
    {
      requestKey: options.requestKey,
      attemptedUrl: options.attemptedUrl,
      reason: options.reason,
    }
  );
}

export function clearNodeImageResources(nodeId: string): void {
  imageImportPreviewService.clear(nodeId);
  imageThumbnailRuntimeStore.clearNode(nodeId);
  imageManager.clear(nodeId);
}

export function syncImageNodeIds(activeNodeIds: Iterable<string>): void {
  imageManager.syncNodeIds(activeNodeIds);
}

export function clearAllImageResources(options: ClearAllImageResourcesOptions = {}): void {
  imageImportPreviewService.clearAll();
  imageManager.clearAll();
  if (options.clearOriginals === false) {
    return;
  }

  if (options.workflowId !== undefined) {
    if (options.forceOriginals) {
      imageOriginalSourceRegistry.clear({
        workflowId: options.workflowId,
        force: true,
        preserveLeased: false,
      });
      return;
    }
    imageOriginalSourceRegistry.clearWorkflowUnleased(options.workflowId);
    return;
  }

  if (options.forceOriginals) {
    imageOriginalSourceRegistry.clear({
      force: true,
      preserveLeased: false,
    });
    return;
  }

  imageOriginalSourceRegistry.clearUnleased();
}

export function updateImageCacheBudgetContext(context: {
  imageNodeCount: number;
  importingNodeCount?: number;
  isImporting?: boolean;
  isDragging?: boolean;
  isIdle?: boolean;
  device?: {
    deviceMemoryGb?: number;
    hardwareConcurrency?: number;
    jsHeapSizeLimit?: number;
    totalJSHeapSize?: number;
  };
}): void {
  imageManager.updateCacheBudgetContext(context);
}

export function updateImageNodeVisibility(nodeId: string, visibility: {
  isVisible: boolean;
  isNearViewport: boolean;
  displayWidth: number;
  displayHeight: number;
  centerDistance?: number;
  isSelected?: boolean;
  isRecentlyInteracted?: boolean;
}): void {
  imageManager.updateVisibility(nodeId, visibility);
}

export function pauseImageVisibilityUpdates(): void {
  imageManager.pauseCanvasVisibilityUpdates();
}

export function resumeImageVisibilityUpdates(options: { flush?: boolean } = {}): void {
  imageManager.resumeCanvasVisibilityUpdates(options);
}
