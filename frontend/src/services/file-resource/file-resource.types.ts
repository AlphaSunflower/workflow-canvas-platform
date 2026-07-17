import type { CachedBackendFileBinding } from '../backend-file-binding.contracts';

export type FileResourcePurpose =
  | 'canvas-thumbnail'
  | 'viewer-original'
  | 'inpaint-editor-original'
  | 'upload-input'
  | 'export-original'
  | 'prompt-reference'
  | 'runtime-output';

export type FileResourceVariant =
  | 'original'
  | 'download'
  | 'thumbnail'
  | 'preview'
  | 'runtime';

export type FileResourceSourceType =
  | 'local-input'
  | 'node-output'
  | 'remote-backend'
  | 'task-history'
  | 'unknown';

export type FileResourceStatus =
  | 'local-only'
  | 'upload-pending'
  | 'uploading'
  | 'backend-ready'
  | 'missing';

export type FileResourceLeaseReason =
  | 'upload'
  | 'execution'
  | 'viewer'
  | 'inpaint-editor'
  | 'export'
  | 'prompt-reference'
  | 'runtime-sync';

export interface FileResourceManifestKey {
  workflowId?: string | null;
  nodeId: string;
  fileId: string;
  authScope?: string | null;
  variant?: FileResourceVariant | null;
  version?: string | number | null;
  etag?: string | null;
}

export interface FileResourceVariantManifest {
  url?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  size?: number;
  version?: string | number;
  etag?: string;
  updatedAt: number;
}

export interface FileResourceLastError {
  code?: string;
  message: string;
  source?: string;
  at: number;
}

export interface FileResourceManifest {
  key: FileResourceManifestKey;
  manifestKey: string;
  workflowId: string | null;
  nodeId: string;
  fileId: string;
  authScope: string | null;
  variant: FileResourceVariant | null;
  version: string | number | null;
  etag: string | null;
  backendFileId: string | null;
  sourceType: FileResourceSourceType;
  status: FileResourceStatus;
  variants: Partial<Record<FileResourceVariant, FileResourceVariantManifest>>;
  hasLocalFile: boolean;
  hasRuntimeFile: boolean;
  hasRemoteOriginal: boolean;
  leaseCount: number;
  lastAccessAt: number;
  lastError: FileResourceLastError | null;
  backendBinding: CachedBackendFileBinding | null;
  createdAt: number;
  updatedAt: number;
}

export interface FileResourceManifestInput {
  key: FileResourceManifestKey;
  backendFileId?: string | null;
  sourceType?: FileResourceSourceType;
  status?: FileResourceStatus;
  variants?: Partial<Record<FileResourceVariant, FileResourceVariantManifest>>;
  hasLocalFile?: boolean;
  hasRuntimeFile?: boolean;
  hasRemoteOriginal?: boolean;
  leaseCount?: number;
  lastAccessAt?: number;
  lastError?: FileResourceLastError | null;
  backendBinding?: CachedBackendFileBinding | null;
}

export interface MarkBackendReadyInput {
  key: FileResourceManifestKey;
  backendFileId: string;
  binding?: CachedBackendFileBinding | null;
  variant?: FileResourceVariantManifest;
}

export interface MarkLocalFileInput {
  key: FileResourceManifestKey;
  file?: Pick<File, 'type' | 'size'> | null;
  sourceType?: FileResourceSourceType;
}

export interface MarkRuntimeFileInput {
  key: FileResourceManifestKey;
  file?: Pick<File, 'type' | 'size'> | null;
  sourceType?: FileResourceSourceType;
}

export interface MarkErrorInput {
  key: FileResourceManifestKey;
  error: Omit<FileResourceLastError, 'at'> & { at?: number };
}

export interface FileResourceLease {
  leaseId: string;
  key: FileResourceManifestKey;
  nodeId: string;
  fileId: string;
  reason: FileResourceLeaseReason;
  owner: string;
  acquiredAt: number;
  expiresAt: number | null;
  releasedAt: number | null;
}

export interface FileResourceLeaseSnapshot {
  leases: FileResourceLease[];
  leasedResourceCount: number;
}

export interface FileResourceLeaseAcquireOptions {
  ttlMs?: number | null;
}

export type FileResourceRequire =
  | 'backendFileId'
  | 'file'
  | 'blob'
  | 'objectUrl'
  | 'displayUrl';

export type FileResourceSelectedSource =
  | 'backend-id'
  | 'execution-runtime-file'
  | 'registry-file'
  | 'local-handle'
  | 'runtime-sync'
  | 'remote-download'
  | 'thumbnail'
  | 'unresolved';

export interface FileResourceResolveOptions {
  purpose: FileResourcePurpose;
  require: FileResourceRequire;
  workflowId?: string | null;
  authScope?: string | null;
  version?: string | number | null;
  etag?: string | null;
  signal?: AbortSignal;
  owner?: string;
  leaseTtlMs?: number | null;
  allowRemoteDownload?: boolean;
  skipRemoteDownloadUrls?: readonly string[];
}

export interface FileResourceDiagnosticsMetadata {
  purpose: FileResourcePurpose;
  require: FileResourceRequire;
  workflowId: string | null;
  nodeId: string;
  fileId: string;
  backendFileId: string | null;
  authScope: string | null;
  selectedSource: FileResourceSelectedSource;
  fallbackChain: FileResourceSelectedSource[];
  leaseId: string | null;
}

export interface FileResourceHandle {
  purpose: FileResourcePurpose;
  require: FileResourceRequire;
  selectedSource: FileResourceSelectedSource;
  fallbackChain: FileResourceSelectedSource[];
  diagnostics: FileResourceDiagnosticsMetadata;
  backendFileId?: string;
  file?: File;
  blob?: Blob;
  objectUrl?: string;
  displayUrl?: string;
  release: () => void;
}
