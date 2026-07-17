import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import type { DatabaseConfig } from "@newworkflow/backend-shared";
import {
  queryPostgres,
  withTransaction,
  type DatabasePool,
  type TransactionClient,
} from "@newworkflow/backend-shared";
import type { FileAssetResponse, FileRegisterRequest } from "@newworkflow/backend-shared/api";
import { LocalObjectStorageAdapter } from "../storage/local-object-storage.adapter.ts";
import type { ObjectStorageAdapter } from "../storage/object-storage.adapter.ts";
import {
  toFileAssetRecord,
  toFileBlobRecord,
  toFileResponse,
  toPendingUploadRecord,
  type FileAssetDbRow,
  type FileBlobDbRow,
  type PendingUploadDbRow,
} from "./db-files.mapper.ts";
import type {
  FileAssetRecord,
  FileBlobRecord,
  FileContentReadResult,
  FileContentVariant,
  FilesRepository,
  PendingUploadRecord,
  RegisteredFileResult,
  UploadedFileResult,
} from "./files.repository.types.ts";
import { ImageDerivativeService } from "./image-derivative.service.ts";
import { ImageMetadataService } from "./image-metadata.service.ts";

type QueryExecutor = Pick<TransactionClient, "query">;
type DbQueryRow = Record<string, unknown>;

export interface DbFilesRepositoryOptions {
  pool?: DatabasePool;
  objectStorage?: ObjectStorageAdapter;
  rootDir?: string;
}

interface PreparedBlobPayload {
  sha256: string;
  size: number;
  mimeType: string;
  storageKey: string;
  storageProvider: string;
  extension: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
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
}

interface PreparedBlobWithWrites {
  blob: PreparedBlobPayload;
  writeTracker: ObjectWriteTracker;
}

interface StagedObjectWrite {
  tempStorageKey: string;
  finalStorageKey: string;
}

class ObjectWriteTracker {
  private readonly tempStorageKeys: string[] = [];
  private readonly publishedFinalStorageKeys: string[] = [];
  readonly stagedWrites: StagedObjectWrite[] = [];

  addStagedWrite(write: StagedObjectWrite): void {
    this.tempStorageKeys.push(write.tempStorageKey);
    this.stagedWrites.push(write);
  }

  addPublishedFinalStorageKey(storageKey: string): void {
    this.publishedFinalStorageKeys.push(storageKey);
  }

  async cleanupTemps(objectStorage: ObjectStorageAdapter): Promise<void> {
    await this.cleanupKeys(objectStorage, this.tempStorageKeys);
  }

  async cleanupPublishedFinals(objectStorage: ObjectStorageAdapter): Promise<void> {
    await this.cleanupKeys(objectStorage, this.publishedFinalStorageKeys);
  }

  private async cleanupKeys(
    objectStorage: ObjectStorageAdapter,
    storageKeys: string[],
  ): Promise<void> {
    const seen = new Set<string>();
    const keys = storageKeys.filter((storageKey) => {
        if (seen.has(storageKey)) {
          return false;
        }

        seen.add(storageKey);
        return true;
      })
      .reverse();

    await Promise.allSettled(keys.map((storageKey) => objectStorage.deleteIfExists(storageKey)));
  }
}

const FILE_ASSET_SELECT_COLUMNS = `
  id::text,
  user_id,
  blob_id::text,
  original_name,
  display_name,
  mime_type,
  file_type,
  source_type,
  status,
  pending_upload_id::text,
  sha256,
  size,
  extension,
  width,
  height,
  duration,
  preview_ready,
  preview_width,
  preview_height,
  thumbnail_ready,
  thumbnail_width,
  thumbnail_height,
  created_at
`;

const FILE_BLOB_SELECT_COLUMNS = `
  id::text,
  sha256,
  size,
  mime_type,
  storage_key,
  preview_storage_key,
  preview_mime_type,
  preview_size,
  preview_width,
  preview_height,
  thumbnail_storage_key,
  thumbnail_mime_type,
  thumbnail_size,
  thumbnail_width,
  thumbnail_height,
  storage_provider,
  extension,
  width,
  height,
  duration,
  created_at
`;

const PENDING_UPLOAD_SELECT_COLUMNS = `
  id::text as upload_id,
  file_id::text,
  user_id,
  sha256,
  size,
  mime_type,
  original_name,
  display_name,
  file_type,
  source_type,
  width,
  height,
  duration,
  created_at
`;

function toBlobStorageRelativePath(sha256: string, extension: string | null): string {
  const bucket = sha256.slice(0, 2);
  const fileName = extension ? `${sha256}.${extension}` : sha256;
  return path.join("blobs", bucket, fileName).replaceAll("\\", "/");
}

function toDerivativeStorageRelativePath(
  sha256: string,
  variant: Exclude<FileContentVariant, "download">,
  extension: string,
): string {
  const bucket = sha256.slice(0, 2);
  return path.join("blobs", bucket, `${sha256}.${variant}.${extension}`).replaceAll("\\", "/");
}

function toTempStorageRelativePath(storageKey: string): string {
  const normalized = storageKey.replaceAll("\\", "/");
  const dir = path.posix.dirname(normalized);
  const fileName = path.posix.basename(normalized);
  const tempName = `.uploads/${randomUUID()}-${fileName}.tmp`;

  return dir === "." ? tempName : path.posix.join(dir, tempName);
}

