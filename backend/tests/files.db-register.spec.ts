import assert from "node:assert/strict";

import { DbFilesRepository } from "../api/src/modules/files/db-files.repository.ts";
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

type FileEventRow = {
  file_id: string | null;
  blob_id: string | null;
  upload_id: string | null;
  actor_user_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

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
  readonly uploads: PendingUploadDbRow[] = [];
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

    if (normalized.startsWith("select id::text, sha256") && normalized.includes("from file_blobs")) {
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

    if (normalized.includes("from file_assets") && normalized.includes("sha256 = $2")) {
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
          upload.upload_id === values[0] && this.getUploadStatus(upload.upload_id) === "pending"),
      ));
    }

    if (normalized.includes("from file_uploads") && normalized.includes("sha256 = $2")) {
      return createResult(asRows<T>(
        this.uploads.filter((upload) =>
          upload.user_id === values[0]
          && upload.sha256 === values[1]
          && upload.file_type === values[2]
          && upload.source_type === values[3]
          && upload.size === values[4]
          && upload.mime_type === values[5]
          && this.getUploadStatus(upload.upload_id) === "pending"),
      ));
    }

    if (normalized.startsWith("insert into file_assets")) {
      return createResult(asRows<T>([this.insertFile(values)]));
    }

    if (normalized.startsWith("insert into file_uploads")) {
      return createResult(asRows<T>([this.insertUpload(values)]));
    }

    if (normalized.startsWith("insert into file_events")) {
      this.events.push({
        file_id: values[0] as string | null,
        blob_id: values[1] as string | null,
        upload_id: values[2] as string | null,
        actor_user_id: values[3] as string | null,
        event_type: values[4] as string,
        payload: JSON.parse(values[5] as string) as Record<string, unknown>,
        created_at: new Date(),
      });
      return createResult([] as T[]);
    }

    throw new Error(`UNHANDLED_TEST_QUERY:${normalized}`);
  }

  seedBlob(input: {
    id: string;
    sha256: string;
    size: number;
    mimeType: string;
    storageKey: string;
    extension: string | null;
    width?: number | null;
    height?: number | null;
  }): void {
    this.blobs.push({
      id: input.id,
      sha256: input.sha256,
      size: input.size,
      mime_type: input.mimeType,
      storage_key: input.storageKey,
      preview_storage_key: null,
      preview_mime_type: null,
      preview_size: null,
      preview_width: null,
      preview_height: null,
      thumbnail_storage_key: null,
      thumbnail_mime_type: null,
      thumbnail_size: null,
      thumbnail_width: null,
      thumbnail_height: null,
      storage_provider: "local",
      extension: input.extension,
      width: input.width ?? null,
      height: input.height ?? null,
      duration: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    });
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

  private insertUpload(values: readonly unknown[]): PendingUploadDbRow {
    const row: PendingUploadDbRow = {
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
    };

    this.uploads.push(row);
    return row;
  }

  private getUploadStatus(uploadId: unknown): "pending" {
    if (this.uploads.some((upload) => upload.upload_id === uploadId)) {
      return "pending";
    }

    return "pending";
  }
}

