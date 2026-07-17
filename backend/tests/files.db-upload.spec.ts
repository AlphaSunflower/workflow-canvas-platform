import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DbFilesRepository } from "../api/src/modules/files/db-files.repository.ts";
import type {
  ObjectStorageAdapter,
  ObjectStorageReadResult,
} from "../api/src/modules/storage/object-storage.adapter.ts";
import type {
  FileAssetDbRow,
  FileBlobDbRow,
  PendingUploadDbRow,
} from "../api/src/modules/files/db-files.mapper.ts";
import type {
  DatabaseClient,
  DatabasePool,
  QueryResult,
  QueryResultRow,
} from "../shared/src/db/postgres-client.ts";
import type { DatabaseConfig } from "../shared/src/db/db-config.ts";

type UploadStatus = "pending" | "completed";

interface PendingUploadMemoryRow extends PendingUploadDbRow {
  status: UploadStatus;
  completed_at: Date | null;
}

interface FileBlobVariantRow {
  blob_id: string;
  variant: "original" | "preview" | "thumbnail";
  variant_key: string;
  storage_provider: string;
  storage_key: string;
  mime_type: string;
  size: number | null;
  extension: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

interface FileEventRow {
  file_id: string | null;
  blob_id: string | null;
  upload_id: string | null;
  actor_user_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
}

const TEST_DATABASE_CONFIG: DatabaseConfig = {
  url: null,
  host: "127.0.0.1",
  port: 5432,
  database: "newworkflow_test",
  user: "postgres",
  password: null,
  ssl: false,
  maxPoolSize: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
  statementTimeoutMillis: 30000,
  healthcheckTimeoutMillis: 1000,
};

const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAF0lEQVR4nGP8z8DAwMDAxMDA8J8BAM4FA/2wE8sAAAAASUVORK5CYII=",
  "base64",
);

function createResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    rows,
  };
}

function asRows<T extends QueryResultRow>(rows: QueryResultRow[]): T[] {
  return rows as unknown as T[];
}

class InMemoryDatabaseClient implements DatabaseClient {
  constructor(private readonly pool: InMemoryDatabasePool) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  release(): void {
    return undefined;
  }
}

class InMemoryDatabasePool implements DatabasePool {
  readonly blobs: FileBlobDbRow[] = [];
  readonly files: FileAssetDbRow[] = [];
  readonly uploads: PendingUploadMemoryRow[] = [];
  readonly variants: FileBlobVariantRow[] = [];
  readonly events: FileEventRow[] = [];

  async connect(): Promise<DatabaseClient> {
    return new InMemoryDatabaseClient(this);
  }

  async end(): Promise<void> {
    return undefined;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return createResult([] as T[]);
    }

    if (normalized.startsWith("select 1 as ok")) {
      return createResult(asRows<T>([{ ok: 1 }]));
    }

    if (normalized.startsWith("select pg_advisory_xact_lock")) {
      return createResult([] as T[]);
    }

    if (normalized.includes("from file_blobs") && normalized.includes("where id = $1")) {
      return createResult(asRows<T>(this.blobs.filter((blob) => blob.id === values[0])));
    }

    if (normalized.includes("from file_blobs") && normalized.includes("where sha256 = $1")) {
      return createResult(asRows<T>(this.blobs.filter((blob) => blob.sha256 === values[0])));
    }

    if (normalized.includes("from file_assets") && normalized.includes("where id = any")) {
      const ids = new Set(values[0] as string[]);
      const statuses = new Set(values[1] as string[]);
      return createResult(asRows<T>(
        this.files.filter((file) =>
          ids.has(String(file.id)) && statuses.has(String(file.status))),
      ));
    }

    if (normalized.includes("from file_assets") && normalized.includes("where id = $1")) {
      return createResult(asRows<T>(
        this.files.filter((file) =>
          file.id === values[0] && (file.status === "pending_upload" || file.status === "ready")),
      ));
    }

    if (
      normalized.includes("from file_assets")
      && normalized.includes("user_id is not distinct from $1")
      && normalized.includes("sha256 = $2")
      && normalized.includes("status = 'ready'")
    ) {
      return createResult(asRows<T>(
        this.files.filter((file) =>
          file.user_id === values[0]
          && file.sha256 === values[1]
          && file.file_type === values[2]
          && file.source_type === values[3]
          && file.status === "ready"
          && file.blob_id !== null),
      ));
    }

    if (normalized.includes("from file_uploads") && normalized.includes("where id = $1")) {
      return createResult(asRows<T>(
        this.uploads.filter((upload) =>
          upload.upload_id === values[0] && upload.status === "pending"),
      ));
    }