function toExtension(originalName: string): string | null {
  const ext = path.extname(originalName).trim().replace(".", "").toLowerCase();
  return ext || null;
}

function buildUploadUrl(uploadId: string): string {
  return `/api/v1/files/upload?uploadId=${encodeURIComponent(uploadId)}`;
}

export class DbFilesRepository implements FilesRepository {
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;
  private readonly objectStorage: ObjectStorageAdapter;
  private readonly imageMetadataService: ImageMetadataService;
  private readonly imageDerivativeService: ImageDerivativeService;

  constructor(databaseConfig: DatabaseConfig, options: DbFilesRepositoryOptions = {}) {
    this.databaseConfig = databaseConfig;
    this.pool = options.pool ?? null;
    this.objectStorage = options.objectStorage ?? new LocalObjectStorageAdapter(options.rootDir ?? process.cwd());
    this.imageMetadataService = new ImageMetadataService();
    this.imageDerivativeService = new ImageDerivativeService();
  }

  async ensureInitialized(): Promise<void> {
    await this.query("select 1 as ok");
  }

  async findBlobBySha256(sha256: string): Promise<FileBlobRecord | null> {
    const result = await this.query<FileBlobDbRow>(
      `
        select ${FILE_BLOB_SELECT_COLUMNS}
        from file_blobs
        where sha256 = $1
        limit 1
      `,
      [sha256],
    );

    return result.rows[0] ? toFileBlobRecord(result.rows[0]) : null;
  }

  async registerFile(
    input: FileRegisterRequest,
  ): Promise<RegisteredFileResult> {
    return this.withTransaction(async (client) => {
      const normalized = this.normalizeRegisterInput(input);
      const existingReadyFile = await this.findExistingReadyFileForRegister(client, normalized);

      if (existingReadyFile) {
        await this.insertFileEvent(client, {
          fileId: existingReadyFile.id,
          blobId: existingReadyFile.blobId,
          uploadId: null,
          actorUserId: existingReadyFile.userId,
          eventType: "file_register_deduplicated_existing_asset",
          payload: {
            sha256: normalized.sha256,
            uploadRequired: false,
          },
        });

        return {
          uploadRequired: false,
          file: toFileResponse(existingReadyFile),
        };
      }

      const existingBlob = await this.findBlobBySha256WithExecutor(client, normalized.sha256);

      if (existingBlob) {
        const fileRecord = await this.insertReadyAssetForBlob(client, normalized, existingBlob);
        await this.insertFileEvent(client, {
          fileId: fileRecord.id,
          blobId: existingBlob.id,
          uploadId: null,
          actorUserId: fileRecord.userId,
          eventType: "file_asset_created_from_existing_blob",
          payload: {
            sha256: normalized.sha256,
            sourceBlobId: existingBlob.id,
            uploadRequired: false,
          },
        });

        return {
          uploadRequired: false,
          file: toFileResponse(fileRecord),
        };
      }

      const existingPendingUpload = await this.findExistingPendingUploadForRegister(
        client,
        normalized,
      );

      if (existingPendingUpload) {
        const pendingFile = await this.findFileRecordByIdWithExecutor(
          client,
          existingPendingUpload.fileId,
        );

        if (!pendingFile) {
          throw new Error("FILE_NOT_FOUND");
        }

        await this.insertFileEvent(client, {
          fileId: pendingFile.id,
          blobId: pendingFile.blobId,
          uploadId: existingPendingUpload.uploadId,
          actorUserId: pendingFile.userId,
          eventType: "file_register_reused_pending_upload",
          payload: {
            sha256: normalized.sha256,
            uploadRequired: true,
          },
        });

        return {
          uploadRequired: true,
          uploadId: existingPendingUpload.uploadId,
          uploadUrl: buildUploadUrl(existingPendingUpload.uploadId),
          file: toFileResponse(pendingFile),
        };
      }

      const pending = await this.insertPendingUpload(client, normalized);
      await this.insertFileEvent(client, {
        fileId: pending.file.id,
        blobId: null,
        uploadId: pending.upload.uploadId,
        actorUserId: pending.file.userId,
        eventType: "file_pending_upload_created",
        payload: {
          sha256: normalized.sha256,
          uploadRequired: true,
        },
      });

      return {
        uploadRequired: true,
        uploadId: pending.upload.uploadId,
        uploadUrl: buildUploadUrl(pending.upload.uploadId),
        file: toFileResponse(pending.file),
      };
    });
  }

