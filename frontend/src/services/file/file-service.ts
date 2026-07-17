import type {
  FileSource,
  LocalFileSourceReference,
  LocalFileSourceStatus,
} from '@/types/file.types';
import type { ImageThumbnailFailureDetail } from './image-thumbnail-diagnostics.types';
import {
  enqueueImageThumbnailTask,
  getImageThumbnailWorkerPipelineCapabilities,
  isImageThumbnailWorkerPipelineError,
} from './image-thumbnail-worker-pipeline';
import { probeImageMetadata, probeVideoMetadata } from './image-metadata-probe';
import type {
  FilePreprocessRequest,
  FilePreprocessResult,
  ImagePreprocessResult,
  VideoPreprocessResult,
} from './file-preprocess.types';

function getFileTypeFromName(fileName: string): 'image' | 'video' | 'model3d' | null {
  const extension = fileName.includes('.')
    ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
    : '';

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) {
    return 'image';
  }

  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(extension)) {
    return 'video';
  }

  if (extension === 'ply') {
    return 'model3d';
  }

  return null;
}

export function createLocalImportFileSource(
  options: {
    sourceDisplayName?: string;
    localSource?: Partial<LocalFileSourceReference>;
    originalPath?: string;
    importedAt?: number;
  } = {}
): FileSource {
  const sourceDisplayName = typeof options.sourceDisplayName === 'string' && options.sourceDisplayName.trim().length > 0
    ? options.sourceDisplayName.trim()
    : undefined;
  const legacyOriginalPath = typeof options.originalPath === 'string' && options.originalPath.trim().length > 0
    ? options.originalPath.trim()
    : undefined;
  const localSourceStatus = (
    options.localSource?.status === 'runtime-only' ||
    options.localSource?.status === 'available' ||
    options.localSource?.status === 'linked' ||
    options.localSource?.status === 'permission-required' ||
    options.localSource?.status === 'missing' ||
    options.localSource?.status === 'unknown'
  )
    ? options.localSource.status
    : 'runtime-only';
  const localSourceReferenceId = typeof options.localSource?.referenceId === 'string' && options.localSource.referenceId.trim().length > 0
    ? options.localSource.referenceId.trim()
    : undefined;
  const localSourceKind = (
    options.localSource?.kind === 'runtime' ||
    options.localSource?.kind === 'file-system-access' ||
    options.localSource?.kind === 'unknown'
  )
    ? options.localSource.kind
    : undefined;
  const localSourcePermissionState = (
    options.localSource?.permissionState === 'granted' ||
    options.localSource?.permissionState === 'prompt' ||
    options.localSource?.permissionState === 'denied'
  )
    ? options.localSource.permissionState
    : undefined;
  const localSourceLastResolvedAt = typeof options.localSource?.lastResolvedAt === 'number' && Number.isFinite(options.localSource.lastResolvedAt)
    ? options.localSource.lastResolvedAt
    : undefined;
  const localSource: LocalFileSourceReference = {
    status: localSourceStatus as LocalFileSourceStatus,
    ...(localSourceReferenceId ? { referenceId: localSourceReferenceId } : {}),
    ...(localSourceKind ? { kind: localSourceKind } : {}),
    ...(localSourcePermissionState ? { permissionState: localSourcePermissionState } : {}),
    ...(localSourceLastResolvedAt ? { lastResolvedAt: localSourceLastResolvedAt } : {}),
  };

  return {
    type: 'imported',
    importMethod: 'local',
    ...(sourceDisplayName ? { sourceDisplayName } : {}),
    localSource,
    ...(legacyOriginalPath ? { originalPath: legacyOriginalPath } : {}),
    importedAt: options.importedAt ?? Date.now(),
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function calculateSha256Fallback(buffer: ArrayBuffer): string {
  const data = new Uint8Array(buffer);
  const bitLength = BigInt(data.length) * 8n;
  const paddedLength = (((data.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);

  padded.set(data);
  padded[data.length] = 0x80;

  for (let index = 0; index < 8; index += 1) {
    padded[padded.length - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  const words = new Uint32Array(64);
  const hash = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ]);
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const rotateRight = (value: number, shift: number): number => (
    (value >>> shift) | (value << (32 - shift))
  ) >>> 0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      words[index] = (
        (padded[base] << 24)
        | (padded[base + 1] << 16)
        | (padded[base + 2] << 8)
        | padded[base + 3]
      ) >>> 0;
    }

    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const digest = new Uint8Array(hash.length * 4);
  hash.forEach((value, index) => {
    const base = index * 4;
    digest[base] = (value >>> 24) & 0xff;
    digest[base + 1] = (value >>> 16) & 0xff;
    digest[base + 2] = (value >>> 8) & 0xff;
    digest[base + 3] = value & 0xff;
  });

  return bytesToHex(digest);
}

export async function calculateFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  if (
    typeof crypto !== 'undefined' &&
    crypto.subtle &&
    typeof crypto.subtle.digest === 'function'
  ) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return bytesToHex(new Uint8Array(hashBuffer));
  }

  return calculateSha256Fallback(buffer);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Failed to convert blob to data URL.'));
    };
    reader.onerror = (): void => reject(reader.error ?? new Error('Failed to read blob.'));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string, mimeType = 'application/octet-stream'): Blob {
  const matches = /^data:([^;,]+)?(?:;base64)?,(.*)$/.exec(dataUrl);
  if (!matches) {
    throw new Error('Invalid data URL.');
  }

  const payload = matches[2] ?? '';
  const resolvedMimeType = matches[1] || mimeType;
  const binary = atob(payload);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: resolvedMimeType });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = (): void => resolve(video);
    video.onerror = (): void => reject(new Error('Failed to load video'));
    video.src = url;
  });
}

