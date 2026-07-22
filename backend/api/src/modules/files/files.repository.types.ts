import type { Readable } from "node:stream";
import type {
  FileAssetResponse,
  FileRegisterRequest,
} from "@newworkflow/backend-shared/api";

export type FileContentVariant = "download" | "preview" | "thumbnail";
export type FileAssetStatus = "pending_upload" | "ready";

export interface FileContentReadResult {
  buffer: Buffer;
  mimeType: string;
  byteLength: number;
  storageKey: string;
  blobSha256: string;
  lastModifiedAt: string;
}

export interface FileContentStreamResult {
  stream: Readable;
  mimeType: string;
  byteLength: number;
  storageKey: string;
  blobSha256: string;
  lastModifiedAt: string;
}

export interface FileBlobRecord {
  id: string;
  sha256: string;
  size: number;
  mimeType: string;
  storageKey: string;
  previewStorageKey: string | null;
  previewMimeType: string | null;
  previewSize: number | null;
  previewWidth: number | null;
  previewHeight: number | null;
  thumbnailStorageKey: string | null;
  thumbnailMimeType: string | null;
  thumbnailSize: number | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  storageProvider: string;
  extension: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
}

export interface FileAssetRecord {
  id: string;
  userId: string | null;
  blobId: string | null;
  originalName: string;
  displayName: string;
  mimeType: string;
  fileType: "image" | "video" | "ply" | "unknown";
  sourceType: "input" | "intermediate" | "output";
  status: FileAssetStatus;
  pendingUploadId: string | null;
  sha256: string | null;
  size: number | null;
  extension: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  previewReady: boolean;
  previewWidth: number | null;
  previewHeight: number | null;
  thumbnailReady: boolean;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  createdAt: string;
}

export interface PendingUploadRecord {
  uploadId: string;
  fileId: string;
  userId: string | null;
  sha256: string;
  size: number;
  mimeType: string;
  originalName: string;
  displayName: string;
  fileType: "image" | "video" | "ply" | "unknown";
  sourceType: "input" | "intermediate" | "output";
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
}

export interface FileStore {
  blobs: FileBlobRecord[];
  files: FileAssetRecord[];
  pendingUploads: PendingUploadRecord[];
}

export interface RegisteredFileResult {
  uploadRequired: boolean;
  uploadId?: string;
  uploadUrl?: string;
  file: FileAssetResponse;
}

export interface UploadedFileResult {
  uploadId: string;
  file: FileAssetResponse;
}

export interface FilesRepository {
  ensureInitialized(): Promise<void>;
  findBlobBySha256(sha256: string): Promise<FileBlobRecord | null>;
  registerFile(input: FileRegisterRequest): Promise<RegisteredFileResult>;
  uploadFile(
    uploadId: string,
    content: Buffer | Uint8Array | string,
  ): Promise<UploadedFileResult>;
  findFileById(fileId: string): Promise<FileAssetResponse | null>;
  findFileRecordById(fileId: string): Promise<FileAssetRecord | null>;
  findPendingUploadById(uploadId: string): Promise<PendingUploadRecord | null>;
  findReadyFilesByIds(fileIds: string[]): Promise<FileAssetResponse[]>;
  findFilesByIds(fileIds: string[]): Promise<FileAssetResponse[]>;
  readFileContent(
    fileId: string,
    variant?: FileContentVariant,
  ): Promise<FileContentReadResult | null>;
  readFileContentStream(
    fileId: string,
  ): Promise<FileContentStreamResult | null>;
}
