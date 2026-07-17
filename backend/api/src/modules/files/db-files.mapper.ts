import type { FileAssetResponse } from "@newworkflow/backend-shared/api";
import type {
  FileAssetRecord,
  FileBlobRecord,
  PendingUploadRecord,
} from "./files.repository.types.ts";

type DbFileType = FileAssetRecord["fileType"];
type DbFileSourceType = FileAssetRecord["sourceType"];
type DbFileStatus = FileAssetRecord["status"];

export interface FileAssetDbRow {
  [column: string]: unknown;
  id: unknown;
  user_id: unknown;
  blob_id: unknown;
  original_name: unknown;
  display_name: unknown;
  mime_type: unknown;
  file_type: unknown;
  source_type: unknown;
  status: unknown;
  pending_upload_id: unknown;
  sha256: unknown;
  size: unknown;
  extension: unknown;
  width: unknown;
  height: unknown;
  duration: unknown;
  preview_ready: unknown;
  preview_width: unknown;
  preview_height: unknown;
  thumbnail_ready: unknown;
  thumbnail_width: unknown;
  thumbnail_height: unknown;
  created_at: unknown;
}

export interface FileBlobDbRow {
  [column: string]: unknown;
  id: unknown;
  sha256: unknown;
  size: unknown;
  mime_type: unknown;
  storage_key: unknown;
  preview_storage_key: unknown;
  preview_mime_type: unknown;
  preview_size: unknown;
  preview_width: unknown;
  preview_height: unknown;
  thumbnail_storage_key: unknown;
  thumbnail_mime_type: unknown;
  thumbnail_size: unknown;
  thumbnail_width: unknown;
  thumbnail_height: unknown;
  storage_provider: unknown;
  extension: unknown;
  width: unknown;
  height: unknown;
  duration: unknown;
  created_at: unknown;
}

export interface PendingUploadDbRow {
  [column: string]: unknown;
  upload_id: unknown;
  file_id: unknown;
  user_id: unknown;
  sha256: unknown;
  size: unknown;
  mime_type: unknown;
  original_name: unknown;
  display_name: unknown;
  file_type: unknown;
  source_type: unknown;
  width: unknown;
  height: unknown;
  duration: unknown;
  created_at: unknown;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value === "string") {
    return value;
  }

  throw new Error(`INVALID_DB_FILE_FIELD:${fieldName}`);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : requireString(value, "nullable_string");
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`INVALID_DB_FILE_FIELD:${fieldName}`);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : requireNumber(value, "nullable_number");
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`INVALID_DB_FILE_FIELD:${fieldName}`);
}

function requireIsoString(value: unknown, fieldName: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);

    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }

  throw new Error(`INVALID_DB_FILE_FIELD:${fieldName}`);
}

function requireFileType(value: unknown): DbFileType {
  if (value === "image" || value === "video" || value === "ply" || value === "unknown") {
    return value;
  }

  throw new Error("INVALID_DB_FILE_FIELD:file_type");
}

function requireSourceType(value: unknown): DbFileSourceType {
  if (value === "input" || value === "intermediate" || value === "output") {
    return value;
  }

  throw new Error("INVALID_DB_FILE_FIELD:source_type");
}

function requireFileStatus(value: unknown): DbFileStatus {
  if (value === "pending_upload" || value === "ready") {
    return value;
  }

  throw new Error("INVALID_DB_FILE_FIELD:status");
}

export function toFileAssetRecord(row: FileAssetDbRow): FileAssetRecord {
  return {
    id: requireString(row.id, "id"),
    userId: nullableString(row.user_id),
    blobId: nullableString(row.blob_id),
    originalName: requireString(row.original_name, "original_name"),
    displayName: requireString(row.display_name, "display_name"),
    mimeType: requireString(row.mime_type, "mime_type"),
    fileType: requireFileType(row.file_type),
    sourceType: requireSourceType(row.source_type),
    status: requireFileStatus(row.status),
    pendingUploadId: nullableString(row.pending_upload_id),
    sha256: nullableString(row.sha256),
    size: nullableNumber(row.size),
    extension: nullableString(row.extension),
    width: nullableNumber(row.width),
    height: nullableNumber(row.height),
    duration: nullableNumber(row.duration),
    previewReady: requireBoolean(row.preview_ready, "preview_ready"),
    previewWidth: nullableNumber(row.preview_width),
    previewHeight: nullableNumber(row.preview_height),
    thumbnailReady: requireBoolean(row.thumbnail_ready, "thumbnail_ready"),
    thumbnailWidth: nullableNumber(row.thumbnail_width),
    thumbnailHeight: nullableNumber(row.thumbnail_height),
    createdAt: requireIsoString(row.created_at, "created_at"),
  };
}

