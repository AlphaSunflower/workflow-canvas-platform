import type {
  Result,
  FileInfo,
  ChunkUpload,
  FileImportResult,
  SupportedFormat,
} from '../../types';
import { httpClient } from '../client/http-client';
import { createError, createModuleLogger, tryCatchAsync } from '../../utils';
import {
  getExecutionOutputAccessDeniedMessage,
  isExecutionOutputAccessDeniedError,
} from '@/services/execution-output-access-error';

const log = createModuleLogger('file-api');

function classifyDownloadFailure(code: string, status: unknown): 'network' | 'timeout' | 'http' | 'unknown' {
  if (code === 'NETWORK_ERROR') {
    return 'network';
  }

  if (code === 'TIMEOUT_ERROR') {
    return 'timeout';
  }

  if (typeof status === 'number') {
    return 'http';
  }

  return 'unknown';
}

const SUPPORTED_FORMATS: Record<string, SupportedFormat[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
  video: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
  model3d: ['ply'],
};

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export function getFileFormat(fileName: string): SupportedFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() as SupportedFormat;
  const allFormats = Object.values(SUPPORTED_FORMATS).flat();
  return allFormats.includes(ext) ? ext : null;
}

export function getFileType(format: SupportedFormat): 'image' | 'video' | 'model3d' | null {
  for (const [type, formats] of Object.entries(SUPPORTED_FORMATS)) {
    if (formats.includes(format)) {
      return type as 'image' | 'video' | 'model3d';
    }
  }
  return null;
}

export function isSupportedFormat(fileName: string): boolean {
  return getFileFormat(fileName) !== null;
}

export async function uploadFile(
  file: File,
  onProgress?: (progress: number) => void
): Promise<Result<FileInfo>> {
  log.info('uploadFile', `Uploading file: ${file.name}`, { size: file.size });

  const format = getFileFormat(file.name);
  if (!format) {
    log.warn('uploadFile', `Unsupported file format: ${file.name}`);
    return {
      success: false,
      error: {
        code: 'FILE_TYPE_ERROR',
        message: `Unsupported file format: ${file.name}`,
        module: 'file-api',
        operation: 'uploadFile',
        timestamp: Date.now(),
      },
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    log.warn('uploadFile', `File too large: ${file.name}`);
    return {
      success: false,
      error: {
        code: 'FILE_SIZE_ERROR',
        message: `File size exceeds maximum allowed size (${MAX_FILE_SIZE / (1024 * 1024)}MB)`,
        module: 'file-api',
        operation: 'uploadFile',
        timestamp: Date.now(),
      },
    };
  }

  if (file.size > CHUNK_SIZE) {
    return uploadLargeFile(file, onProgress);
  }

  return httpClient.upload<FileInfo>('/api/v1/files/upload', file, onProgress);
}

async function uploadLargeFile(
  file: File,
  onProgress?: (progress: number) => void
): Promise<Result<FileInfo>> {
  log.info('uploadLargeFile', `Starting chunked upload: ${file.name}`);

  const initResult = await httpClient.post<ChunkUpload>('/api/v1/files/upload/init', {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  });

  if (!initResult.success) {
    return { success: false, error: initResult.error };
  }

  const upload = initResult.data;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let uploadedChunks = 0;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const chunkResult = await httpClient.post<void>('/api/v1/files/upload/chunk', {
      uploadId: upload.uploadId,
      fileId: upload.fileId,
      chunkIndex: i,
      chunkData: chunk,
    });

    if (!chunkResult.success) {
      return { success: false, error: chunkResult.error };
    }

    uploadedChunks++;
    if (onProgress) {
      onProgress((uploadedChunks / totalChunks) * 100);
    }
  }

  const completeResult = await httpClient.post<FileInfo>('/api/v1/files/upload/complete', {
    uploadId: upload.uploadId,
    fileId: upload.fileId,
  });

  if (!completeResult.success) {
    return { success: false, error: completeResult.error };
  }

  log.info('uploadLargeFile', `Chunked upload completed: ${file.name}`);
  return { success: true, data: completeResult.data };
}

