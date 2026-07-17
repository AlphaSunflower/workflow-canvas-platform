import type { AppError, FileNodeData } from '@/types';
import {
  createError,
  getExtensionFromMimeType,
  getFileExtension,
} from '@/utils';
import { fileApi } from '@/api/services/file-api';
import {
  type BrowserWritableDirectoryHandleLike,
  browserFileService,
} from './browser-file';
import {
  createExecutionOutputAccessDeniedError,
  isExecutionOutputAccessDeniedError,
} from './execution-output-access-error';
import {
  resolveFileResource,
  type FileResourceDiagnosticsMetadata,
  type FileResourceHandle,
  type FileResourceSelectedSource,
} from './file-resource';
import type {
  FileExportOptions,
  FileExportResolvedPayload,
  FileExportResult,
  FileExportService,
} from './file-export.types';

let cachedDirectoryHandle: BrowserWritableDirectoryHandleLike | null = null;

const DUPLICATE_EXTENSION_PATTERN = /(\.[a-z0-9]+)(?:\1)+$/i;
const INVALID_FILE_NAME_CHARACTERS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

interface FileExportResolutionContext {
  failedUrls: Set<string>;
  fallbackChain: string[];
  failures: Array<{
    source: string;
    reason: string;
    url?: string;
    diagnostics?: FileResourceDiagnosticsMetadata;
  }>;
}

function createFileExportError(
  message: string,
  operation: string,
  context?: Record<string, unknown>,
): AppError {
  return createError('STORAGE_ERROR', message, {
    module: 'file-export',
    operation,
    timestamp: Date.now(),
    context,
  });
}

function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const normalized = trimmed.length > 0 ? trimmed : 'exported-file';
  const withoutInvalidCharacters = Array.from(normalized, (character) => {
    const codePoint = character.charCodeAt(0);
    const isControlCharacter = codePoint >= 0 && codePoint <= 31;
    return isControlCharacter || INVALID_FILE_NAME_CHARACTERS.has(character) ? '_' : character;
  }).join('');
  const sanitized = withoutInvalidCharacters
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  const deduplicated = sanitized.replace(DUPLICATE_EXTENSION_PATTERN, '$1');

  return deduplicated.length > 0 ? deduplicated : 'exported-file';
}

function getFallbackExtension(nodeType?: FileNodeData['type']): string {
  switch (nodeType) {
    case 'image':
      return 'png';
    case 'video':
      return 'mp4';
    case 'ply':
      return 'ply';
    default:
      return '';
  }
}

function normalizeExtension(extension: string): string {
  return extension.replace(/^\.+/, '').trim().toLowerCase();
}

function removeCurrentExtension(fileName: string): string {
  const extension = getFileExtension(fileName);
  if (!extension) {
    return fileName;
  }

  return fileName.slice(0, -(extension.length + 1));
}

function getExpectedExtension(mimeType?: string, nodeType?: FileNodeData['type']): string {
  return normalizeExtension((mimeType ? getExtensionFromMimeType(mimeType) : '') || getFallbackExtension(nodeType));
}

function ensureFileExtension(fileName: string, mimeType?: string, nodeType?: FileNodeData['type']): string {
  const currentExtension = normalizeExtension(getFileExtension(fileName));
  const expectedExtension = getExpectedExtension(mimeType, nodeType);

  if (!expectedExtension) {
    return fileName;
  }

  if (!currentExtension) {
    return `${fileName}.${expectedExtension}`;
  }

  if (currentExtension === expectedExtension) {
    return fileName;
  }

  const baseName = removeCurrentExtension(fileName);
  return `${baseName}.${expectedExtension}`;
}

function normalizeExportFileName(node: FileNodeData, mimeType?: string): string {
  return ensureFileExtension(sanitizeFileName(node.fileName || node.fileId), mimeType || node.mimeType, node.type);
}

function createExportResolutionContext(): FileExportResolutionContext {
  return {
    failedUrls: new Set<string>(),
    fallbackChain: [],
    failures: [],
  };
}

function normalizeExportRequestUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed, typeof window === 'undefined' ? undefined : window.location.origin);
    if (parsed.pathname.startsWith('/api/v1/files/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function recordExportFailedUrl(context: FileExportResolutionContext, url: string | undefined): void {
  const normalized = url ? normalizeExportRequestUrl(url) : '';
  if (!normalized) {
    return;
  }

  context.failedUrls.add(normalized);
}

function recordExportResolutionFailure(
  context: FileExportResolutionContext,
  source: string,
  error: unknown,
  url?: string,
): void {
  const diagnostics = error && typeof error === 'object'
    ? (error as { fileResourceDiagnostics?: FileResourceDiagnosticsMetadata }).fileResourceDiagnostics
    : undefined;
  if (diagnostics?.fallbackChain) {
    context.fallbackChain = diagnostics.fallbackChain;
  }
  context.failures.push({
    source,
    reason: error instanceof Error ? error.message : String(error ?? 'unknown'),
    ...(url ? { url } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  });
  recordExportFailedUrl(context, url);
}

function toExportSource(source: FileResourceSelectedSource): FileExportResolvedPayload['source'] {
  switch (source) {
    case 'execution-runtime-file':
    case 'runtime-sync':
      return 'runtime-output';
    case 'registry-file':
      return 'registry-file';
    case 'local-handle':
      return 'local-archive';
    case 'remote-download':
      return 'remote-download';
    case 'backend-id':
    case 'thumbnail':
    case 'unresolved':
      return 'node-url';
  }
}

function createFileResourcePayload(
  node: FileNodeData,
  handle: FileResourceHandle,
): FileExportResolvedPayload | null {
  const file = handle.file ?? (handle.blob instanceof File ? handle.blob : undefined);
  if (!file && !handle.blob) {
    return null;
  }

  const blob = file ?? handle.blob;
  if (!blob) {
    return null;
  }

  return {
    fileName: normalizeExportFileName(node, blob.type || node.mimeType),
    mimeType: blob.type || node.mimeType || 'application/octet-stream',
    blob,
    source: toExportSource(handle.selectedSource),
  };
}

async function resolveExportOriginalResource(
  node: FileNodeData,
  context: FileExportResolutionContext,
  options: Pick<FileExportOptions, 'workflowId' | 'authScope'> = {},
): Promise<FileExportResolvedPayload | null> {
  let handle: FileResourceHandle | null = null;
  try {
    handle = await resolveFileResource(node, {
      purpose: 'export-original',
      require: 'file',
      workflowId: options.workflowId,
      authScope: options.authScope,
      owner: `file-export:${node.id.value}:${node.fileId}`,
      skipRemoteDownloadUrls: Array.from(context.failedUrls),
    });
    context.fallbackChain = handle.fallbackChain;
    return createFileResourcePayload(node, handle);
  } catch (error) {
    recordExportResolutionFailure(context, 'export-original', error, fileApi.getUrl(node.fileId, 'download'));
    if (isExecutionOutputAccessDeniedError(error)) {
      throw createExecutionOutputAccessDeniedError({
        fileId: node.fileId,
        module: 'file-export',
        operation: 'resolveExportOriginalResource',
        cause: error,
      });
    }
    return null;
  } finally {
    handle?.release();
  }
}

async function resolveExportPayload(
  node: FileNodeData,
  options: Pick<FileExportOptions, 'workflowId' | 'authScope'> = {},
): Promise<FileExportResolvedPayload> {
  const resolutionContext = createExportResolutionContext();
  const resourcePayload = await resolveExportOriginalResource(node, resolutionContext, options);
  if (resourcePayload) {
    return resourcePayload;
  }

  throw createFileExportError(
    '未找到可导出的文件内容: No exportable file content was found.',
    'resolveExportPayload',
    {
      nodeId: node.id.value,
      fileId: node.fileId,
      fileName: node.fileName,
      nodeType: node.type,
      fallbackChain: resolutionContext.fallbackChain,
      failures: resolutionContext.failures,
      failedUrls: Array.from(resolutionContext.failedUrls),
    }
  );
}

async function ensureDirectoryHandle(
  forcePicker = false,
): Promise<{ handle: BrowserWritableDirectoryHandleLike | null; cancelled: boolean; error?: ReturnType<typeof createFileExportError> }> {
  if (!forcePicker && cachedDirectoryHandle) {
    return {
      handle: cachedDirectoryHandle,
      cancelled: false,
    };
  }

  if (!browserFileService.supportsDirectoryPicker()) {
    return {
      handle: null,
      cancelled: false,
    };
  }

  const picked = await browserFileService.pickDirectory();
  if (!picked.success) {
    return {
      handle: null,
      cancelled: false,
      error: createFileExportError(
        picked.error.message,
        'ensureDirectoryHandle',
        {
          cause: picked.error.context,
        }
      ),
    };
  }

  if (!picked.data) {
    return {
      handle: null,
      cancelled: true,
    };
  }

  cachedDirectoryHandle = picked.data;
  return {
    handle: picked.data,
    cancelled: false,
  };
}

export async function selectExportDirectory(): Promise<{
  success: boolean;
  cancelled?: boolean;
  directoryName?: string | null;
  error?: ReturnType<typeof createFileExportError>;
}> {
  const result = await ensureDirectoryHandle(true);
  if (result.error) {
    return {
      success: false,
      error: result.error,
    };
  }

  if (result.cancelled) {
    return {
      success: false,
      cancelled: true,
      directoryName: null,
    };
  }

  return {
    success: true,
    directoryName: result.handle?.name ?? null,
  };
}

export function clearExportDirectoryHandle(): void {
  cachedDirectoryHandle = null;
}

export function getExportDirectoryHandle(): BrowserWritableDirectoryHandleLike | null {
  return cachedDirectoryHandle;
}

export async function exportFileNode(
  node: FileNodeData,
  options: FileExportOptions = {},
): Promise<FileExportResult> {
  let resolvedPayload: FileExportResolvedPayload;

  try {
    resolvedPayload = await resolveExportPayload(node, {
      workflowId: options.workflowId,
      authScope: options.authScope,
    });
  } catch (error) {
    if (isExecutionOutputAccessDeniedError(error)) {
      return {
        status: 'failed',
        fileName: normalizeExportFileName(node),
        error: createExecutionOutputAccessDeniedError({
          fileId: node.fileId,
          module: 'file-export',
          operation: 'exportFileNode',
          cause: error,
        }),
      };
    }

    const appError = error && typeof error === 'object' && 'code' in error
      ? error as ReturnType<typeof createFileExportError>
      : createFileExportError(
        'Failed to resolve exportable file content.',
        'exportFileNode',
        {
          nodeId: node.id.value,
          fileId: node.fileId,
          cause: error instanceof Error ? error.message : 'unknown',
        }
      );

    return {
      status: 'failed',
      fileName: normalizeExportFileName(node),
      error: appError,
    };
  }

  const requestedHandle = options.directoryHandle as BrowserWritableDirectoryHandleLike | undefined;
  const handleResolution = requestedHandle
    ? { handle: requestedHandle, cancelled: false as const, error: undefined }
    : await ensureDirectoryHandle(Boolean(options.forceDirectoryPicker));

  if (handleResolution.error) {
    return {
      status: 'failed',
      fileName: resolvedPayload.fileName,
      source: resolvedPayload.source,
      directoryName: null,
      error: handleResolution.error,
    };
  }

  if (handleResolution.cancelled) {
    return {
      status: 'failed',
      fileName: resolvedPayload.fileName,
      source: resolvedPayload.source,
      directoryName: null,
      error: createFileExportError(
        'Directory selection was cancelled.',
        'exportFileNode',
        {
          nodeId: node.id.value,
          fileId: node.fileId,
        }
      ),
    };
  }

  if (handleResolution.handle) {
    const saveToDirectoryResult = await browserFileService.saveBlobToDirectory(
      handleResolution.handle,
      resolvedPayload.fileName,
      resolvedPayload.blob,
    );

    if (saveToDirectoryResult.success) {
      return {
        status: 'saved',
        fileName: resolvedPayload.fileName,
        source: resolvedPayload.source,
        directoryName: handleResolution.handle.name ?? null,
      };
    }

    clearExportDirectoryHandle();
  }

  const downloadFallback = await browserFileService.saveBlobFile(
    resolvedPayload.blob,
    resolvedPayload.fileName,
    resolvedPayload.mimeType,
  );

  if (downloadFallback.success) {
    return {
      status: 'downloaded',
      fileName: resolvedPayload.fileName,
      source: resolvedPayload.source,
      directoryName: null,
    };
  }

  return {
    status: 'failed',
    fileName: resolvedPayload.fileName,
    source: resolvedPayload.source,
    directoryName: null,
    error: createFileExportError(
      'Failed to export current file node.',
      'exportFileNode',
      {
        nodeId: node.id.value,
        fileId: node.fileId,
        fileName: resolvedPayload.fileName,
      }
    ),
  };
}

export const fileExportService: FileExportService = {
  exportNodeFile: exportFileNode,
  selectDirectory: selectExportDirectory,
  clearDirectoryHandle: clearExportDirectoryHandle,
  getDirectoryHandle: getExportDirectoryHandle,
};