  async uploadFile(
    uploadId: string,
    content: Buffer | Uint8Array | string,
  ): Promise<UploadedFileResult> {
    const pendingUpload = await this.findPendingUploadById(uploadId);

    if (!pendingUpload) {
      throw new Error("UPLOAD_NOT_FOUND");
    }

    const fileRecord = await this.findFileRecordById(pendingUpload.fileId);

    if (!fileRecord) {
      throw new Error("FILE_NOT_FOUND");
    }

    const buffer = this.normalizeUploadContent(content);
    const computedSha256 = createHash("sha256").update(buffer).digest("hex");

    if (computedSha256 !== pendingUpload.sha256) {
      throw new Error("FILE_HASH_MISMATCH");
    }

    const existingBlob = await this.findBlobBySha256(pendingUpload.sha256);
    const writeTracker = new ObjectWriteTracker();

    try {
      const preparedBlob = await this.buildBlobPayloadFromUpload(
        pendingUpload,
        buffer,
        existingBlob,
        writeTracker,
      );

      const result = await this.withTransaction(async (client) => {
        await this.lockFileBlobSha256(client, pendingUpload.sha256);
        const pendingUploadInTransaction = await this.findPendingUploadByIdWithExecutor(
          client,
          uploadId,
        );

        if (!pendingUploadInTransaction) {
          throw new Error("UPLOAD_NOT_FOUND");
        }

        const fileRecordInTransaction = await this.findFileRecordByIdWithExecutor(
          client,
          pendingUploadInTransaction.fileId,
        );

        if (!fileRecordInTransaction) {
          throw new Error("FILE_NOT_FOUND");
        }

        try {
          await this.publishStagedObjects(writeTracker);
          const blob = await this.upsertBlobRecord(client, preparedBlob);
          await this.upsertBlobVariants(client, blob);
          const uploadedFile = await this.completeUploadRecord(
            client,
            pendingUploadInTransaction,
            blob,
          );
          await this.insertFileEvent(client, {
            fileId: uploadedFile.id,
            blobId: blob.id,
            uploadId,
            actorUserId: uploadedFile.userId,
            eventType: "file_upload_completed",
            payload: {
              sha256: blob.sha256,
              storageProvider: blob.storageProvider,
              storageKey: blob.storageKey,
              previewReady: uploadedFile.previewReady,
              thumbnailReady: uploadedFile.thumbnailReady,
            },
          });

          return {
            uploadId,
            file: toFileResponse(uploadedFile),
          };
        } catch (error) {
          await writeTracker.cleanupPublishedFinals(this.objectStorage);
          throw error;
        }
      });

      await writeTracker.cleanupTemps(this.objectStorage);
      return result;
    } catch (error) {
      await writeTracker.cleanupTemps(this.objectStorage);
      throw error;
    }
  }

  async findFileById(
    fileId: string,
  ): Promise<FileAssetResponse | null> {
    const record = await this.findFileRecordById(fileId);
    return record ? toFileResponse(record) : null;
  }

  async findFileRecordById(
    fileId: string,
  ): Promise<FileAssetRecord | null> {
    return this.findFileRecordByIdWithExecutor(this, fileId);
  }

  async findPendingUploadById(
    uploadId: string,
  ): Promise<PendingUploadRecord | null> {
    const result = await this.query<PendingUploadDbRow>(
      `
        select ${PENDING_UPLOAD_SELECT_COLUMNS}
        from file_uploads
        where id = $1 and status = 'pending'
        limit 1
      `,
      [uploadId],
    );

    return result.rows[0] ? toPendingUploadRecord(result.rows[0]) : null;
  }

  async findReadyFilesByIds(
    fileIds: string[],
  ): Promise<FileAssetResponse[]> {
    const files = await this.findFileRecordsByIds(fileIds, {
      onlyReady: true,
    });
    return files.map(toFileResponse);
  }

  async findFilesByIds(
    fileIds: string[],
  ): Promise<FileAssetResponse[]> {
    const files = await this.findFileRecordsByIds(fileIds);
    return files.map(toFileResponse);
  }

  async readFileContent(
    fileId: string,
    variant: FileContentVariant = "download",
  ): Promise<FileContentReadResult | null> {
    const fileRecord = await this.findFileRecordById(fileId);

    if (!fileRecord || !fileRecord.blobId || fileRecord.status !== "ready") {
      return null;
    }

    let blob = await this.findBlobById(fileRecord.blobId);

    if (!blob) {
      return null;
    }

    if (variant !== "download") {
      if (fileRecord.fileType !== "image") {
        return null;
      }

      blob = await this.ensureImageVariantReady(fileRecord, blob, variant);
      return this.readBlobVariantContent(blob, variant);
    }

    return this.readStorageContent(blob.storageKey, blob.mimeType, blob.sha256);
  }

  async query<T extends DbQueryRow = DbQueryRow>(
    text: string,
    values?: readonly unknown[],
  ) {
    if (this.pool) {
      return this.pool.query<T>(text, values);
    }

    return queryPostgres<T>(this.databaseConfig, text, values);
  }

  private normalizeRegisterInput(input: FileRegisterRequest) {
    const fileType = input.fileType ?? "image";
    const sourceType = input.sourceType ?? "input";

    return {
      userId: input.userId ?? null,
      sha256: input.sha256,
      size: input.size,
      mimeType: input.mimeType,
      originalName: input.originalName,
      displayName: input.displayName ?? input.originalName,
      fileType,
      sourceType,
      extension: toExtension(input.originalName),
      width: input.width ?? null,
      height: input.height ?? null,
      duration: input.duration ?? null,
    };
  }

  private async withTransaction<T>(
    callback: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withTransaction(this.pool ?? this.databaseConfig, callback);
  }