export async function getFileInfo(id: string): Promise<Result<FileInfo>> {
  log.debug('getFileInfo', `Getting file info: ${id}`);
  return httpClient.get<FileInfo>(`/api/v1/files/${id}`);
}

export async function downloadFile(id: string): Promise<Result<Blob>> {
  log.debug('downloadFile', `Downloading file: ${id}`);
  const result = await tryCatchAsync(async () => {
    const blobResult = await httpClient.getBlob(getFileUrl(id, 'download'));
    if (!blobResult.success) {
      throw blobResult.error;
    }
    return blobResult.data;
  }, 'file-api', 'downloadFile');

  if (!result.success) {
    if (isExecutionOutputAccessDeniedError(result.error)) {
      const previousContext = result.error.context;
      return {
        success: false,
        error: createError('DOWNLOAD_ERROR', getExecutionOutputAccessDeniedMessage(id), {
          module: 'file-api',
          operation: 'downloadFile',
          timestamp: Date.now(),
          cause: undefined,
          context: {
            ...(previousContext ?? {}),
            fileId: id,
            previousCode: result.error.code,
            cause: result.error.message,
            accessDenied: true,
          },
        }),
      };
    }

    const previousContext = result.error.context;
    const failureKind = classifyDownloadFailure(result.error.code, previousContext?.status);
    const message = result.error.message.startsWith('Download failed:')
      ? `远端文件下载失败：${result.error.message.replace('Download failed:', 'HTTP').trim()}`
      : `远端文件下载失败：${result.error.message}`;

    return {
      success: false,
      error: createError('DOWNLOAD_ERROR', message, {
        module: 'file-api',
        operation: 'downloadFile',
        timestamp: Date.now(),
        context: {
          ...(previousContext ?? {}),
          fileId: id,
          cause: result.error.message,
          previousCode: result.error.code,
          failureKind,
        },
      }),
    };
  }

  return result;
}

export async function deleteFile(id: string): Promise<Result<void>> {
  log.info('deleteFile', `Deleting file: ${id}`);
  return httpClient.delete<void>(`/api/v1/files/${id}`);
}

export async function importFiles(
  files: FileList | File[]
): Promise<FileImportResult> {
  log.info('importFiles', `Importing ${files.length} files`);

  const results: FileInfo[] = [];
  const errors: Array<{ fileName: string; code: string; message: string }> = [];
  const duplicates: string[] = [];

  for (const file of files) {
    if (!isSupportedFormat(file.name)) {
      errors.push({
        fileName: file.name,
        code: 'FILE_TYPE_ERROR',
        message: `Unsupported file format`,
      });
      continue;
    }

    const result = await uploadFile(file);
    if (result.success) {
      results.push(result.data);
    } else {
      if (result.error.code === 'DUPLICATE_FILE') {
        duplicates.push(file.name);
      } else {
        errors.push({
          fileName: file.name,
          code: result.error.code,
          message: result.error.message,
        });
      }
    }
  }

  log.info('importFiles', `Import completed`, {
    success: results.length,
    errors: errors.length,
    duplicates: duplicates.length,
  });

  return {
    success: errors.length === 0,
    files: results,
    errors,
    duplicates,
  };
}

export function getFileUrl(fileId: string, type: 'preview' | 'thumbnail' | 'download' = 'preview'): string {
  const baseUrl = '/api/v1/files';
  switch (type) {
    case 'thumbnail':
      return `${baseUrl}/${fileId}/thumbnail`;
    case 'download':
      return `${baseUrl}/${fileId}/download`;
    default:
      return `${baseUrl}/${fileId}/preview`;
  }
}

export function getRemoteImageUrls(fileId: string): { thumbnailUrl: string; previewUrl: string; } {
  return {
    thumbnailUrl: getFileUrl(fileId, 'thumbnail'),
    previewUrl: getFileUrl(fileId, 'preview'),
  };
}

export const fileApi = {
  upload: uploadFile,
  getInfo: getFileInfo,
  download: downloadFile,
  delete: deleteFile,
  import: importFiles,
  getUrl: getFileUrl,
  getRemoteImageUrls,
};