    if (
      normalized.includes("from file_uploads")
      && normalized.includes("user_id is not distinct from $1")
      && normalized.includes("sha256 = $2")
    ) {
      return createResult(asRows<T>(
        this.uploads.filter((upload) =>
          upload.user_id === values[0]
          && upload.sha256 === values[1]
          && upload.file_type === values[2]
          && upload.source_type === values[3]
          && upload.size === values[4]
          && upload.mime_type === values[5]
          && upload.status === "pending"),
      ));
    }

    if (normalized.startsWith("insert into file_assets")) {
      return createResult(asRows<T>([this.insertFile(values)]));
    }

    if (normalized.startsWith("insert into file_uploads")) {
      return createResult(asRows<T>([this.insertUpload(values)]));
    }

    if (normalized.startsWith("insert into file_blobs")) {
      return createResult(asRows<T>([this.upsertBlob(values)]));
    }

    if (normalized.startsWith("insert into file_blob_variants")) {
      this.upsertVariant(values);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("update file_assets set blob_id")) {
      const completedFile = this.completeFileUpload(values);
      return createResult(asRows<T>(completedFile ? [completedFile] : []));
    }

    if (normalized.startsWith("update file_uploads set")) {
      this.completeUpload(values[0] as string);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("update file_assets set width")) {
      this.syncFilesForBlob(values);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into file_events")) {
      this.events.push({
        file_id: values[0] as string | null,
        blob_id: values[1] as string | null,
        upload_id: values[2] as string | null,
        actor_user_id: values[3] as string | null,
        event_type: values[4] as string,
        payload: JSON.parse(values[5] as string) as Record<string, unknown>,
      });
      return createResult([] as T[]);
    }

    throw new Error(`UNHANDLED_TEST_QUERY:${normalized}`);
  }

  private insertFile(values: readonly unknown[]): FileAssetDbRow {
    const isReadyInsert = values.length === 20;
    const createdAt = new Date();
    const row: FileAssetDbRow = isReadyInsert
      ? {
          id: values[0],
          user_id: values[1],
          blob_id: values[2],
          original_name: values[3],
          display_name: values[4],
          mime_type: values[5],
          file_type: values[6],
          source_type: values[7],
          status: "ready",
          pending_upload_id: null,
          sha256: values[8],
          size: values[9],
          extension: values[10],
          width: values[11],
          height: values[12],
          duration: values[13],
          preview_ready: values[14],
          preview_width: values[15],
          preview_height: values[16],
          thumbnail_ready: values[17],
          thumbnail_width: values[18],
          thumbnail_height: values[19],
          created_at: createdAt,
        }
      : {
          id: values[0],
          user_id: values[1],
          blob_id: null,
          original_name: values[2],
          display_name: values[3],
          mime_type: values[4],
          file_type: values[5],
          source_type: values[6],
          status: "pending_upload",
          pending_upload_id: values[7],
          sha256: values[8],
          size: values[9],
          extension: values[10],
          width: values[11],
          height: values[12],
          duration: values[13],
          preview_ready: false,
          preview_width: null,
          preview_height: null,
          thumbnail_ready: false,
          thumbnail_width: null,
          thumbnail_height: null,
          created_at: createdAt,
        };

    this.files.push(row);
    return row;
  }

  private insertUpload(values: readonly unknown[]): PendingUploadMemoryRow {
    const row: PendingUploadMemoryRow = {
      upload_id: values[0],
      file_id: values[1],
      user_id: values[2],
      sha256: values[3],
      size: values[4],
      mime_type: values[5],
      original_name: values[6],
      display_name: values[7],
      file_type: values[8],
      source_type: values[9],
      width: values[10],
      height: values[11],
      duration: values[12],
      created_at: new Date(),
      status: "pending",
      completed_at: null,
    };

    this.uploads.push(row);
    return row;
  }

  private upsertBlob(values: readonly unknown[]): FileBlobDbRow {
    let row = this.blobs.find((blob) => blob.sha256 === values[0]);

    if (!row) {
      row = {
        id: randomUUID(),
        sha256: values[0],
        size: values[1],
        mime_type: values[2],
        storage_key: values[3],
        storage_provider: values[4],
        preview_storage_key: values[5],
        preview_mime_type: values[6],
        preview_size: values[7],
        preview_width: values[8],
        preview_height: values[9],
        thumbnail_storage_key: values[10],
        thumbnail_mime_type: values[11],
        thumbnail_size: values[12],
        thumbnail_width: values[13],
        thumbnail_height: values[14],
        extension: values[15],
        width: values[16],
        height: values[17],
        duration: values[18],
        created_at: new Date(),
      };
      this.blobs.push(row);
      return row;
    }

    row.size = values[1];
    row.mime_type = values[2];
    row.storage_key = values[3];
    row.storage_provider = values[4];
    row.preview_storage_key = values[5] ?? row.preview_storage_key;
    row.preview_mime_type = values[6] ?? row.preview_mime_type;
    row.preview_size = values[7] ?? row.preview_size;
    row.preview_width = values[8] ?? row.preview_width;
    row.preview_height = values[9] ?? row.preview_height;
    row.thumbnail_storage_key = values[10] ?? row.thumbnail_storage_key;
    row.thumbnail_mime_type = values[11] ?? row.thumbnail_mime_type;
    row.thumbnail_size = values[12] ?? row.thumbnail_size;
    row.thumbnail_width = values[13] ?? row.thumbnail_width;
    row.thumbnail_height = values[14] ?? row.thumbnail_height;
    row.extension = values[15] ?? row.extension;
    row.width = values[16] ?? row.width;
    row.height = values[17] ?? row.height;
    row.duration = values[18] ?? row.duration;
    return row;
  }

  private upsertVariant(values: readonly unknown[]): void {
    const existing = this.variants.find((variant) =>
      variant.blob_id === values[0] && variant.variant === values[1] && variant.variant_key === "default");

    const row: FileBlobVariantRow = {
      blob_id: values[0] as string,
      variant: values[1] as FileBlobVariantRow["variant"],
      variant_key: "default",
      storage_provider: values[2] as string,
      storage_key: values[3] as string,
      mime_type: values[4] as string,
      size: values[5] as number | null,
      extension: values[6] as string | null,
      width: values[7] as number | null,
      height: values[8] as number | null,
      duration: values[9] as number | null,
    };

    if (existing) {
      Object.assign(existing, row);
      return;
    }

    this.variants.push(row);
  }

  private completeFileUpload(values: readonly unknown[]): FileAssetDbRow | null {
    const row = this.files.find((file) =>
      file.id === values[13] && file.status === "pending_upload");

    if (!row) {
      return null;
    }

    row.blob_id = values[0];
    row.status = "ready";
    row.pending_upload_id = null;
    row.sha256 = values[1];
    row.size = values[2];
    row.extension = values[3];
    row.width = values[4];
    row.height = values[5];
    row.duration = values[6];
    row.preview_ready = values[7];
    row.preview_width = values[8];
    row.preview_height = values[9];
    row.thumbnail_ready = values[10];
    row.thumbnail_width = values[11];
    row.thumbnail_height = values[12];
    return row;
  }

  private completeUpload(uploadId: string): void {
    const upload = this.uploads.find((item) => item.upload_id === uploadId);

    if (upload) {
      upload.status = "completed";
      upload.completed_at = new Date();
    }
  }

  private syncFilesForBlob(values: readonly unknown[]): void {
    for (const file of this.files) {
      if (file.blob_id !== values[0] || file.status !== "ready") {
        continue;
      }

      file.width = values[1];
      file.height = values[2];
      file.duration = values[3];
      file.preview_ready = file.file_type === "image" && values[4] === true;
      file.preview_width = values[5];
      file.preview_height = values[6];
      file.thumbnail_ready = file.file_type === "image" && values[7] === true;
      file.thumbnail_width = values[8];
      file.thumbnail_height = values[9];
    }
  }
}

