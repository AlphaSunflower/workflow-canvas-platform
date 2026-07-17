import type {
  FileSourceType,
  FileType,
} from "../file.ts";

export interface FileRegisterRequest {
  userId?: string;
  sha256: string;
  size: number;
  mimeType: string;
  originalName: string;
  displayName?: string;
  fileType?: FileType;
  sourceType?: FileSourceType;
  width?: number;
  height?: number;
  duration?: number;
}

export interface FileUploadRequest {
  uploadId: string;
  contentBase64: string;
}

export interface FileAssetResponse {
  fileId: string;
  userId: string | null;
  blobId: string | null;
  originalName: string;
  displayName: string;
  mimeType: string;
  fileType: FileType;
  sourceType: FileSourceType;
  sha256: string | null;
  size: number | null;
  extension: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: "pending_upload" | "ready";
  createdAt: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  previewWidth?: number;
  previewHeight?: number;
}

export interface FileRegisterResponseData {
  uploadRequired: boolean;
  uploadId?: string;
  uploadUrl?: string;
  fileId: string;
  file: FileAssetResponse;
}

export interface FileUploadResponseData {
  uploadId: string;
  fileId: string;
  file: FileAssetResponse;
}