function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: maxWidth, height: maxHeight };
  }

  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function drawToCanvas(source: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to get canvas context');
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

function createObjectUrlFromBlob(blob: Blob | undefined): string | undefined {
  if (!blob) {
    return undefined;
  }

  return URL.createObjectURL(blob);
}

async function preprocessVideoOnMainThread(
  file: File,
  options: Pick<FilePreprocessRequest, 'thumbnail'>
): Promise<VideoPreprocessResult> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = await loadVideo(objectUrl);
    const metadata = {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
    const thumbnailSize = fitWithin(video.videoWidth, video.videoHeight, options.thumbnail.maxWidth, options.thumbnail.maxHeight);
    const thumbnailUrl = drawToCanvas(video, thumbnailSize.width, thumbnailSize.height);

    return {
      kind: 'video',
      metadata,
      thumbnailUrl,
      processingMode: 'main-thread',
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function preprocessImportFile(request: FilePreprocessRequest): Promise<FilePreprocessResult> {
  if (request.kind === 'image') {
    const capabilities = getImageThumbnailWorkerPipelineCapabilities();
    const workerTask = enqueueImageThumbnailTask(request.file, request.thumbnail);
    let workerResult: ImagePreprocessResult | undefined;
    let thumbnailFailure: ImageThumbnailFailureDetail | undefined;

    if (!workerTask) {
      thumbnailFailure = {
        failureCode: 'worker-unavailable',
        failureStage: 'pipeline-gate',
        retryable: false,
        message: 'Image thumbnail worker pipeline is unavailable',
        environment: {
          hasWorker: capabilities.hasWorker,
          hasCreateImageBitmap: capabilities.hasCreateImageBitmap,
          hasOffscreenCanvas: capabilities.hasOffscreenCanvas,
        },
      };
    } else {
      workerResult = await workerTask.promise.catch((error) => {
        if (isImageThumbnailWorkerPipelineError(error)) {
          thumbnailFailure = {
            ...error.toFailureDetail(),
            environment: {
              hasWorker: capabilities.hasWorker,
              hasCreateImageBitmap: capabilities.hasCreateImageBitmap,
              hasOffscreenCanvas: capabilities.hasOffscreenCanvas,
              ...error.environment,
            },
          };
          return undefined;
        }

        thumbnailFailure = {
          failureCode: 'unknown',
          failureStage: 'result-apply',
          retryable: false,
          message: error instanceof Error ? error.message : 'Image thumbnail generation failed',
          environment: {
            hasWorker: capabilities.hasWorker,
            hasCreateImageBitmap: capabilities.hasCreateImageBitmap,
            hasOffscreenCanvas: capabilities.hasOffscreenCanvas,
          },
        };
        return undefined;
      });
    }

    if (!workerResult?.thumbnailBlob) {
      return {
        kind: 'image',
        metadata: workerResult?.metadata,
        thumbnailBlob: undefined,
        thumbnailUrl: undefined,
        thumbnailMimeType: workerResult?.thumbnailMimeType,
        thumbnailFailure,
        processingMode: 'unavailable',
      };
    }

    return {
      kind: 'image',
      metadata: workerResult.metadata,
      thumbnailBlob: workerResult.thumbnailBlob,
      thumbnailUrl: createObjectUrlFromBlob(workerResult.thumbnailBlob),
      thumbnailMimeType: workerResult.thumbnailMimeType,
      processingMode: 'worker',
    } satisfies ImagePreprocessResult;
  }

  return preprocessVideoOnMainThread(request.file, {
    thumbnail: request.thumbnail,
  });
}

export async function generateThumbnail(file: File, maxWidth = 200, maxHeight = 200): Promise<string> {
  const fileType = getFileTypeFromName(file.name);
  if (fileType !== 'image' && fileType !== 'video') {
    return '';
  }

  const result = await preprocessImportFile({
    file,
    kind: fileType,
    thumbnail: {
      maxWidth,
      maxHeight,
    },
  });

  return result.thumbnailUrl ?? '';
}

export async function extractVideoMetadata(file: File): Promise<{ width: number; height: number; duration: number }> {
  return probeVideoMetadata(file);
}

export async function extractImageMetadata(file: File): Promise<{ width: number; height: number }> {
  return probeImageMetadata(file);
}

export const fileService = {
  calculateHash: calculateFileHash,
  blobToDataUrl,
  dataUrlToBlob,
  createLocalImportFileSource,
  generateThumbnail,
  extractVideoMetadata,
  extractImageMetadata,
  preprocessImportFile,
};