export function toFileBlobRecord(row: FileBlobDbRow): FileBlobRecord {
  return {
    id: requireString(row.id, "id"),
    sha256: requireString(row.sha256, "sha256"),
    size: requireNumber(row.size, "size"),
    mimeType: requireString(row.mime_type, "mime_type"),
    storageKey: requireString(row.storage_key, "storage_key"),
    previewStorageKey: nullableString(row.preview_storage_key),
    previewMimeType: nullableString(row.preview_mime_type),
    previewSize: nullableNumber(row.preview_size),
    previewWidth: nullableNumber(row.preview_width),
    previewHeight: nullableNumber(row.preview_height),
    thumbnailStorageKey: nullableString(row.thumbnail_storage_key),
    thumbnailMimeType: nullableString(row.thumbnail_mime_type),
    thumbnailSize: nullableNumber(row.thumbnail_size),
    thumbnailWidth: nullableNumber(row.thumbnail_width),
    thumbnailHeight: nullableNumber(row.thumbnail_height),
    storageProvider: requireString(row.storage_provider, "storage_provider"),
    extension: nullableString(row.extension),
    width: nullableNumber(row.width),
    height: nullableNumber(row.height),
    duration: nullableNumber(row.duration),
    createdAt: requireIsoString(row.created_at, "created_at"),
  };
}

export function toPendingUploadRecord(row: PendingUploadDbRow): PendingUploadRecord {
  return {
    uploadId: requireString(row.upload_id, "upload_id"),
    fileId: requireString(row.file_id, "file_id"),
    userId: nullableString(row.user_id),
    sha256: requireString(row.sha256, "sha256"),
    size: requireNumber(row.size, "size"),
    mimeType: requireString(row.mime_type, "mime_type"),
    originalName: requireString(row.original_name, "original_name"),
    displayName: requireString(row.display_name, "display_name"),
    fileType: requireFileType(row.file_type),
    sourceType: requireSourceType(row.source_type),
    width: nullableNumber(row.width),
    height: nullableNumber(row.height),
    duration: nullableNumber(row.duration),
    createdAt: requireIsoString(row.created_at, "created_at"),
  };
}

export function toFileResponse(record: FileAssetRecord): FileAssetResponse {
  const isPreviewableImage = record.fileType === "image";
  const thumbnailUrl = record.status === "ready" && isPreviewableImage && record.thumbnailReady
    ? `/api/v1/files/${record.id}/thumbnail`
    : undefined;
  const previewUrl = record.status === "ready" && isPreviewableImage && record.previewReady
    ? `/api/v1/files/${record.id}/preview`
    : undefined;
  const downloadUrl = record.status === "ready"
    ? `/api/v1/files/${record.id}/download`
    : undefined;

  return {
    fileId: record.id,
    userId: record.userId,
    blobId: record.blobId,
    originalName: record.originalName,
    displayName: record.displayName,
    mimeType: record.mimeType,
    fileType: record.fileType,
    sourceType: record.sourceType,
    sha256: record.sha256,
    size: record.size,
    extension: record.extension,
    width: record.width,
    height: record.height,
    duration: record.duration,
    status: record.status,
    createdAt: record.createdAt,
    downloadUrl,
    thumbnailUrl,
    previewUrl,
    thumbnailWidth: record.thumbnailWidth ?? undefined,
    thumbnailHeight: record.thumbnailHeight ?? undefined,
    previewWidth: record.previewWidth ?? undefined,
    previewHeight: record.previewHeight ?? undefined,
  };
}
