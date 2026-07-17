import type { BatchImportConfig, FilePreviewSize } from '@/types/file.types';

export const SUPPORTED_FORMATS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
  video: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
  model3d: ['ply'],
} as const;

export const FILE_TYPE_MAP = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video', avi: 'video', mkv: 'video',
  ply: 'model3d',
} as const;

export const BATCH_IMPORT_DEFAULTS: BatchImportConfig = {
  maxFiles: 100,
  maxFileSize: 500 * 1024 * 1024,
  layoutStrategy: 'smart',
  spacing: 20,
} as const;

export const PREVIEW_SIZE_1080P: FilePreviewSize = {
  width: 120,
  height: 68,
  scale: 1,
} as const;

export const MIN_NODE_SIZE = 30 as const;
export const MAX_FILE_REFERENCES = 5 as const;
export const MAX_GROUP_FILES = 5 as const;

export function calculatePreviewSize(
  originalWidth: number,
  originalHeight: number,
  baseWidth = 120
): FilePreviewSize {
  const aspectRatio = originalWidth / originalHeight;
  const baseHeight = baseWidth / aspectRatio;
  const scale = baseWidth / 1920;
  return { width: baseWidth, height: Math.round(baseHeight), scale };
}
