import type { FileMetadata } from '@/types';
import type { ImageThumbnailFailureDetail } from './image-thumbnail-diagnostics.types';

export interface ImageFilePreprocessRequest {
  file: File;
  kind: 'image';
  thumbnail: {
    maxWidth: number;
    maxHeight: number;
  };
}

export interface VideoFilePreprocessRequest {
  file: File;
  kind: 'video';
  thumbnail: {
    maxWidth: number;
    maxHeight: number;
  };
}

export type FilePreprocessRequest = ImageFilePreprocessRequest | VideoFilePreprocessRequest;

export interface ImagePreprocessResult {
  kind: 'image';
  metadata?: Pick<FileMetadata, 'width' | 'height'>;
  thumbnailBlob?: Blob;
  thumbnailUrl?: string;
  thumbnailMimeType?: string;
  thumbnailFailure?: ImageThumbnailFailureDetail;
  processingMode: 'worker' | 'unavailable';
}

export interface VideoPreprocessResult {
  kind: 'video';
  metadata?: Pick<FileMetadata, 'width' | 'height' | 'duration'>;
  thumbnailUrl?: string;
  processingMode: 'worker' | 'main-thread';
}

export type FilePreprocessResult = ImagePreprocessResult | VideoPreprocessResult;
