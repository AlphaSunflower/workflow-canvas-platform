import type { ImageThumbnailFailureCode } from './image-thumbnail-diagnostics.types';

interface ImageThumbnailWorkerRequest {
  id: string;
  file: File;
  thumbnail: {
    maxWidth: number;
    maxHeight: number;
  };
}

interface ImageThumbnailWorkerSuccess {
  id: string;
  success: true;
  result: {
    metadata: {
      width: number;
      height: number;
    };
    thumbnailBlob: Blob;
    mimeType: string;
  };
}

interface ImageThumbnailWorkerFailure {
  id: string;
  success: false;
  errorCode: ImageThumbnailFailureCode;
  errorMessage: string;
}

declare const self: Worker;

const JPEG_QUALITY = 0.8;
const OUTPUT_MIME_TYPE = 'image/jpeg';

class ImageThumbnailWorkerTaskError extends Error {
  readonly errorCode: ImageThumbnailFailureCode;

  constructor(errorCode: ImageThumbnailFailureCode, message: string) {
    super(message);
    this.name = 'ImageThumbnailWorkerTaskError';
    this.errorCode = errorCode;
  }
}

self.onmessage = async (event: MessageEvent<ImageThumbnailWorkerRequest>): Promise<void> => {
  const request = event.data;

  try {
    const result = await createThumbnail(request);
    const response: ImageThumbnailWorkerSuccess = {
      id: request.id,
      success: true,
      result,
    };
    self.postMessage(response);
  } catch (error) {
    const failure = normalizeWorkerFailure(error);
    const response: ImageThumbnailWorkerFailure = {
      id: request.id,
      success: false,
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
    };
    self.postMessage(response);
  }
};

async function createThumbnail(
  request: ImageThumbnailWorkerRequest
): Promise<ImageThumbnailWorkerSuccess['result']> {
  if (typeof createImageBitmap !== 'function') {
    throw new ImageThumbnailWorkerTaskError('bitmap-unsupported', 'createImageBitmap is not supported');
  }

  if (typeof OffscreenCanvas === 'undefined') {
    throw new ImageThumbnailWorkerTaskError('offscreen-unsupported', 'OffscreenCanvas is not supported');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(request.file);
  } catch (error) {
    throw new ImageThumbnailWorkerTaskError(
      'decode-failed',
      error instanceof Error ? error.message : 'Failed to decode image for thumbnail generation',
    );
  }

  try {
    const metadata = {
      width: bitmap.width,
      height: bitmap.height,
    };
    const thumbnailSize = fitWithin(
      bitmap.width,
      bitmap.height,
      request.thumbnail.maxWidth,
      request.thumbnail.maxHeight,
    );
    const canvas = new OffscreenCanvas(thumbnailSize.width, thumbnailSize.height);
    const context = canvas.getContext('2d');

    if (!context) {
      throw new ImageThumbnailWorkerTaskError('canvas-context-failed', 'Failed to create offscreen canvas context');
    }

    context.drawImage(bitmap, 0, 0, thumbnailSize.width, thumbnailSize.height);
    let thumbnailBlob: Blob;
    try {
      thumbnailBlob = await canvas.convertToBlob({
        type: OUTPUT_MIME_TYPE,
        quality: JPEG_QUALITY,
      });
    } catch (error) {
      throw new ImageThumbnailWorkerTaskError(
        'blob-convert-failed',
        error instanceof Error ? error.message : 'Failed to convert thumbnail canvas to blob',
      );
    }

    return {
      metadata,
      thumbnailBlob,
      mimeType: thumbnailBlob.type || OUTPUT_MIME_TYPE,
    };
  } finally {
    bitmap.close();
  }
}

function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: maxWidth, height: maxHeight };
  }

  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function normalizeWorkerFailure(error: unknown): {
  errorCode: ImageThumbnailFailureCode;
  errorMessage: string;
} {
  if (error instanceof ImageThumbnailWorkerTaskError) {
    return {
      errorCode: error.errorCode,
      errorMessage: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      errorCode: 'unknown',
      errorMessage: error.message || 'Image thumbnail generation failed',
    };
  }

  return {
    errorCode: 'unknown',
    errorMessage: 'Image thumbnail generation failed',
  };
}

export {};
