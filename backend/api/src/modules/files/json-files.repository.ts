import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  FileAssetResponse,
  FileRegisterRequest,
} from "@newworkflow/backend-shared/api";
import { ImageDerivativeService } from "./image-derivative.service.ts";
import { ImageMetadataService } from "./image-metadata.service.ts";
import type {
  FileAssetRecord,
  FileBlobRecord,
  FileContentReadResult,
  FileContentStreamResult,
  FileContentVariant,
  FilesRepository,
  FileStore,
  PendingUploadRecord,
  RegisteredFileResult,
  UploadedFileResult,
} from "./files.repository.types.ts";

function toExtension(originalName: string): string | null {
  const ext = path.extname(originalName).trim().replace(".", "").toLowerCase();
  return ext || null;
}

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

function toFileResponse(record: FileAssetRecord): FileAssetResponse {
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

export class JsonFilesRepository implements FilesRepository {
  private readonly dataDir: string;
  private readonly filesDataDir: string;
  private readonly storePath: string;
  private readonly lockPath: string;
  private readonly blobDir: string;
  private readonly storageDir: string;
  private readonly lockRetryDelayMs = 25;
  private readonly lockTimeoutMs = 5_000;
  private readonly staleLockThresholdMs = 30_000;
  private readonly unlockRetryCount = 3;
  private readonly imageMetadataService: ImageMetadataService;
  private readonly imageDerivativeService: ImageDerivativeService;

  constructor(rootDir: string) {
    this.dataDir = path.join(rootDir, "data");
    this.filesDataDir = path.join(this.dataDir, "files");
    this.storePath = path.join(this.filesDataDir, "files-store.json");
    this.lockPath = path.join(this.filesDataDir, "files-store.lock");
    this.storageDir = path.join(rootDir, "storage");
    this.blobDir = path.join(rootDir, "storage", "blobs");
    this.imageMetadataService = new ImageMetadataService();
    this.imageDerivativeService = new ImageDerivativeService();
  }

  async ensureInitialized(): Promise<void> {
    await this.withStoreLock(async () => {
      await this.ensureInitializedUnsafe();
    });
  }

  async findBlobBySha256(sha256: string): Promise<FileBlobRecord | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return store.blobs.find((blob) => blob.sha256 === sha256) ?? null;
    });
  }

  async registerFile(input: FileRegisterRequest): Promise<RegisteredFileResult> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const existingBlobCandidate = store.blobs.find((blob) => blob.sha256 === input.sha256);
      const existingBlob = existingBlobCandidate && await this.isBlobOriginalContentAvailable(existingBlobCandidate)
        ? existingBlobCandidate
        : null;
      const existingReadyFileCandidate = store.files.find((file) =>
        file.userId === (input.userId ?? null)
        && file.sha256 === input.sha256
        && file.fileType === (input.fileType ?? "image")
        && file.sourceType === (input.sourceType ?? "input")
        && file.status === "ready"
      );
      const existingReadyFile = existingReadyFileCandidate && existingReadyFileCandidate.blobId
        ? await this.resolveReusableReadyFile(store, existingReadyFileCandidate)
        : null;

      if (existingReadyFile) {
        return {
          uploadRequired: false,
          file: toFileResponse(existingReadyFile),
        };
      }

      const existingPendingFile = store.files.find((file) =>
        file.userId === (input.userId ?? null)
        && file.sha256 === input.sha256
        && file.fileType === (input.fileType ?? "image")
        && file.sourceType === (input.sourceType ?? "input")
        && file.size === input.size
        && file.mimeType === input.mimeType
        && file.status === "pending_upload"
        && file.pendingUploadId
      );

      if (existingPendingFile) {
        return {
          uploadRequired: true,
          uploadId: existingPendingFile.pendingUploadId ?? undefined,
          uploadUrl: existingPendingFile.pendingUploadId
            ? `/api/v1/files/upload?uploadId=${encodeURIComponent(existingPendingFile.pendingUploadId)}`
            : undefined,
          file: toFileResponse(existingPendingFile),
        };
      }

      if (existingBlob) {
        const fileRecord: FileAssetRecord = {
          id: randomUUID(),
          userId: input.userId ?? null,
          blobId: existingBlob.id,
          originalName: input.originalName,
          displayName: input.displayName ?? input.originalName,
          mimeType: input.mimeType,
          fileType: input.fileType ?? "image",
          sourceType: input.sourceType ?? "input",
          status: "ready",
          pendingUploadId: null,
          sha256: existingBlob.sha256,
          size: existingBlob.size,
          extension: existingBlob.extension,
          width: existingBlob.width,
          height: existingBlob.height,
          duration: existingBlob.duration,
          previewReady: input.fileType === "image" && existingBlob.previewStorageKey !== null,
          previewWidth: existingBlob.previewWidth,
          previewHeight: existingBlob.previewHeight,
          thumbnailReady: input.fileType === "image" && existingBlob.thumbnailStorageKey !== null,
          thumbnailWidth: existingBlob.thumbnailWidth,
          thumbnailHeight: existingBlob.thumbnailHeight,
          createdAt: new Date().toISOString(),
        };

        store.files.push(fileRecord);
        await this.writeStoreUnsafe(store);

        return {
          uploadRequired: false,
          file: toFileResponse(fileRecord),
        };
      }

      const uploadId = randomUUID();
      const fileRecord: FileAssetRecord = {
        id: randomUUID(),
        userId: input.userId ?? null,
        blobId: null,
        originalName: input.originalName,
        displayName: input.displayName ?? input.originalName,
        mimeType: input.mimeType,
        fileType: input.fileType ?? "image",
        sourceType: input.sourceType ?? "input",
        status: "pending_upload",
        pendingUploadId: uploadId,
        sha256: input.sha256,
        size: input.size,
        extension: toExtension(input.originalName),
        width: input.width ?? null,
        height: input.height ?? null,
        duration: input.duration ?? null,
        previewReady: false,
        previewWidth: null,
        previewHeight: null,
        thumbnailReady: false,
        thumbnailWidth: null,
        thumbnailHeight: null,
        createdAt: new Date().toISOString(),
      };

      store.files.push(fileRecord);
      store.pendingUploads.push({
        uploadId,
        fileId: fileRecord.id,
        userId: input.userId ?? null,
        sha256: input.sha256,
        size: input.size,
        mimeType: input.mimeType,
        originalName: input.originalName,
        displayName: input.displayName ?? input.originalName,
        fileType: input.fileType ?? "image",
        sourceType: input.sourceType ?? "input",
        width: input.width ?? null,
        height: input.height ?? null,
        duration: input.duration ?? null,
        createdAt: new Date().toISOString(),
      });

      await this.writeStoreUnsafe(store);

      return {
        uploadRequired: true,
        uploadId,
        uploadUrl: `/api/v1/files/upload?uploadId=${encodeURIComponent(uploadId)}`,
        file: toFileResponse(fileRecord),
      };
    });
  }

  async uploadFile(
    uploadId: string,
    content: Buffer | Uint8Array | string,
  ): Promise<UploadedFileResult> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const pendingUpload = store.pendingUploads.find((item) => item.uploadId === uploadId);

      if (!pendingUpload) {
        throw new Error("UPLOAD_NOT_FOUND");
      }

      const fileRecord = store.files.find((file) => file.id === pendingUpload.fileId);

      if (!fileRecord) {
        throw new Error("FILE_NOT_FOUND");
      }

      const buffer = typeof content === "string"
        ? Buffer.from(content, "base64")
        : Buffer.isBuffer(content)
          ? content
          : Buffer.from(content);
      const computedSha256 = createHash("sha256").update(buffer).digest("hex");

      if (computedSha256 !== pendingUpload.sha256) {
        throw new Error("FILE_HASH_MISMATCH");
      }

      let blob = store.blobs.find((item) => item.sha256 === pendingUpload.sha256);
      const canReuseBlob = blob
        ? await this.isBlobOriginalContentAvailable(blob)
        : false;

      if (!blob || !canReuseBlob) {
        const rebuiltBlob = await this.buildBlobRecordFromUpload(pendingUpload, buffer, blob?.id ?? randomUUID());

        if (!blob) {
          store.blobs.push(rebuiltBlob);
        } else {
          Object.assign(blob, rebuiltBlob);
          this.syncFileRecordsForBlob(store, blob);
        }

        blob = rebuiltBlob;
      } else if (
        pendingUpload.fileType === "image" &&
        (
          blob.previewStorageKey === null ||
          blob.thumbnailStorageKey === null ||
          blob.width === null ||
          blob.height === null
        )
      ) {
        blob = await this.backfillImageBlobVariants(blob, buffer);
      }

      fileRecord.blobId = blob.id;
      fileRecord.status = "ready";
      fileRecord.pendingUploadId = null;
      fileRecord.sha256 = blob.sha256;
      fileRecord.size = blob.size;
      fileRecord.extension = blob.extension;
      fileRecord.width = blob.width;
      fileRecord.height = blob.height;
      fileRecord.duration = blob.duration;
      fileRecord.previewReady = fileRecord.fileType === "image" && blob.previewStorageKey !== null;
      fileRecord.previewWidth = blob.previewWidth;
      fileRecord.previewHeight = blob.previewHeight;
      fileRecord.thumbnailReady = fileRecord.fileType === "image" && blob.thumbnailStorageKey !== null;
      fileRecord.thumbnailWidth = blob.thumbnailWidth;
      fileRecord.thumbnailHeight = blob.thumbnailHeight;

      store.pendingUploads = store.pendingUploads.filter((item) => item.uploadId !== uploadId);
      await this.writeStoreUnsafe(store);

      return {
        uploadId,
        file: toFileResponse(fileRecord),
      };
    });
  }

  async findFileById(fileId: string): Promise<FileAssetResponse | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const fileRecord = store.files.find((file) => file.id === fileId);
      return fileRecord ? toFileResponse(fileRecord) : null;
    });
  }

  async findFileRecordById(fileId: string): Promise<FileAssetRecord | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return store.files.find((file) => file.id === fileId) ?? null;
    });
  }

  async findPendingUploadById(uploadId: string): Promise<PendingUploadRecord | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return store.pendingUploads.find((item) => item.uploadId === uploadId) ?? null;
    });
  }

  async findReadyFilesByIds(fileIds: string[]): Promise<FileAssetResponse[]> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return store.files
        .filter((file) => fileIds.includes(file.id) && file.status === "ready")
        .map((file) => toFileResponse(file));
    });
  }

  async findFilesByIds(fileIds: string[]): Promise<FileAssetResponse[]> {
    if (fileIds.length === 0) {
      return [];
    }

    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const fileIdSet = new Set(fileIds);

      return store.files
        .filter((file) => fileIdSet.has(file.id))
        .map((file) => toFileResponse(file));
    });
  }

  async readFileContent(
    fileId: string,
    variant: FileContentVariant = "download",
  ): Promise<FileContentReadResult | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const fileRecord = store.files.find((file) => file.id === fileId);

      if (!fileRecord || !fileRecord.blobId) {
        return null;
      }

      const blob = store.blobs.find((item) => item.id === fileRecord.blobId);

      if (!blob) {
        return null;
      }

      if (variant !== "download") {
        if (fileRecord.fileType !== "image") {
          return null;
        }

        const variantResult = await this.ensureImageVariantReady(blob, variant);
        const result = await this.readBlobVariantContent(variantResult.blob, variant);

        if (result) {
          if (variantResult.changed) {
            this.syncFileRecordsForBlob(store, variantResult.blob);
            await this.writeStoreUnsafe(store);
          }

          return result;
        }
      }

      return this.readStorageContent(blob.storageKey, blob.mimeType, blob.sha256);
    });
  }

  async readFileContentStream(
    fileId: string,
  ): Promise<FileContentStreamResult | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const fileRecord = store.files.find((file) => file.id === fileId);

      if (!fileRecord || !fileRecord.blobId) {
        return null;
      }

      const blob = store.blobs.find((item) => item.id === fileRecord.blobId);

      if (!blob) {
        return null;
      }

      return this.readStorageContentStream(blob.storageKey, blob.mimeType, blob.sha256);
    });
  }

  private async ensureInitializedUnsafe(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.filesDataDir, { recursive: true });
    await fs.mkdir(this.blobDir, { recursive: true });

    const legacyStorePath = path.join(this.dataDir, "files-store.json");

    if (legacyStorePath !== this.storePath) {
      try {
        await fs.access(this.storePath);
      } catch {
        try {
          const legacyRaw = await fs.readFile(legacyStorePath, "utf8");
          await fs.writeFile(this.storePath, legacyRaw, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
            throw error;
          }
        }
      }
    }

    try {
      await fs.access(this.storePath);
    } catch {
      await this.writeStoreUnsafe({
        blobs: [],
        files: [],
        pendingUploads: [],
      });
    }
  }

  private async readStoreUnsafe(): Promise<FileStore> {
    await this.ensureInitializedUnsafe();
    const raw = await fs.readFile(this.storePath, "utf8");
    return this.normalizeStore(JSON.parse(raw) as FileStore);
  }

  private async writeStoreUnsafe(store: FileStore): Promise<void> {
    const tempPath = `${this.storePath}.tmp-${randomUUID()}`;
    await fs.writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(tempPath, this.storePath);
  }

  private async withStoreLock<T>(action: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.filesDataDir, { recursive: true });
    const startedAt = Date.now();

    while (true) {
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

      try {
        handle = await fs.open(this.lockPath, "wx");
      } catch (error) {
        if (!this.isLockConflictError(error)) {
          throw error;
        }

        await this.cleanupStaleLockIfNeeded();

        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new Error("FILE_STORE_LOCK_TIMEOUT");
        }

        await this.delay(this.lockRetryDelayMs);
        continue;
      }

      try {
        return await action();
      } finally {
        await handle.close();
        await this.releaseLockFile();
      }
    }
  }

  private isLockConflictError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "EEXIST" || code === "EPERM" || code === "EACCES";
  }

  private async cleanupStaleLockIfNeeded(): Promise<void> {
    try {
      const stat = await fs.stat(this.lockPath);

      if (Date.now() - stat.mtimeMs < this.staleLockThresholdMs) {
        return;
      }

      await fs.rm(this.lockPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async releaseLockFile(): Promise<void> {
    for (let attempt = 0; attempt <= this.unlockRetryCount; attempt += 1) {
      try {
        await fs.rm(this.lockPath, { force: true });
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;

        if (code === "ENOENT") {
          return;
        }

        if ((code === "EPERM" || code === "EACCES") && attempt < this.unlockRetryCount) {
          await this.delay(this.lockRetryDelayMs);
          continue;
        }

        throw error;
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private normalizeStore(store: FileStore): FileStore {
    const normalizedBlobs = (store.blobs ?? []).map((blob) => ({
      ...blob,
      previewStorageKey: blob.previewStorageKey ?? null,
      previewMimeType: blob.previewMimeType ?? null,
      previewSize: blob.previewSize ?? null,
      previewWidth: blob.previewWidth ?? null,
      previewHeight: blob.previewHeight ?? null,
      thumbnailStorageKey: blob.thumbnailStorageKey ?? null,
      thumbnailMimeType: blob.thumbnailMimeType ?? null,
      thumbnailSize: blob.thumbnailSize ?? null,
      thumbnailWidth: blob.thumbnailWidth ?? null,
      thumbnailHeight: blob.thumbnailHeight ?? null,
      duration: blob.duration ?? null,
    }));
    const blobsById = new Map(normalizedBlobs.map((blob) => [blob.id, blob]));

    return {
      blobs: normalizedBlobs,
      files: (store.files ?? []).map((file) => {
        const blob = file.blobId ? blobsById.get(file.blobId) ?? null : null;

        return {
          ...file,
          duration: file.duration ?? blob?.duration ?? null,
          previewReady: file.fileType === "image" && (
            file.previewReady === true || blob?.previewStorageKey !== null && blob !== null
          ),
          previewWidth: file.previewWidth ?? blob?.previewWidth ?? null,
          previewHeight: file.previewHeight ?? blob?.previewHeight ?? null,
          thumbnailReady: file.fileType === "image" && (
            file.thumbnailReady === true || blob?.thumbnailStorageKey !== null && blob !== null
          ),
          thumbnailWidth: file.thumbnailWidth ?? blob?.thumbnailWidth ?? null,
          thumbnailHeight: file.thumbnailHeight ?? blob?.thumbnailHeight ?? null,
        };
      }),
      pendingUploads: (store.pendingUploads ?? []).map((pendingUpload) => ({
        ...pendingUpload,
        width: pendingUpload.width ?? null,
        height: pendingUpload.height ?? null,
        duration: pendingUpload.duration ?? null,
      })),
    };
  }

  private async writeDerivativeFiles(
    sha256: string,
    derivatives: Awaited<ReturnType<ImageDerivativeService["generate"]>>,
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
      this.writeStorageFileIfMissing(thumbnailStorageKey, derivatives.thumbnail.buffer),
      this.writeStorageFileIfMissing(previewStorageKey, derivatives.preview.buffer),
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

  private async writeStorageFileIfMissing(storageKey: string, buffer: Buffer): Promise<void> {
    const absolutePath = path.join(this.storageDir, storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    try {
      await fs.access(absolutePath);
    } catch {
      await fs.writeFile(absolutePath, buffer);
    }
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
    const absolutePath = path.join(this.storageDir, storageKey);
    const [buffer, stat] = await Promise.all([
      fs.readFile(absolutePath),
      fs.stat(absolutePath),
    ]);

    return {
      buffer,
      mimeType,
      byteLength: buffer.length,
      storageKey,
      blobSha256,
      lastModifiedAt: new Date(stat.mtimeMs).toISOString(),
    };
  }

  private async readStorageContentStream(
    storageKey: string,
    mimeType: string,
    blobSha256: string,
  ): Promise<FileContentStreamResult> {
    const absolutePath = path.join(this.storageDir, storageKey);
    const stat = await fs.stat(absolutePath);
    const stream = createReadStream(absolutePath);

    return {
      stream,
      mimeType,
      byteLength: stat.size,
      storageKey,
      blobSha256,
      lastModifiedAt: new Date(stat.mtimeMs).toISOString(),
    };
  }

  private async resolveReusableReadyFile(
    store: FileStore,
    file: FileAssetRecord,
  ): Promise<FileAssetRecord | null> {
    if (!file.blobId) {
      return null;
    }

    const blob = store.blobs.find((item) => item.id === file.blobId);
    if (!blob) {
      return null;
    }

    return await this.isBlobOriginalContentAvailable(blob) ? file : null;
  }

  private async isBlobOriginalContentAvailable(blob: FileBlobRecord): Promise<boolean> {
    try {
      await fs.access(path.join(this.storageDir, blob.storageKey));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }

  private async buildBlobRecordFromUpload(
    pendingUpload: PendingUploadRecord,
    buffer: Buffer,
    blobId: string,
  ): Promise<FileBlobRecord> {
    const extension = toExtension(pendingUpload.originalName);
    const storageKey = toBlobStorageRelativePath(pendingUpload.sha256, extension);
    const absolutePath = path.join(this.storageDir, storageKey);
    const absoluteDir = path.dirname(absolutePath);
    const imageMetadata = pendingUpload.fileType === "image"
      ? await this.imageMetadataService.extract(buffer)
      : null;
    const imageDerivatives = pendingUpload.fileType === "image"
      ? await this.imageDerivativeService.generate(buffer)
      : null;

    await fs.mkdir(absoluteDir, { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    const derivativePaths = imageDerivatives
      ? await this.writeDerivativeFiles(pendingUpload.sha256, imageDerivatives)
      : null;

    return {
      id: blobId,
      sha256: pendingUpload.sha256,
      size: buffer.length,
      mimeType: pendingUpload.mimeType,
      storageKey,
      previewStorageKey: derivativePaths?.preview.storageKey ?? null,
      previewMimeType: imageDerivatives?.preview.mimeType ?? null,
      previewSize: imageDerivatives?.preview.buffer.length ?? null,
      previewWidth: imageDerivatives?.preview.width ?? null,
      previewHeight: imageDerivatives?.preview.height ?? null,
      thumbnailStorageKey: derivativePaths?.thumbnail.storageKey ?? null,
      thumbnailMimeType: imageDerivatives?.thumbnail.mimeType ?? null,
      thumbnailSize: imageDerivatives?.thumbnail.buffer.length ?? null,
      thumbnailWidth: imageDerivatives?.thumbnail.width ?? null,
      thumbnailHeight: imageDerivatives?.thumbnail.height ?? null,
      storageProvider: "local",
      extension,
      width: imageMetadata?.width ?? pendingUpload.width ?? null,
      height: imageMetadata?.height ?? pendingUpload.height ?? null,
      duration: pendingUpload.duration ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  private async ensureImageVariantReady(
    blob: FileBlobRecord,
    variant: Exclude<FileContentVariant, "download">,
  ): Promise<{ blob: FileBlobRecord; changed: boolean }> {
    if (
      (variant === "preview" && blob.previewStorageKey !== null) ||
      (variant === "thumbnail" && blob.thumbnailStorageKey !== null)
    ) {
      return { blob, changed: false };
    }

    const originalBuffer = await fs.readFile(path.join(this.storageDir, blob.storageKey));
    const before = this.toBlobVariantSignature(blob);
    const backfilledBlob = await this.backfillImageBlobVariants(blob, originalBuffer);

    return {
      blob: backfilledBlob,
      changed: before !== this.toBlobVariantSignature(backfilledBlob),
    };
  }

  private toBlobVariantSignature(blob: FileBlobRecord): string {
    return JSON.stringify({
      width: blob.width,
      height: blob.height,
      previewStorageKey: blob.previewStorageKey,
      previewMimeType: blob.previewMimeType,
      previewSize: blob.previewSize,
      previewWidth: blob.previewWidth,
      previewHeight: blob.previewHeight,
      thumbnailStorageKey: blob.thumbnailStorageKey,
      thumbnailMimeType: blob.thumbnailMimeType,
      thumbnailSize: blob.thumbnailSize,
      thumbnailWidth: blob.thumbnailWidth,
      thumbnailHeight: blob.thumbnailHeight,
    });
  }

  private syncFileRecordsForBlob(store: FileStore, blob: FileBlobRecord): void {
    for (const file of store.files) {
      if (file.blobId !== blob.id) {
        continue;
      }

      file.width = blob.width;
      file.height = blob.height;
      file.duration = blob.duration;
      file.previewReady = file.fileType === "image" && blob.previewStorageKey !== null;
      file.previewWidth = blob.previewWidth;
      file.previewHeight = blob.previewHeight;
      file.thumbnailReady = file.fileType === "image" && blob.thumbnailStorageKey !== null;
      file.thumbnailWidth = blob.thumbnailWidth;
      file.thumbnailHeight = blob.thumbnailHeight;
    }
  }

  private async backfillImageBlobVariants(
    blob: FileBlobRecord,
    buffer: Buffer,
  ): Promise<FileBlobRecord> {
    const imageMetadata = await this.imageMetadataService.extract(buffer);
    const imageDerivatives = await this.imageDerivativeService.generate(buffer);
    const derivativePaths = await this.writeDerivativeFiles(blob.sha256, imageDerivatives);

    blob.width = imageMetadata?.width ?? blob.width;
    blob.height = imageMetadata?.height ?? blob.height;
    blob.previewStorageKey = derivativePaths?.preview.storageKey ?? blob.previewStorageKey;
    blob.previewMimeType = imageDerivatives?.preview.mimeType ?? blob.previewMimeType;
    blob.previewSize = imageDerivatives?.preview.buffer.length ?? blob.previewSize;
    blob.previewWidth = imageDerivatives?.preview.width ?? blob.previewWidth;
    blob.previewHeight = imageDerivatives?.preview.height ?? blob.previewHeight;
    blob.thumbnailStorageKey = derivativePaths?.thumbnail.storageKey ?? blob.thumbnailStorageKey;
    blob.thumbnailMimeType = imageDerivatives?.thumbnail.mimeType ?? blob.thumbnailMimeType;
    blob.thumbnailSize = imageDerivatives?.thumbnail.buffer.length ?? blob.thumbnailSize;
    blob.thumbnailWidth = imageDerivatives?.thumbnail.width ?? blob.thumbnailWidth;
    blob.thumbnailHeight = imageDerivatives?.thumbnail.height ?? blob.thumbnailHeight;

    return blob;
  }
}
