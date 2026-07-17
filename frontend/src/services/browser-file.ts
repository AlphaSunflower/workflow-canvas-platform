import { createError, createModuleLogger } from '@/utils';
import type { AppError, Result } from '@/types';
import type { BrowserFileSystemFileHandleLike } from './local-file-source-store';

const log = createModuleLogger('browser-file');

type DirectoryPermissionMode = 'read' | 'readwrite';

export interface BrowserWritableDirectoryHandleLike {
  name?: string;
  requestPermission?: (descriptor?: { mode?: DirectoryPermissionMode }) => Promise<PermissionState>;
  queryPermission?: (descriptor?: { mode?: DirectoryPermissionMode }) => Promise<PermissionState>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob | BufferSource | string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

interface BrowserWindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: () => Promise<BrowserWritableDirectoryHandleLike>;
}

export interface BrowserFilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

export interface BrowserPickedFileWithHandle {
  file: File;
  handle: BrowserFileSystemFileHandleLike;
}

interface BrowserWindowWithFilePicker extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: BrowserFilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<BrowserFileSystemFileHandleLike[]>;
}

function padDateSegment(value: number): string {
  return value.toString().padStart(2, '0');
}

function createBrowserFileError(message: string, operation: string, context?: Record<string, unknown>): AppError {
  return createError('STORAGE_ERROR', message, {
    module: 'browser-file',
    operation,
    timestamp: Date.now(),
    context,
  });
}

export function buildWorkflowArchiveFileName(savedAt: number = Date.now()): string {
  const date = new Date(savedAt);
  const year = date.getFullYear();
  const month = padDateSegment(date.getMonth() + 1);
  const day = padDateSegment(date.getDate());
  const hours = padDateSegment(date.getHours());
  const minutes = padDateSegment(date.getMinutes());
  const seconds = padDateSegment(date.getSeconds());

  return `workflow-${year}${month}${day}-${hours}${minutes}${seconds}.json`;
}

export async function saveTextFile(
  content: string,
  fileName: string,
  mimeType: string = 'application/json;charset=utf-8'
): Promise<Result<void>> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      success: false,
      error: createBrowserFileError(
        'Browser file save is unavailable in the current environment.',
        'saveTextFile',
        { fileName }
      ),
    };
  }

  let objectUrl: string | null = null;

  try {
    const fileBlob = new Blob([content], { type: mimeType });
    objectUrl = URL.createObjectURL(fileBlob);

    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    return {
      success: true,
      data: undefined,
    };
  } catch (error) {
    log.error('saveTextFile', 'Failed to save browser file', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: createBrowserFileError(
        'Failed to save file to local browser download.',
        'saveTextFile',
        {
          fileName,
          cause: error instanceof Error ? error.message : 'unknown',
        }
      ),
    };
  } finally {
    if (objectUrl) {
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl as string);
      }, 0);
    }
  }
}

export function supportsDirectoryPicker(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as BrowserWindowWithDirectoryPicker).showDirectoryPicker === 'function';
}

export function supportsFileSystemAccessFilePicker(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as BrowserWindowWithFilePicker).showOpenFilePicker === 'function';
}

async function ensureDirectoryPermission(
  handle: BrowserWritableDirectoryHandleLike,
  mode: DirectoryPermissionMode = 'readwrite'
): Promise<Result<void>> {
  try {
    if (typeof handle.queryPermission === 'function') {
      const currentState = await handle.queryPermission({ mode });
      if (currentState === 'granted') {
        return {
          success: true,
          data: undefined,
        };
      }
    }

    if (typeof handle.requestPermission === 'function') {
      const requestedState = await handle.requestPermission({ mode });
      if (requestedState === 'granted') {
        return {
          success: true,
          data: undefined,
        };
      }
    }

    return {
      success: false,
      error: createBrowserFileError(
        'Directory permission was not granted.',
        'ensureDirectoryPermission',
        {
          mode,
          directoryName: handle.name,
        }
      ),
    };
  } catch (error) {
    log.error('ensureDirectoryPermission', 'Failed to verify directory permission', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: createBrowserFileError(
        'Failed to verify directory permission.',
        'ensureDirectoryPermission',
        {
          mode,
          directoryName: handle.name,
          cause: error instanceof Error ? error.message : 'unknown',
        }
      ),
    };
  }
}

export async function pickDirectory(): Promise<Result<BrowserWritableDirectoryHandleLike | null>> {
  if (typeof window === 'undefined' || !supportsDirectoryPicker()) {
    return {
      success: false,
      error: createBrowserFileError(
        'Browser directory picker is unavailable in the current environment.',
        'pickDirectory'
      ),
    };
  }

  try {
    const handle = await (window as BrowserWindowWithDirectoryPicker).showDirectoryPicker!();
    return {
      success: true,
      data: handle ?? null,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        success: true,
        data: null,
      };
    }

    log.error('pickDirectory', 'Failed to open directory picker', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: createBrowserFileError(
        'Failed to open browser directory picker.',
        'pickDirectory',
        {
          cause: error instanceof Error ? error.message : 'unknown',
        }
      ),
    };
  }
}