class RollbackOnBlobInsertPool extends InMemoryDatabasePool {
  override async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.startsWith("insert into file_blobs")) {
      throw new Error("SIMULATED_BLOB_INSERT_FAILURE");
    }

    return super.query<T>(text, values);
  }
}

class MemoryObjectStorageAdapter implements ObjectStorageAdapter {
  readonly provider = "memory";
  readonly objects = new Map<string, Buffer>();

  async write(storageKey: string, buffer: Buffer | Uint8Array): Promise<void> {
    this.objects.set(this.normalize(storageKey), Buffer.from(buffer));
  }

  async writeIfMissing(storageKey: string, buffer: Buffer | Uint8Array): Promise<void> {
    const normalized = this.normalize(storageKey);

    if (!this.objects.has(normalized)) {
      this.objects.set(normalized, Buffer.from(buffer));
    }
  }

  async copyIfMissing(sourceStorageKey: string, targetStorageKey: string): Promise<void> {
    const sourceKey = this.normalize(sourceStorageKey);
    const targetKey = this.normalize(targetStorageKey);

    if (this.objects.has(targetKey)) {
      return;
    }

    const source = this.objects.get(sourceKey);

    if (!source) {
      throw new Error("SOURCE_NOT_FOUND");
    }

    this.objects.set(targetKey, Buffer.from(source));
  }

  async read(storageKey: string): Promise<ObjectStorageReadResult> {
    const normalized = this.normalize(storageKey);
    const buffer = this.objects.get(normalized);

    if (!buffer) {
      throw new Error("OBJECT_NOT_FOUND");
    }

    return {
      buffer: Buffer.from(buffer),
      byteLength: buffer.length,
      storageKey: normalized,
      lastModifiedAt: new Date().toISOString(),
    };
  }