  private async findBlobBySha256WithExecutor(
    executor: QueryExecutor,
    sha256: string,
  ): Promise<FileBlobRecord | null> {
    const result = await executor.query<FileBlobDbRow>(
      `
        select ${FILE_BLOB_SELECT_COLUMNS}
        from file_blobs
        where sha256 = $1
        limit 1
      `,
      [sha256],
    );

    return result.rows[0] ? toFileBlobRecord(result.rows[0]) : null;
  }

  private async findBlobById(blobId: string): Promise<FileBlobRecord | null> {
    const result = await this.query<FileBlobDbRow>(
      `
        select ${FILE_BLOB_SELECT_COLUMNS}
        from file_blobs
        where id = $1
        limit 1
      `,
      [blobId],
    );

    return result.rows[0] ? toFileBlobRecord(result.rows[0]) : null;
  }

  private async findPendingUploadByIdWithExecutor(
    executor: QueryExecutor,
    uploadId: string,
  ): Promise<PendingUploadRecord | null> {
    const result = await executor.query<PendingUploadDbRow>(
      `
        select ${PENDING_UPLOAD_SELECT_COLUMNS}
        from file_uploads
        where id = $1 and status = 'pending'
        limit 1
      `,
      [uploadId],
    );

    return result.rows[0] ? toPendingUploadRecord(result.rows[0]) : null;
  }

  private async findFileRecordByIdWithExecutor(
    executor: QueryExecutor,
    fileId: string,
  ): Promise<FileAssetRecord | null> {
    const result = await executor.query<FileAssetDbRow>(
      `
        select ${FILE_ASSET_SELECT_COLUMNS}
        from file_assets
        where id = $1 and status in ('pending_upload', 'ready')
        limit 1
      `,
      [fileId],
    );

    return result.rows[0] ? toFileAssetRecord(result.rows[0]) : null;
  }

  private async findFileRecordsByIds(
    fileIds: string[],
    options?: {
      onlyReady?: boolean;
    },
  ): Promise<FileAssetRecord[]> {
    if (fileIds.length === 0) {
      return [];
    }

    const result = await this.query<FileAssetDbRow>(
      `
        select ${FILE_ASSET_SELECT_COLUMNS}
        from file_assets
        where id = any($1::uuid[])
          and status = any($2::text[])
      `,
      [
        fileIds,
        options?.onlyReady ? ["ready"] : ["pending_upload", "ready"],
      ],
    );
    const recordsById = new Map(
      result.rows.map((row) => {
        const record = toFileAssetRecord(row);
        return [record.id, record];
      }),
    );

    return fileIds
      .map((fileId) => recordsById.get(fileId))
      .filter((record): record is FileAssetRecord => Boolean(record));
  }

  private async findExistingReadyFileForRegister(
    executor: QueryExecutor,
    input: ReturnType<DbFilesRepository["normalizeRegisterInput"]>,
  ): Promise<FileAssetRecord | null> {
    const result = await executor.query<FileAssetDbRow>(
      `
        select ${FILE_ASSET_SELECT_COLUMNS}
        from file_assets
        where user_id is not distinct from $1
          and sha256 = $2
          and file_type = $3
          and source_type = $4
          and status = 'ready'
          and blob_id is not null
        order by created_at asc
        limit 1
      `,
      [input.userId, input.sha256, input.fileType, input.sourceType],
    );

    return result.rows[0] ? toFileAssetRecord(result.rows[0]) : null;
  }

  private async findExistingPendingUploadForRegister(
    executor: QueryExecutor,
    input: ReturnType<DbFilesRepository["normalizeRegisterInput"]>,
  ): Promise<PendingUploadRecord | null> {
    const result = await executor.query<PendingUploadDbRow>(
      `
        select ${PENDING_UPLOAD_SELECT_COLUMNS}
        from file_uploads
        where user_id is not distinct from $1
          and sha256 = $2
          and file_type = $3
          and source_type = $4
          and status = 'pending'
          and size = $5
          and mime_type = $6
        order by created_at asc
        limit 1
      `,
      [
        input.userId,
        input.sha256,
        input.fileType,
        input.sourceType,
        input.size,
        input.mimeType,
      ],
    );

    return result.rows[0] ? toPendingUploadRecord(result.rows[0]) : null;
  }

  private async insertReadyAssetForBlob(
    executor: QueryExecutor,
    input: ReturnType<DbFilesRepository["normalizeRegisterInput"]>,
    blob: FileBlobRecord,
  ): Promise<FileAssetRecord> {
    const result = await executor.query<FileAssetDbRow>(
      `
        insert into file_assets (
          id,
          user_id,
          blob_id,
          original_name,
          display_name,
          mime_type,
          file_type,
          source_type,
          status,
          pending_upload_id,
          sha256,
          size,
          extension,
          width,
          height,
          duration,
          preview_ready,
          preview_width,
          preview_height,
          thumbnail_ready,
          thumbnail_width,
          thumbnail_height
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, 'ready', null,
          $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )
        returning ${FILE_ASSET_SELECT_COLUMNS}
      `,
      [
        randomUUID(),
        input.userId,
        blob.id,
        input.originalName,
        input.displayName,
        input.mimeType,
        input.fileType,
        input.sourceType,
        blob.sha256,
        blob.size,
        blob.extension,
        blob.width,
        blob.height,
        blob.duration,
        input.fileType === "image" && blob.previewStorageKey !== null,
        blob.previewWidth,
        blob.previewHeight,
        input.fileType === "image" && blob.thumbnailStorageKey !== null,
        blob.thumbnailWidth,
        blob.thumbnailHeight,
      ],
    );

    return toFileAssetRecord(result.rows[0]!);
  }