async function run(): Promise<void> {
  const pool = new InMemoryDatabasePool();
  const repository = new DbFilesRepository(TEST_DATABASE_CONFIG, { pool });
  const sha256 = "a".repeat(64);

  await repository.ensureInitialized();

  const firstRegister = await repository.registerFile({
    userId: "user-a",
    sha256,
    size: 123,
    mimeType: "image/png",
    originalName: "first.png",
    fileType: "image",
    sourceType: "input",
  });

  assert.equal(firstRegister.uploadRequired, true);
  assert.ok(firstRegister.uploadId);
  assert.equal(firstRegister.uploadUrl, `/api/v1/files/upload?uploadId=${firstRegister.uploadId}`);
  assert.equal(firstRegister.file.status, "pending_upload");
  assert.equal(firstRegister.file.sha256, sha256);
  assert.equal(firstRegister.file.extension, "png");
  assert.equal(pool.uploads.length, 1);
  assert.equal(pool.events.at(-1)?.event_type, "file_pending_upload_created");

  const repeatedPending = await repository.registerFile({
    userId: "user-a",
    sha256,
    size: 123,
    mimeType: "image/png",
    originalName: "first-again.png",
    fileType: "image",
    sourceType: "input",
  });

  assert.equal(repeatedPending.uploadRequired, true);
  assert.equal(repeatedPending.uploadId, firstRegister.uploadId);
  assert.equal(repeatedPending.file.fileId, firstRegister.file.fileId);
  assert.equal(pool.uploads.length, 1);

  pool.seedBlob({
    id: "11111111-1111-4111-8111-111111111111",
    sha256,
    size: 123,
    mimeType: "image/png",
    storageKey: "blobs/aa/file.png",
    extension: "png",
    width: 2,
    height: 3,
  });

  const secondUserRegister = await repository.registerFile({
    userId: "user-b",
    sha256,
    size: 123,
    mimeType: "image/png",
    originalName: "second.png",
    fileType: "image",
    sourceType: "input",
  });

  assert.equal(secondUserRegister.uploadRequired, false);
  assert.equal(secondUserRegister.file.status, "ready");
  assert.equal(secondUserRegister.file.blobId, "11111111-1111-4111-8111-111111111111");
  assert.equal(secondUserRegister.file.userId, "user-b");
  assert.equal(secondUserRegister.file.width, 2);
  assert.equal(secondUserRegister.file.height, 3);
  assert.equal(secondUserRegister.file.downloadUrl, `/api/v1/files/${secondUserRegister.file.fileId}/download`);
  assert.equal(pool.events.at(-1)?.event_type, "file_asset_created_from_existing_blob");

  const firstUserReadyRegister = await repository.registerFile({
    userId: "user-a",
    sha256,
    size: 123,
    mimeType: "image/png",
    originalName: "first-ready.png",
    fileType: "image",
    sourceType: "input",
  });

  assert.equal(firstUserReadyRegister.uploadRequired, false);
  assert.equal(firstUserReadyRegister.file.blobId, secondUserRegister.file.blobId);
  assert.notEqual(firstUserReadyRegister.file.fileId, secondUserRegister.file.fileId);

  const repeatedReady = await repository.registerFile({
    userId: "user-a",
    sha256,
    size: 123,
    mimeType: "image/png",
    originalName: "first-ready-repeat.png",
    fileType: "image",
    sourceType: "input",
  });

  assert.equal(repeatedReady.uploadRequired, false);
  assert.equal(repeatedReady.file.fileId, firstUserReadyRegister.file.fileId);

  const detail = await repository.findFileById(secondUserRegister.file.fileId);
  assert.deepEqual(detail, secondUserRegister.file);

  const record = await repository.findFileRecordById(secondUserRegister.file.fileId);
  assert.equal(record?.blobId, secondUserRegister.file.blobId);

  const foundBlob = await repository.findBlobBySha256(sha256);
  assert.equal(foundBlob?.id, "11111111-1111-4111-8111-111111111111");

  const files = await repository.findFilesByIds([
    firstRegister.file.fileId,
    secondUserRegister.file.fileId,
    "00000000-0000-4000-8000-000000000000",
  ]);
  assert.deepEqual(files.map((file) => file.fileId), [
    firstRegister.file.fileId,
    secondUserRegister.file.fileId,
  ]);

  const readyFiles = await repository.findReadyFilesByIds([
    firstRegister.file.fileId,
    secondUserRegister.file.fileId,
  ]);
  assert.deepEqual(readyFiles.map((file) => file.fileId), [
    secondUserRegister.file.fileId,
  ]);

  assert.ok(pool.events.length >= 4);
}

void run();
