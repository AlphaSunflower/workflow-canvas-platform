import type { FileNodeData } from '@/types';
import type { EnsureBackendFilePurpose } from './backendFileService';
import type {
  BackendFileBindingScope,
  BackendFileRegisterResponse,
  BackendFileUploadResponse,
  CachedBackendFileBinding,
} from './backend-file-binding.contracts';

export type WorkflowUploadStatus =
  | 'waiting'
  | 'hashing'
  | 'registering'
  | 'uploading'
  | 'ready'
  | 'failed';

export type WorkflowUploadPriority = 'normal' | 'high';

export interface WorkflowUploadTaskSnapshot {
  key: string;
  workflowId: string | null;
  nodeId: string;
  localFileId: string;
  backendFileId: string | null;
  status: WorkflowUploadStatus;
  priority: WorkflowUploadPriority;
  progress: number;
  error: string | null;
  sha256: string | null;
  updatedAt: number;
}

export interface WorkflowUploadSchedulerConfig {
  hashConcurrency: number;
  uploadConcurrency: number;
  taskWaitTimeoutMs: number;
}

export interface WorkflowUploadEnqueueOptions {
  priority?: WorkflowUploadPriority;
  workflowId?: string | null;
  authScope?: string | null;
}

export interface WorkflowUploadEnsureOptions extends WorkflowUploadEnqueueOptions {
  signal?: AbortSignal;
  purpose?: EnsureBackendFilePurpose;
}

export interface WorkflowUploadSchedulerDependencies {
  getFileFromNode: (
    node: FileNodeData,
    options?: { signal?: AbortSignal; workflowId?: string | null; authScope?: string | null },
  ) => Promise<File>;
  resolveExistingBackendFileId: (
    node: FileNodeData,
    options?: { signal?: AbortSignal; workflowId?: string | null; authScope?: string | null },
  ) => Promise<string | null>;
  registerBackendFile: (
    node: FileNodeData,
    file: File,
    sha256: string,
    signal?: AbortSignal,
  ) => Promise<BackendFileRegisterResponse>;
  uploadBackendFile: (
    uploadId: string,
    file: File,
    signal?: AbortSignal,
  ) => Promise<BackendFileUploadResponse>;
  hashFile: (file: File, signal?: AbortSignal) => Promise<string>;
  getCachedBackendFileBinding: (
    node: Pick<FileNodeData, 'id' | 'fileId'>,
    scope?: BackendFileBindingScope,
  ) => CachedBackendFileBinding | null;
  cacheBackendFileBinding: (
    node: Pick<FileNodeData, 'id' | 'fileId'>,
    binding: CachedBackendFileBinding,
    scope?: BackendFileBindingScope,
  ) => void;
  getCachedBackendFileIdBySha256: (sha256: string) => string | null;
  cacheBackendFileIdBySha256: (sha256: string, backendFileId: string) => void;
}