  private async insertPendingUpload(
    executor: QueryExecutor,
    input: ReturnType<DbFilesRepository["normalizeRegisterInput"]>,
  ): Promise<{
    file: FileAssetRecord;
    upload: PendingUploadRecord;
  }> {
    const uploadId = randomUUID();
    const fileResult = await executor.query<FileAssetDbRow>(
      `
        insert into file_assets (
          id,
          user_id,
          blob_id,
          original_name,
          display_name,
          mime_type,
          file_type,
          source_type,
          status,
          pending_upload_id,
          sha256,
          size,
          extension,
          width,
          height,
          duration,
          preview_ready,
          preview_width,
          preview_height,
          thumbnail_ready,
          thumbnail_width,
          thumbnail_height
        )
        values (
          $1, $2, null, $3, $4, $5, $6, $7, 'pending_upload', $8,
          $9, $10, $11, $12, $13, $14, false, null, null, false, null, null
        )
        returning ${FILE_ASSET_SELECT_COLUMNS}
      `,
      [
        randomUUID(),
        input.userId,
        input.originalName,
        input.displayName,
        input.mimeType,
        input.fileType,
        input.sourceType,
        uploadId,
        input.sha256,
        input.size,
        input.extension,
        input.width,
        input.height,
        input.duration,
      ],
    );
    const file = toFileAssetRecord(fileResult.rows[0]!);
    const uploadResult = await executor.query<PendingUploadDbRow>(
      `
        insert into file_uploads (
          id,
          file_id,
          user_id,
          sha256,
          size,
          mime_type,
          original_name,
          display_name,
          file_type,
          source_type,
          width,
          height,
          duration,
          status
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending'
        )
        returning ${PENDING_UPLOAD_SELECT_COLUMNS}
      `,
      [
        uploadId,
        file.id,
        input.userId,
        input.sha256,
        input.size,
        input.mimeType,
        input.originalName,
        input.displayName,
        input.fileType,
        input.sourceType,
        input.width,
        input.height,
        input.duration,
      ],
    );

    return {
      file,
      upload: toPendingUploadRecord(uploadResult.rows[0]!),
    };
  }

  private normalizeUploadContent(content: Buffer | Uint8Array | string): Buffer {
    if (typeof content === "string") {
      return Buffer.from(content, "base64");
    }

    return Buffer.isBuffer(content) ? content : Buffer.from(content);
  }

  private async buildBlobPayloadFromUpload(
    pendingUpload: PendingUploadRecord,
    buffer: Buffer,
    existingBlob: FileBlobRecord | null,
    writeTracker: ObjectWriteTracker,
  ): Promise<PreparedBlobPayload> {
    const extension = toExtension(pendingUpload.originalName);
    const storageKey = existingBlob?.storageKey ?? toBlobStorageRelativePath(pendingUpload.sha256, extension);
    const shouldWriteOriginal = !existingBlob || !(await this.objectStorage.exists(existingBlob.storageKey));

    if (shouldWriteOriginal) {
      await this.writeContentAddressedObject(storageKey, buffer, writeTracker);
    }

    const imageMetadata = pendingUpload.fileType === "image"
      ? await this.imageMetadataService.extract(buffer)
      : null;
    const imageDerivatives = pendingUpload.fileType === "image"
      ? await this.imageDerivativeService.generate(buffer)
      : null;
    const derivativePaths = imageDerivatives
      ? await this.writeDerivativeFiles(pendingUpload.sha256, imageDerivatives, writeTracker)
      : null;

    return {
      sha256: pendingUpload.sha256,
      size: buffer.length,
      mimeType: pendingUpload.mimeType,
      storageKey,
      storageProvider: this.objectStorage.provider,
      extension,
      width: imageMetadata?.width ?? pendingUpload.width ?? existingBlob?.width ?? null,
      height: imageMetadata?.height ?? pendingUpload.height ?? existingBlob?.height ?? null,
      duration: pendingUpload.duration ?? existingBlob?.duration ?? null,
      previewStorageKey: derivativePaths?.preview.storageKey ?? existingBlob?.previewStorageKey ?? null,
      previewMimeType: imageDerivatives?.preview.mimeType ?? existingBlob?.previewMimeType ?? null,
      previewSize: imageDerivatives?.preview.buffer.length ?? existingBlob?.previewSize ?? null,
      previewWidth: imageDerivatives?.preview.width ?? existingBlob?.previewWidth ?? null,
      previewHeight: imageDerivatives?.preview.height ?? existingBlob?.previewHeight ?? null,
      thumbnailStorageKey: derivativePaths?.thumbnail.storageKey ?? existingBlob?.thumbnailStorageKey ?? null,
      thumbnailMimeType: imageDerivatives?.thumbnail.mimeType ?? existingBlob?.thumbnailMimeType ?? null,
      thumbnailSize: imageDerivatives?.thumbnail.buffer.length ?? existingBlob?.thumbnailSize ?? null,
      thumbnailWidth: imageDerivatives?.thumbnail.width ?? existingBlob?.thumbnailWidth ?? null,
      thumbnailHeight: imageDerivatives?.thumbnail.height ?? existingBlob?.thumbnailHeight ?? null,
    };
  }