  async exists(storageKey: string): Promise<boolean> {
    return this.objects.has(this.normalize(storageKey));
  }

  async deleteIfExists(storageKey: string): Promise<void> {
    this.objects.delete(this.normalize(storageKey));
  }

  private normalize(storageKey: string): string {
    const normalized = storageKey.replaceAll("\\", "/");

    if (
      normalized.length === 0 ||
      normalized.startsWith("/") ||
      normalized.split("/").some((part) => part.length === 0 || part === "..")
    ) {
      throw new Error("INVALID_STORAGE_KEY");
    }

    return normalized;
  }
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-files-db-upload-test-"));
  const pool = new InMemoryDatabasePool();
  const repository = new DbFilesRepository(TEST_DATABASE_CONFIG, { pool, rootDir });
  const sha256 = createHash("sha256").update(SAMPLE_PNG).digest("hex");

  try {
    const mismatchRegister = await repository.registerFile({
      userId: "user-a",
      sha256,
      size: SAMPLE_PNG.length,
      mimeType: "image/png",
      originalName: "mismatch.png",
      fileType: "image",
      sourceType: "input",
    });

    await assert.rejects(
      () => repository.uploadFile(mismatchRegister.uploadId!, Buffer.from("different-content")),
      /FILE_HASH_MISMATCH/,
    );
    assert.equal(pool.uploads[0]?.status, "pending");
    assert.equal(pool.blobs.length, 0);

    const uploadResult = await repository.uploadFile(mismatchRegister.uploadId!, SAMPLE_PNG);
    assert.equal(uploadResult.uploadId, mismatchRegister.uploadId);
    assert.equal(uploadResult.file.status, "ready");
    assert.equal(uploadResult.file.sha256, sha256);
    assert.equal(uploadResult.file.size, SAMPLE_PNG.length);
    assert.equal(uploadResult.file.extension, "png");
    assert.equal(uploadResult.file.downloadUrl, `/api/v1/files/${uploadResult.file.fileId}/download`);
    assert.ok(uploadResult.file.previewUrl);
    assert.ok(uploadResult.file.thumbnailUrl);
    assert.equal(pool.uploads[0]?.status, "completed");
    assert.equal(pool.files[0]?.pending_upload_id, null);
    assert.equal(pool.blobs.length, 1);
    assert.deepEqual(
      pool.variants.map((variant) => variant.variant).sort(),
      ["original", "preview", "thumbnail"],
    );
    assert.equal(pool.events.at(-1)?.event_type, "file_upload_completed");

    const originalPath = path.join(rootDir, "storage", "blobs", sha256.slice(0, 2), `${sha256}.png`);
    const previewPath = path.join(rootDir, "storage", "blobs", sha256.slice(0, 2), `${sha256}.preview.png`);
    const thumbnailPath = path.join(rootDir, "storage", "blobs", sha256.slice(0, 2), `${sha256}.thumbnail.png`);
    assert.equal(Buffer.compare(await fs.readFile(originalPath), SAMPLE_PNG), 0);
    assert.ok((await fs.stat(previewPath)).size > 0);
    assert.ok((await fs.stat(thumbnailPath)).size > 0);

    const secondRegister = await repository.registerFile({
      userId: "user-b",
      sha256,
      size: SAMPLE_PNG.length,
      mimeType: "image/png",
      originalName: "same-content.png",
      fileType: "image",
      sourceType: "input",
    });

    assert.equal(secondRegister.uploadRequired, false);
    assert.equal(secondRegister.file.status, "ready");
    assert.equal(secondRegister.file.blobId, uploadResult.file.blobId);
    assert.notEqual(secondRegister.file.fileId, uploadResult.file.fileId);

    const rollbackPool = new RollbackOnBlobInsertPool();
    const rollbackStorage = new MemoryObjectStorageAdapter();
    const rollbackRepository = new DbFilesRepository(TEST_DATABASE_CONFIG, {
      pool: rollbackPool,
      objectStorage: rollbackStorage,
    });
    const unknownContent = Buffer.from("transaction-rollback-object-cleanup");
    const unknownSha256 = createHash("sha256").update(unknownContent).digest("hex");
    const rollbackRegister = await rollbackRepository.registerFile({
      userId: "user-c",
      sha256: unknownSha256,
      size: unknownContent.length,
      mimeType: "application/octet-stream",
      originalName: "rollback.bin",
      fileType: "unknown",
      sourceType: "input",
    });

    await assert.rejects(
      () => rollbackRepository.uploadFile(rollbackRegister.uploadId!, unknownContent),
      /SIMULATED_BLOB_INSERT_FAILURE/,
    );
    assert.deepEqual([...rollbackStorage.objects.keys()], []);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
