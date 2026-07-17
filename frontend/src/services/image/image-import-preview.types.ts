import type { ImageThumbnailRuntimeEntry } from './image-thumbnail-runtime-store';
import type { ImageThumbnailFailureDetail } from '@/services/file/image-thumbnail-diagnostics.types';

export type ImageImportPreviewStatus = 'processing' | 'ready' | 'error' | 'cleared';
export type ImageImportPreviewListener = () => void;
export type ImageImportPreviewProcessingNodeIds = readonly string[];

export interface ImageImportPreviewBeginOptions {
  sessionId?: string;
  fileId: string;
  file?: File;
  workflowId?: string | null;
}

export interface ImageImportPreviewResolveOptions {
  sessionId?: string;
  fileId?: string;
  blob?: Blob;
  objectUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface ImageImportPreviewFailOptions {
  sessionId?: string;
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  source?: string;
  error: string;
  failureCode?: ImageThumbnailFailureDetail['failureCode'];
  message?: string;
  retryable?: boolean;
  detail?: ImageThumbnailFailureDetail;
  attemptCount?: number;
}

export interface ImageImportPreviewSnapshot {
  nodeId: string;
  sessionId?: string;
  fileId?: string;
  status: ImageImportPreviewStatus;
  runtimeEntry: Readonly<ImageThumbnailRuntimeEntry> | null;
}