  private async writeDerivativeFiles(
    sha256: string,
    derivatives: Awaited<ReturnType<ImageDerivativeService["generate"]>>,
    writeTracker: ObjectWriteTracker,
  ): Promise<{
    thumbnail: { storageKey: string };
    preview: { storageKey: string };
  } | null> {
    if (!derivatives) {
      return null;
    }

    const thumbnailStorageKey = toDerivativeStorageRelativePath(
      sha256,
      "thumbnail",
      derivatives.thumbnail.extension,
    );
    const previewStorageKey = toDerivativeStorageRelativePath(
      sha256,
      "preview",
      derivatives.preview.extension,
    );

    await Promise.all([
      this.writeContentAddressedObject(thumbnailStorageKey, derivatives.thumbnail.buffer, writeTracker),
      this.writeContentAddressedObject(previewStorageKey, derivatives.preview.buffer, writeTracker),
    ]);

    return {
      thumbnail: {
        storageKey: thumbnailStorageKey,
      },
      preview: {
        storageKey: previewStorageKey,
      },
    };
  }

  private async upsertBlobRecord(
    executor: QueryExecutor,
    input: PreparedBlobPayload,
  ): Promise<FileBlobRecord> {
    const result = await executor.query<FileBlobDbRow>(
      `
        insert into file_blobs (
          sha256,
          size,
          mime_type,
          storage_key,
          storage_provider,
          preview_storage_key,
          preview_mime_type,
          preview_size,
          preview_width,
          preview_height,
          thumbnail_storage_key,
          thumbnail_mime_type,
          thumbnail_size,
          thumbnail_width,
          thumbnail_height,
          extension,
          width,
          height,
          duration
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        on conflict (sha256) do update set
          size = excluded.size,
          mime_type = excluded.mime_type,
          storage_key = excluded.storage_key,
          storage_provider = excluded.storage_provider,
          preview_storage_key = coalesce(excluded.preview_storage_key, file_blobs.preview_storage_key),
          preview_mime_type = coalesce(excluded.preview_mime_type, file_blobs.preview_mime_type),
          preview_size = coalesce(excluded.preview_size, file_blobs.preview_size),
          preview_width = coalesce(excluded.preview_width, file_blobs.preview_width),
          preview_height = coalesce(excluded.preview_height, file_blobs.preview_height),
          thumbnail_storage_key = coalesce(excluded.thumbnail_storage_key, file_blobs.thumbnail_storage_key),
          thumbnail_mime_type = coalesce(excluded.thumbnail_mime_type, file_blobs.thumbnail_mime_type),
          thumbnail_size = coalesce(excluded.thumbnail_size, file_blobs.thumbnail_size),
          thumbnail_width = coalesce(excluded.thumbnail_width, file_blobs.thumbnail_width),
          thumbnail_height = coalesce(excluded.thumbnail_height, file_blobs.thumbnail_height),
          extension = coalesce(excluded.extension, file_blobs.extension),
          width = coalesce(excluded.width, file_blobs.width),
          height = coalesce(excluded.height, file_blobs.height),
          duration = coalesce(excluded.duration, file_blobs.duration),
          updated_at = now()
        returning ${FILE_BLOB_SELECT_COLUMNS}
      `,
      [
        input.sha256,
        input.size,
        input.mimeType,
        input.storageKey,
        input.storageProvider,
        input.previewStorageKey,
        input.previewMimeType,
        input.previewSize,
        input.previewWidth,
        input.previewHeight,
        input.thumbnailStorageKey,
        input.thumbnailMimeType,
        input.thumbnailSize,
        input.thumbnailWidth,
        input.thumbnailHeight,
        input.extension,
        input.width,
        input.height,
        input.duration,
      ],
    );

    return toFileBlobRecord(result.rows[0]!);
  }

  private async upsertBlobVariants(
    executor: QueryExecutor,
    blob: FileBlobRecord,
  ): Promise<void> {
    await this.upsertBlobVariant(executor, {
      blobId: blob.id,
      variant: "original",
      storageProvider: blob.storageProvider,
      storageKey: blob.storageKey,
      mimeType: blob.mimeType,
      size: blob.size,
      extension: blob.extension,
      width: blob.width,
      height: blob.height,
      duration: blob.duration,
    });

    if (blob.previewStorageKey && blob.previewMimeType) {
      await this.upsertBlobVariant(executor, {
        blobId: blob.id,
        variant: "preview",
        storageProvider: blob.storageProvider,
        storageKey: blob.previewStorageKey,
        mimeType: blob.previewMimeType,
        size: blob.previewSize,
        extension: this.extensionFromStorageKey(blob.previewStorageKey),
        width: blob.previewWidth,
        height: blob.previewHeight,
        duration: null,
      });
    }

    if (blob.thumbnailStorageKey && blob.thumbnailMimeType) {
      await this.upsertBlobVariant(executor, {
        blobId: blob.id,
        variant: "thumbnail",
        storageProvider: blob.storageProvider,
        storageKey: blob.thumbnailStorageKey,
        mimeType: blob.thumbnailMimeType,
        size: blob.thumbnailSize,
        extension: this.extensionFromStorageKey(blob.thumbnailStorageKey),
        width: blob.thumbnailWidth,
        height: blob.thumbnailHeight,
        duration: null,
      });
    }
  }