export async function saveBlobFile(
  blob: Blob,
  fileName: string,
  mimeType: string = blob.type || 'application/octet-stream'
): Promise<Result<void>> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      success: false,
      error: createBrowserFileError(
        'Browser file save is unavailable in the current environment.',
        'saveBlobFile',
        { fileName }
      ),
    };
  }

  let objectUrl: string | null = null;

  try {
    const fileBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
    objectUrl = URL.createObjectURL(fileBlob);

    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    return {
      success: true,
      data: undefined,
    };
  } catch (error) {
    log.error('saveBlobFile', 'Failed to save browser blob file', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: createBrowserFileError(
        'Failed to save file to local browser download.',
        'saveBlobFile',
        {
          fileName,
          cause: error instanceof Error ? error.message : 'unknown',
        }
      ),
    };
  } finally {
    if (objectUrl) {
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl as string);
      }, 0);
    }
  }
}

export async function saveBlobToDirectory(
  handle: BrowserWritableDirectoryHandleLike,
  fileName: string,
  blob: Blob
): Promise<Result<void>> {
  const permissionResult = await ensureDirectoryPermission(handle, 'readwrite');
  if (!permissionResult.success) {
    return permissionResult;
  }

  try {
    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    return {
      success: true,
      data: undefined,
    };
  } catch (error) {
    log.error('saveBlobToDirectory', 'Failed to save blob to directory', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: createBrowserFileError(
        'Failed to write file into selected directory.',
        'saveBlobToDirectory',
        {
          fileName,
          directoryName: handle.name,
          cause: error instanceof Error ? error.message : 'unknown',
        }
      ),
    };
  }
}

export async function pickTextFile(
  accept: string = '.json,application/json'
): Promise<Result<{ file: File; content: string } | null>> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      success: false,
      error: createBrowserFileError(
        'Browser file picker is unavailable in the current environment.',
        'pickTextFile',
        { accept }
      ),
    };
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    const cleanup = (): void => {
      input.onchange = null;
      input.oncancel = null;
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    input.oncancel = (): void => {
      cleanup();
      resolve({
        success: true,
        data: null,
      });
    };

    input.onchange = async (): Promise<void> => {
      const selectedFile = input.files?.[0] ?? null;
      cleanup();

      if (!selectedFile) {
        resolve({
          success: true,
          data: null,
        });
        return;
      }

      try {
        const content = await selectedFile.text();
        resolve({
          success: true,
          data: {
            file: selectedFile,
            content,
          },
        });
      } catch (error) {
        log.error('pickTextFile', 'Failed to read browser file', error instanceof Error ? error : undefined);
        resolve({
          success: false,
          error: createBrowserFileError(
            'Failed to read selected local file.',
            'pickTextFile',
            {
              fileName: selectedFile.name,
              cause: error instanceof Error ? error.message : 'unknown',
            }
          ),
        });
      }
    };

    document.body.appendChild(input);
    input.click();
  });
}

export async function pickFilesWithHandles(options: {
  multiple?: boolean;
  types?: BrowserFilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
} = {}): Promise<Result<BrowserPickedFileWithHandle[] | null>> {
  if (typeof window === 'undefined' || !supportsFileSystemAccessFilePicker()) {
    return {
      success: false,
      error: createBrowserFileError(
        'Browser File System Access file picker is unavailable in the current environment.',
        'pickFilesWithHandles'
      ),
    };
  }

  try {
    const handles = await (window as BrowserWindowWithFilePicker).showOpenFilePicker!({
      multiple: options.multiple ?? false,
      types: options.types,
      excludeAcceptAllOption: options.excludeAcceptAllOption,
    });
    const files = await Promise.all(handles.map(async (handle) => ({
      file: await handle.getFile(),
      handle,
    })));

    return {
      success: true,
      data: files,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        success: true,
        data: null,
      };
    }

    log.error('pickFilesWithHandles', 'Failed to open File System Access file picker', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: createBrowserFileError(
        'Failed to open browser file picker.',
        'pickFilesWithHandles',
        {
          cause: error instanceof Error ? error.message : 'unknown',
        }
      ),
    };
  }
}

export const browserFileService = {
  buildWorkflowArchiveFileName,
  pickDirectory,
  pickFilesWithHandles,
  pickTextFile,
  saveBlobFile,
  saveBlobToDirectory,
  saveTextFile,
  supportsDirectoryPicker,
  supportsFileSystemAccessFilePicker,
};
