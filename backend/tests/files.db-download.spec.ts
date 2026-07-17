import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AuthenticatedAccount } from "../api/src/modules/auth/auth.service.ts";
import { DbFilesRepository } from "../api/src/modules/files/db-files.repository.ts";
import type {
  FileAssetDbRow,
  FileBlobDbRow,
} from "../api/src/modules/files/db-files.mapper.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
import type {
  DatabaseClient,
  DatabasePool,
  QueryResult,
  QueryResultRow,
} from "../shared/src/db/postgres-client.ts";
import type { DatabaseConfig } from "../shared/src/db/db-config.ts";

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

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const BLOB_ID = "22222222-2222-4222-8222-222222222222";
const SHA256 = "b".repeat(64);

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

function createAuthenticatedAccount(userId: string, role: "member" | "admin" = "member"): AuthenticatedAccount {
  return {
    user: {
      userId,
      email: `${userId}@example.com`,
      displayName: userId,
      role,
      status: "enabled",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      lastLoginAt: null,
    },
    accessTokenPayload: {
      userId,
      role,
      status: "enabled",
    },
  };
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

    if (normalized.includes("from file_assets") && normalized.includes("where id = $1")) {
      return createResult(asRows<T>(
        this.files.filter((file) =>
          file.id === values[0] && (file.status === "pending_upload" || file.status === "ready")),
      ));
    }

    if (normalized.includes("from file_blobs") && normalized.includes("where id = $1")) {
      return createResult(asRows<T>(this.blobs.filter((blob) => blob.id === values[0])));
    }

    throw new Error(`UNHANDLED_TEST_QUERY:${normalized}`);
  }
}

async function writeStorageFile(rootDir: string, storageKey: string, buffer: Buffer): Promise<void> {
  const absolutePath = path.join(rootDir, "storage", storageKey);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-files-db-download-test-"));
  const pool = new InMemoryDatabasePool();
  const repository = new DbFilesRepository(TEST_DATABASE_CONFIG, { pool, rootDir });
  const service = new FilesService(repository);
  const originalBuffer = Buffer.from("original-db-file-content");
  const previewBuffer = Buffer.from("preview-db-file-content");
  const thumbnailBuffer = Buffer.from("thumbnail-db-file-content");

  try {
    await Promise.all([
      writeStorageFile(rootDir, `blobs/bb/${SHA256}.png`, originalBuffer),
      writeStorageFile(rootDir, `blobs/bb/${SHA256}.preview.png`, previewBuffer),
      writeStorageFile(rootDir, `blobs/bb/${SHA256}.thumbnail.png`, thumbnailBuffer),
    ]);

    pool.blobs.push({
      id: BLOB_ID,
      sha256: SHA256,
      size: originalBuffer.length,
      mime_type: "image/png",
      storage_key: `blobs/bb/${SHA256}.png`,
      preview_storage_key: `blobs/bb/${SHA256}.preview.png`,
      preview_mime_type: "image/png",
      preview_size: previewBuffer.length,
      preview_width: 80,
      preview_height: 40,
      thumbnail_storage_key: `blobs/bb/${SHA256}.thumbnail.png`,
      thumbnail_mime_type: "image/png",
      thumbnail_size: thumbnailBuffer.length,
      thumbnail_width: 40,
      thumbnail_height: 20,
      storage_provider: "local",
      extension: "png",
      width: 160,
      height: 80,
      duration: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    });
    pool.files.push({
      id: FILE_ID,
      user_id: "owner-user",
      blob_id: BLOB_ID,
      original_name: "db-image.png",
      display_name: "db-image.png",
      mime_type: "image/png",
      file_type: "image",
      source_type: "input",
      status: "ready",
      pending_upload_id: null,
      sha256: SHA256,
      size: originalBuffer.length,
      extension: "png",
      width: 160,
      height: 80,
      duration: null,
      preview_ready: true,
      preview_width: 80,
      preview_height: 40,
      thumbnail_ready: true,
      thumbnail_width: 40,
      thumbnail_height: 20,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    });

    const download = await repository.readFileContent(FILE_ID, "download");
    const preview = await repository.readFileContent(FILE_ID, "preview");
    const thumbnail = await repository.readFileContent(FILE_ID, "thumbnail");

    assert.equal(Buffer.compare(download!.buffer, originalBuffer), 0);
    assert.equal(Buffer.compare(preview!.buffer, previewBuffer), 0);
    assert.equal(Buffer.compare(thumbnail!.buffer, thumbnailBuffer), 0);
    assert.equal(download?.mimeType, "image/png");
    assert.equal(preview?.storageKey, `blobs/bb/${SHA256}.preview.png`);
    assert.equal(thumbnail?.storageKey, `blobs/bb/${SHA256}.thumbnail.png`);

    const ownerDownload = await service.downloadFileForActor(
      createAuthenticatedAccount("owner-user"),
      FILE_ID,
      "download",
    );
    const ownerPreview = await service.downloadFileForActor(
      createAuthenticatedAccount("owner-user"),
      FILE_ID,
      "preview",
    );
    const ownerThumbnail = await service.downloadFileForActor(
      createAuthenticatedAccount("owner-user"),
      FILE_ID,
      "thumbnail",
    );

    assert.ok(ownerDownload);
    assert.ok(ownerPreview);
    assert.ok(ownerThumbnail);
    assert.equal(ownerDownload?.cacheControl, "private, max-age=0, must-revalidate");
    assert.equal(ownerPreview?.cacheControl, "private, max-age=120, stale-while-revalidate=3600");
    assert.equal(ownerThumbnail?.cacheControl, "private, max-age=300, stale-while-revalidate=86400");
    assert.equal(ownerDownload?.etag, `"${FILE_ID}:download:${SHA256}"`);
    assert.equal(ownerPreview?.etag, `"${FILE_ID}:preview:${SHA256}"`);
    assert.equal(ownerThumbnail?.etag, `"${FILE_ID}:thumbnail:${SHA256}"`);
    assert.equal(Buffer.compare(ownerDownload!.buffer, originalBuffer), 0);

    await assert.rejects(
      () => service.downloadFileForActor(createAuthenticatedAccount("other-user"), FILE_ID),
      /FILE_ACCESS_FORBIDDEN/,
    );

    const adminDownload = await service.downloadFileForActor(
      createAuthenticatedAccount("admin-user", "admin"),
      FILE_ID,
    );
    assert.equal(Buffer.compare(adminDownload!.buffer, originalBuffer), 0);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