  private async upsertBlobVariant(
    executor: QueryExecutor,
    input: {
      blobId: string;
      variant: "original" | "preview" | "thumbnail";
      storageProvider: string;
      storageKey: string;
      mimeType: string;
      size: number | null;
      extension: string | null;
      width: number | null;
      height: number | null;
      duration: number | null;
    },
  ): Promise<void> {
    await executor.query(
      `
        insert into file_blob_variants (
          blob_id,
          variant,
          variant_key,
          storage_provider,
          storage_key,
          mime_type,
          size,
          extension,
          width,
          height,
          duration,
          metadata
        )
        values ($1, $2, 'default', $3, $4, $5, $6, $7, $8, $9, $10, '{}'::jsonb)
        on conflict (blob_id, variant, variant_key) do update set
          storage_provider = excluded.storage_provider,
          storage_key = excluded.storage_key,
          mime_type = excluded.mime_type,
          size = excluded.size,
          extension = excluded.extension,
          width = excluded.width,
          height = excluded.height,
          duration = excluded.duration,
          updated_at = now()
      `,
      [
        input.blobId,
        input.variant,
        input.storageProvider,
        input.storageKey,
        input.mimeType,
        input.size,
        input.extension,
        input.width,
        input.height,
        input.duration,
      ],
    );
  }

  private async completeUploadRecord(
    executor: QueryExecutor,
    pendingUpload: PendingUploadRecord,
    blob: FileBlobRecord,
  ): Promise<FileAssetRecord> {
    const result = await executor.query<FileAssetDbRow>(
      `
        update file_assets
        set
          blob_id = $1,
          status = 'ready',
          pending_upload_id = null,
          sha256 = $2,
          size = $3,
          extension = $4,
          width = $5,
          height = $6,
          duration = $7,
          preview_ready = $8,
          preview_width = $9,
          preview_height = $10,
          thumbnail_ready = $11,
          thumbnail_width = $12,
          thumbnail_height = $13,
          updated_at = now()
        where id = $14
          and status = 'pending_upload'
        returning ${FILE_ASSET_SELECT_COLUMNS}
      `,
      [
        blob.id,
        blob.sha256,
        blob.size,
        blob.extension,
        blob.width,
        blob.height,
        blob.duration,
        pendingUpload.fileType === "image" && blob.previewStorageKey !== null,
        blob.previewWidth,
        blob.previewHeight,
        pendingUpload.fileType === "image" && blob.thumbnailStorageKey !== null,
        blob.thumbnailWidth,
        blob.thumbnailHeight,
        pendingUpload.fileId,
      ],
    );

    if (!result.rows[0]) {
      throw new Error("FILE_NOT_FOUND");
    }

    await executor.query(
      `
        update file_uploads
        set
          status = 'completed',
          completed_at = now(),
          error_code = null,
          error_message = null
        where id = $1
      `,
      [pendingUpload.uploadId],
    );

    return toFileAssetRecord(result.rows[0]);
  }

  private async ensureImageVariantReady(
    fileRecord: FileAssetRecord,
    blob: FileBlobRecord,
    variant: Exclude<FileContentVariant, "download">,
  ): Promise<FileBlobRecord> {
    if (
      (variant === "preview" && blob.previewStorageKey !== null) ||
      (variant === "thumbnail" && blob.thumbnailStorageKey !== null)
    ) {
      return blob;
    }

    const original = await this.objectStorage.read(blob.storageKey);
    const prepared = await this.buildBlobPayloadFromExistingBlob(blob, original.buffer);

    try {
      const result = await this.withTransaction(async (client) => {
        await this.lockFileBlobSha256(client, blob.sha256);

        try {
          await this.publishStagedObjects(prepared.writeTracker);
          const updatedBlob = await this.upsertBlobRecord(client, prepared.blob);
          await this.upsertBlobVariants(client, updatedBlob);
          await this.syncReadyAssetsForBlob(client, updatedBlob);
          await this.insertFileEvent(client, {
            fileId: fileRecord.id,
            blobId: updatedBlob.id,
            uploadId: null,
            actorUserId: fileRecord.userId,
            eventType: "file_blob_variants_backfilled",
            payload: {
              sha256: updatedBlob.sha256,
              requestedVariant: variant,
              previewReady: updatedBlob.previewStorageKey !== null,
              thumbnailReady: updatedBlob.thumbnailStorageKey !== null,
            },
          });

          return updatedBlob;
        } catch (error) {
          await prepared.writeTracker.cleanupPublishedFinals(this.objectStorage);
          throw error;
        }
      });

      await prepared.writeTracker.cleanupTemps(this.objectStorage);
      return result;
    } catch (error) {
      await prepared.writeTracker.cleanupTemps(this.objectStorage);
      throw error;
    }
  }

