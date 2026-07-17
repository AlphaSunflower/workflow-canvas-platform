export const THUMBNAIL_BASE_SIZE = 120;
export const THUMBNAIL_MIN_SIZE = 30;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;
export const ROTATION_SNAP = 15;
export const FILE_NODE_ACTION_LAYER_DELAY_MS = 32;
export const IMAGE_VIEWER_DEFAULT_ZOOM = 0.5;
export const IMAGE_VIEWER_MIN_ZOOM = 0.25;
export const IMAGE_VIEWER_MAX_ZOOM = 4;
export const IMAGE_VIEWER_ZOOM_STEP = 0.25;
export const IMAGE_VIEWER_WHEEL_STEP = 0.1;

export type ImageNodePreviewDisplay =
  | 'empty'
  | 'viewport-hidden'
  | 'loading'
  | 'unavailable'
  | 'ready';

export type ImageViewerDisplay =
  | 'loading'
  | 'error'
  | 'ready';

export function resolveImageNodePreviewDisplay(options: {
  previewState: {
    status?: 'processing' | 'ready' | 'error' | 'cleared' | null;
    hasRenderablePreview: boolean;
  };
  resourceState: {
    placeholder: 'hidden' | 'loading' | 'unavailable' | 'ready';
    hasImageSrc: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    preferStableLoading?: boolean;
  };
  businessState?: {
    isImportError?: boolean;
  };
}): ImageNodePreviewDisplay {
  if (options.businessState?.isImportError || options.previewState.status === 'error') {
    return 'unavailable';
  }

  if (options.resourceState.placeholder === 'hidden') {
    return 'viewport-hidden';
  }

  if (options.resourceState.hasImageSrc && options.resourceState.status !== 'error') {
    return 'ready';
  }

  if (
    options.previewState.status === 'processing' ||
    options.resourceState.placeholder === 'loading' ||
    options.resourceState.status === 'loading' ||
    (options.resourceState.preferStableLoading && options.previewState.hasRenderablePreview)
  ) {
    return 'loading';
  }

  if (options.resourceState.placeholder === 'unavailable' || options.resourceState.status === 'error') {
    return 'unavailable';
  }

  return 'empty';
}

export function resolveImageViewerDisplay(options: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  hasImageSrc: boolean;
}): ImageViewerDisplay {
  if (options.status === 'loading') {
    return 'loading';
  }

  if (options.status === 'error' || !options.hasImageSrc) {
    return 'error';
  }

  return 'ready';
}

export function resolveImageViewerStatusText(options: {
  status: 'idle' | 'loading' | 'ready' | 'error';
}): string | undefined {
  if (options.status === 'loading') {
    return 'Loading original';
  }

  if (options.status === 'error') {
    return 'Original unavailable';
  }

  if (options.status === 'ready') {
    return 'Original';
  }

  return undefined;
}

export function resolveImagePlaceholderLabel(kind: Exclude<ImageNodePreviewDisplay, 'ready' | 'empty'> | 'default'): string {
  if (kind === 'viewport-hidden') {
    return 'OFF';
  }

  if (kind === 'loading') {
    return '...';
  }

  if (kind === 'unavailable') {
    return '!';
  }

  return 'default';
}

export function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function formatFileNodeFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatFileNodeDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function shouldMountFileNodeActionLayer(options: {
  selected: boolean;
  isResizing: boolean;
  isRotating: boolean;
  isPreviewPlaying: boolean;
  isPreviewModalOpen: boolean;
  isImageViewerOpen: boolean;
}): boolean {
  return options.selected ||
    options.isResizing ||
    options.isRotating ||
    options.isPreviewPlaying ||
    options.isPreviewModalOpen ||
    options.isImageViewerOpen;
}
