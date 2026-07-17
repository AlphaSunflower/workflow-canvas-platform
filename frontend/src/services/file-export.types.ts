import type { AppError, FileNodeData } from '@/types';

export type FileExportResolutionSource =
  | 'runtime-output'
  | 'local-archive'
  | 'remote-download'
  | 'node-url'
  | 'registry-file';

export interface FileExportResolvedPayload {
  fileName: string;
  mimeType: string;
  blob: Blob;
  source: FileExportResolutionSource;
}

export interface FileExportSuccessData {
  status: 'saved';
  fileName: string;
  source: FileExportResolutionSource;
  directoryName: string | null;
}

export interface FileExportDownloadedData {
  status: 'downloaded';
  fileName: string;
  source: FileExportResolutionSource;
  directoryName: null;
}

export interface FileExportFailedData {
  status: 'failed';
  fileName: string;
  source?: FileExportResolutionSource;
  directoryName?: string | null;
  error: AppError;
}

export type FileExportResult =
  | FileExportSuccessData
  | FileExportDownloadedData
  | FileExportFailedData;

export interface FileExportOptions {
  forceDirectoryPicker?: boolean;
  directoryHandle?: unknown;
  workflowId?: string | null;
  authScope?: string | null;
}

export interface FileExportService {
  exportNodeFile: (node: FileNodeData, options?: FileExportOptions) => Promise<FileExportResult>;
  selectDirectory: () => Promise<{
    success: boolean;
    cancelled?: boolean;
    directoryName?: string | null;
    error?: AppError;
  }>;
  clearDirectoryHandle: () => void;
  getDirectoryHandle: () => unknown | null;
}