  private async buildBlobPayloadFromExistingBlob(
    blob: FileBlobRecord,
    buffer: Buffer,
  ): Promise<PreparedBlobWithWrites> {
    const writeTracker = new ObjectWriteTracker();
    const imageMetadata = await this.imageMetadataService.extract(buffer);
    const imageDerivatives = await this.imageDerivativeService.generate(buffer);
    const derivativePaths = imageDerivatives
      ? await this.writeDerivativeFiles(blob.sha256, imageDerivatives, writeTracker)
      : null;

    return {
      blob: {
        sha256: blob.sha256,
        size: blob.size,
        mimeType: blob.mimeType,
        storageKey: blob.storageKey,
        storageProvider: blob.storageProvider,
        extension: blob.extension,
        width: imageMetadata?.width ?? blob.width,
        height: imageMetadata?.height ?? blob.height,
        duration: blob.duration,
        previewStorageKey: derivativePaths?.preview.storageKey ?? blob.previewStorageKey,
        previewMimeType: imageDerivatives?.preview.mimeType ?? blob.previewMimeType,
        previewSize: imageDerivatives?.preview.buffer.length ?? blob.previewSize,
        previewWidth: imageDerivatives?.preview.width ?? blob.previewWidth,
        previewHeight: imageDerivatives?.preview.height ?? blob.previewHeight,
        thumbnailStorageKey: derivativePaths?.thumbnail.storageKey ?? blob.thumbnailStorageKey,
        thumbnailMimeType: imageDerivatives?.thumbnail.mimeType ?? blob.thumbnailMimeType,
        thumbnailSize: imageDerivatives?.thumbnail.buffer.length ?? blob.thumbnailSize,
        thumbnailWidth: imageDerivatives?.thumbnail.width ?? blob.thumbnailWidth,
        thumbnailHeight: imageDerivatives?.thumbnail.height ?? blob.thumbnailHeight,
      },
      writeTracker,
    };
  }

  private async syncReadyAssetsForBlob(
    executor: QueryExecutor,
    blob: FileBlobRecord,
  ): Promise<void> {
    await executor.query(
      `
        update file_assets
        set
          width = $2,
          height = $3,
          duration = $4,
          preview_ready = file_type = 'image' and $5,
          preview_width = $6,
          preview_height = $7,
          thumbnail_ready = file_type = 'image' and $8,
          thumbnail_width = $9,
          thumbnail_height = $10,
          updated_at = now()
        where blob_id = $1
          and status = 'ready'
      `,
      [
        blob.id,
        blob.width,
        blob.height,
        blob.duration,
        blob.previewStorageKey !== null,
        blob.previewWidth,
        blob.previewHeight,
        blob.thumbnailStorageKey !== null,
        blob.thumbnailWidth,
        blob.thumbnailHeight,
      ],
    );
  }

  private async readBlobVariantContent(
    blob: FileBlobRecord,
    variant: Exclude<FileContentVariant, "download">,
  ): Promise<FileContentReadResult | null> {
    const storageKey = variant === "preview" ? blob.previewStorageKey : blob.thumbnailStorageKey;
    const mimeType = variant === "preview" ? blob.previewMimeType : blob.thumbnailMimeType;

    if (!storageKey || !mimeType) {
      return null;
    }

    return this.readStorageContent(storageKey, mimeType, blob.sha256);
  }

  private async readStorageContent(
    storageKey: string,
    mimeType: string,
    blobSha256: string,
  ): Promise<FileContentReadResult> {
    const result = await this.objectStorage.read(storageKey);

    return {
      buffer: result.buffer,
      mimeType,
      byteLength: result.byteLength,
      storageKey: result.storageKey,
      blobSha256,
      lastModifiedAt: result.lastModifiedAt,
    };
  }

  private extensionFromStorageKey(storageKey: string): string | null {
    const extension = path.extname(storageKey).trim().replace(".", "").toLowerCase();
    return extension || null;
  }

  private async writeContentAddressedObject(
    storageKey: string,
    buffer: Buffer | Uint8Array,
    writeTracker: ObjectWriteTracker,
  ): Promise<void> {
    if (await this.objectStorage.exists(storageKey)) {
      return;
    }

    const tempStorageKey = toTempStorageRelativePath(storageKey);
    await this.objectStorage.write(tempStorageKey, buffer);
    writeTracker.addStagedWrite({
      tempStorageKey,
      finalStorageKey: storageKey,
    });
  }

  private async publishStagedObjects(writeTracker: ObjectWriteTracker): Promise<void> {
    for (const write of writeTracker.stagedWrites) {
      if (await this.objectStorage.exists(write.finalStorageKey)) {
        continue;
      }

      await this.objectStorage.copyIfMissing(write.tempStorageKey, write.finalStorageKey);
      writeTracker.addPublishedFinalStorageKey(write.finalStorageKey);
    }
  }

  private async lockFileBlobSha256(
    executor: QueryExecutor,
    sha256: string,
  ): Promise<void> {
    await executor.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [sha256],
    );
  }

  private async insertFileEvent(
    executor: QueryExecutor,
    input: {
      fileId: string | null;
      blobId: string | null;
      uploadId: string | null;
      actorUserId: string | null;
      eventType: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await executor.query(
      `
        insert into file_events (
          file_id,
          blob_id,
          upload_id,
          actor_user_id,
          event_type,
          payload
        )
        values ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        input.fileId,
        input.blobId,
        input.uploadId,
        input.actorUserId,
        input.eventType,
        JSON.stringify(input.payload),
      ],
    );
  }
}
