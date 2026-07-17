export { imageManager } from './image-manager';
export { imageImportPreviewService } from './image-import-preview.service';
export { imageOriginalSourceRegistry } from './image-original-source-registry';
export { imageThumbnailRuntimeStore } from './image-thumbnail-runtime-store';
export { loadImageResource } from './image-loader';
export {
  applyImportedImageAssets,
  buildImportedImageAssets,
  buildRemoteImageAsset,
  clearAllImageResources,
  clearNodeImageResources,
  createLocalImageNodeDraft,
  registerLocalImageImportRuntime,
  getRenderableImageUrls,
  hasRestorableLocalFileSource,
  hasRenderableImagePreview,
  markImageNodeImportError,
  pauseImageVisibilityUpdates,
  reportNodeImageLoadFailure,
  resumeImageVisibilityUpdates,
  shouldUseRemoteFileResourceFallback,
  syncImageNodeIds,
  updateImageCacheBudgetContext,
  updateImageNodeVisibility,
} from './image-node';
export {
  createImageAssetVariant,
  createEmptyImageAsset,
  createLocalImageAsset,
  removeImageAssetVariant,
  resolveFileNodeImageAsset,
  selectCanvasImageVariant,
  upsertImageAsset,
  getFileNodeImageCanvasVariant,
  getFileNodeImagePrimaryUrl,
  getFileNodeImageThumbnailUrl,
  getFileNodeImageViewerUrl,
} from './image-asset';

export type { LoadedImageResource } from './image-loader';
export type {
  ImageCacheEntry,
  ImageCacheEviction,
  ImageCacheBudgetSnapshot,
  ImageCachePolicy,
  ImageCacheSnapshot,
  ImageCacheStats,
} from './image-cache';
export type {
  ImageCacheBudgetContext,
  ImageCacheBudgetDeviceSnapshot,
  ImageCacheBudgetProfile,
  ImageCacheBudgetResult,
  ImageCacheBudgetScene,
  ImageCacheBudgetDeviceTier,
} from './image-cache-budget';
export type {
  ImageResourcePhase,
  ImageResourceRequest,
  ImageResourceState,
  ImageResourceStatus,
  ResolvedFileNodeImageAsset,
  ResolvedImageVariant,
} from './image-resource.types';
export {
  isImageResourceDisplayReadyPhase,
  resolveImageResourcePhase,
} from './image-resource.types';
export {
  IMAGE_GRID_SPLIT_MAX_SIZE,
  IMAGE_GRID_SPLIT_MIN_SIZE,
  createImageGridSplitTileRects,
  splitImageIntoGrid,
  validateImageGridSplitGrid,
} from './image-grid-split';
export type {
  ImageGridSplitGrid,
  ImageGridSplitOptions,
  ImageGridSplitTile,
  ImageGridSplitTileRect,
} from './image-grid-split';
export type { ImageManagerDebugSnapshot } from './image-manager';
export type {
  ImageImportPreviewBeginOptions,
  ImageImportPreviewFailOptions,
  ImageImportPreviewResolveOptions,
  ImageImportPreviewSnapshot,
  ImageImportPreviewStatus,
} from './image-import-preview.types';
export type { ImageOriginalSourceEntry } from './image-original-source-registry';
export type {
  ImageThumbnailRuntimeEntry,
  ImageThumbnailRuntimeStatus,
} from './image-thumbnail-runtime-store';
export type { ImageThumbnailFailureDetail } from '@/services/file/image-thumbnail-diagnostics.types';

export { clearAllImageResources as resetImageRuntimeResources } from './image-node';
