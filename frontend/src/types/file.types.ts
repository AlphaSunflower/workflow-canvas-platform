import type { FileStatus, Timestamp, UUID } from './base.types';

export type SupportedImageFormat = 'jpg' | 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'svg';
export type SupportedVideoFormat = 'mp4' | 'webm' | 'mov' | 'avi' | 'mkv';
export type SupportedModelFormat = 'ply';
export type SupportedFormat = SupportedImageFormat | SupportedVideoFormat | SupportedModelFormat;

export interface FileMetadata {
  width?: number;
  height?: number;
  duration?: number;
  frameRate?: number;
  codec?: string;
  bitrate?: number;
  frameCount?: number;
  colorSpace?: string;
  hasAlpha?: boolean;
}

export type LocalFileSourceStatus =
  | 'runtime-only'
  | 'available'
  | 'linked'
  | 'permission-required'
  | 'missing'
  | 'unknown';

export type LocalFileSourceKind = 'runtime' | 'file-system-access' | 'unknown';

export interface LocalFileSourceReference {
  status: LocalFileSourceStatus;
  referenceId?: string;
  kind?: LocalFileSourceKind;
  permissionState?: PermissionState;
  lastResolvedAt?: number;
}

export interface FileSource {
  type: 'imported' | 'node-output';
  importMethod?: 'local';
  sourceDisplayName?: string;
  localSource?: LocalFileSourceReference;
  // Legacy compatibility only. Older workflows may still contain a path-like string here.
  originalPath?: string;
  importedAt?: number;
  uploadedBy?: UUID;
  producerNodeId?: string;
  producerNodeDisplayId?: string;
  producerNodeType?: string;
  taskId?: string;
  taskNo?: string;
  taskCreatedAt?: number;
  taskStartedAt?: number;
  taskCompletedAt?: number;
}

export interface FileInfo {
  id: UUID;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  format: SupportedFormat;
  fileType: 'image' | 'video' | 'model3d';
  status: FileStatus;
  hash: string;
  path: string;
  thumbnailPath?: string;
  previewPath?: string;
  metadata: FileMetadata;
  source: FileSource;
  timestamp: Timestamp;
}

export interface FileUploadProgress {
  fileId: string;
  fileName: string;
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  speed: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
}

export interface FileValidation {
  isValid: boolean;
  errors: FileValidationError[];
}

export interface FileValidationError {
  fileName: string;
  code: string;
  message: string;
}

export interface FileImportResult {
  success: boolean;
  files: FileInfo[];
  errors: FileValidationError[];
  duplicates: string[];
}

export interface ChunkUpload {
  fileId: string;
  uploadId: string;
  totalChunks: number;
  uploadedChunks: number[];
  chunkSize: number;
  totalSize: number;
}

export interface ChunkUploadInit {
  fileName: string;
  fileSize: number;
  mimeType: string;
  hash: string;
}

export interface ChunkUploadProgress {
  chunkIndex: number;
  uploaded: number;
  total: number;
}

export interface BatchImportConfig {
  maxFiles: number;
  maxFileSize: number;
  layoutStrategy: 'grid' | 'smart' | 'list';
  spacing: number;
}

export interface FileFilter {
  types?: Array<'image' | 'video' | 'model3d'>;
  formats?: SupportedFormat[];
  maxSize?: number;
  search?: string;
}

export interface FileSort {
  field: 'name' | 'size' | 'createdAt' | 'updatedAt';
  order: 'asc' | 'desc';
}

export interface FilePreviewSize {
  width: number;
  height: number;
  scale: number;
}
