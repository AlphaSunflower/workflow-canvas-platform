export interface BackendFileAssetResponse {
  fileId: string;
  userId: string | null;
  blobId: string | null;
  originalName: string;
  displayName: string;
  mimeType: string;
  fileType: 'image' | 'video' | 'ply' | 'unknown';
  sourceType: 'input' | 'intermediate' | 'output';
  sha256: string | null;
  size: number | null;
  extension: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: 'pending_upload' | 'ready';
  createdAt: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  previewWidth?: number;
  previewHeight?: number;
}

export interface BackendFileRegisterResponse {
  uploadRequired: boolean;
  uploadId?: string;
  uploadUrl?: string;
  fileId: string;
  file: BackendFileAssetResponse;
}

export interface BackendFileUploadResponse {
  uploadId: string;
  fileId: string;
  file: BackendFileAssetResponse;
}

export interface CachedBackendFileBinding {
  backendFileId: string;
  sha256: string;
  size: number;
  updatedAt: number;
}

export interface BackendFileBindingScope {
  workflowId?: string | null;
  authScope?: string | null;
}
