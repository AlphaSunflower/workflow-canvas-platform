import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
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
import { WorkerFileAssetService } from "../worker/src/modules/files/worker-file-asset.service.ts";
import type { StorageWriteResult } from "../worker/src/modules/storage/storage.types.ts";
import { createAIImageGenRequest } from "./helpers/execution-request.fixture.ts";

type UploadStatus = "pending" | "completed";

interface PendingUploadMemoryRow extends PendingUploadDbRow {
  status: UploadStatus;
  completed_at: Date | null;
}

interface TaskFileLinkRow {
  id: string;
  task_id: string;
  file_id: string;
  workflow_id: string | null;
  role: string;
  order_index: number | null;
  source_handle: string | null;
  group_id: string | null;
  created_at: string;
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
  constructor(private readonly pool: InMemoryExecutionOutputPool) {}

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

class InMemoryExecutionOutputPool implements DatabasePool {
  readonly blobs: FileBlobDbRow[] = [];
  readonly files: FileAssetDbRow[] = [];
  readonly uploads: PendingUploadMemoryRow[] = [];
  readonly taskFileLinks: TaskFileLinkRow[] = [];
  readonly executionTaskUpdates: string[] = [];

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

    if (normalized.startsWith("select pg_advisory_xact_lock")) {
      return createResult([] as T[]);
    }

    if (normalized.includes("from file_blobs") && normalized.includes("where sha256 = $1")) {
      return createResult(asRows<T>(this.blobs.filter((blob) => blob.sha256 === values[0])));
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

    if (normalized.startsWith("insert into file_events")) {
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into execution_runs")) {
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into execution_tasks")) {
      this.executionTaskUpdates.push(values[0] as string);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into task_events")) {
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into task_file_links")) {
      this.upsertTaskFileLink(values);
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
    const existing = this.blobs.find((blob) => blob.sha256 === values[0]);
    if (existing) {
      return existing;
    }

    const row: FileBlobDbRow = {
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

  private upsertTaskFileLink(values: readonly unknown[]): void {
    const row: TaskFileLinkRow = {
      id: values[0] as string,
      task_id: values[1] as string,
      file_id: values[2] as string,
      workflow_id: values[3] as string | null,
      role: values[4] as string,
      order_index: values[5] as number | null,
      source_handle: values[6] as string | null,
      group_id: values[7] as string | null,
      created_at: values[8] as string,
    };
    const existing = this.taskFileLinks.find((item) => item.id === row.id);

    if (existing) {
      Object.assign(existing, row);
      return;
    }

    this.taskFileLinks.push(row);
  }
}

function createStoredOutput(buffer: Buffer): StorageWriteResult {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    fileType: "image",
    sourceType: "output",
    originalName: "worker-output.png",
    mimeType: "image/png",
    sha256,
    size: buffer.length,
    extension: "png",
    width: null,
    height: null,
    storageProvider: "local",
    storageKey: `outputs/${sha256}.png`,
    absolutePath: "",
    createdAt: new Date().toISOString(),
  };
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-output-db-assets-"));
  const pool = new InMemoryExecutionOutputPool();
  const filesRepository = new DbFilesRepository(TEST_DATABASE_CONFIG, { pool, rootDir });
  const assetService = new WorkerFileAssetService(filesRepository);
  const executionsRepository = new ExecutionsRepository(rootDir, {
    pool,
    mirrorToDatabase: true,
  });
  const outputBuffer = Buffer.from("worker-output-db-file-asset");
  const storedOutput = createStoredOutput(outputBuffer);

  try {
    const created = await executionsRepository.createExecution({
      run: {
        userId: "user-a",
        workflowId: "workflow-a",
        projectId: "project-a",
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "node-a",
        nodeTitle: "Image Gen",
        provider: "laozhang",
        requestPayload: createAIImageGenRequest({
          userId: "user-a",
          workflowId: "workflow-a",
          nodeId: "node-a",
          nodeTitle: "Image Gen",
          groups: [],
        }),
      },
      tasks: [
        {
          workflowId: "workflow-a",
          projectId: "project-a",
          nodeType: "aiImageGen",
          nodeId: "node-a",
          nodeTitle: "Image Gen",
          taskType: "image-gen",
          groupId: "group-a",
          groupOrder: 1,
          provider: "laozhang",
          model: "gpt-image-2",
          input: {
            referenceFileIds: [],
          },
        },
      ],
    });
    const taskId = created.tasks[0]!.taskId;
    const resultFileId = await assetService.registerStoredAsset({
      userId: "user-a",
      stored: storedOutput,
      content: outputBuffer,
      fileType: "image",
      sourceType: "output",
    });

    await executionsRepository.updateTaskResultFile(taskId, resultFileId);

    const file = await filesRepository.findFileById(resultFileId);
    const task = await executionsRepository.getTaskById(taskId);
    const links = await executionsRepository.getTaskFileLinks(taskId);

    assert.equal(file?.sourceType, "output");
    assert.equal(file?.status, "ready");
    assert.equal(task?.resultFileId, resultFileId);
    assert.equal(links.some((link) =>
      link.fileId === resultFileId
      && link.role === "output"
      && link.sourceHandle === "resultFileId"), true);
    assert.equal(pool.files[0]?.source_type, "output");
    assert.equal(pool.files[0]?.status, "ready");
    assert.equal(pool.taskFileLinks.some((link) =>
      link.task_id === taskId
      && link.file_id === resultFileId
      && link.role === "output"), true);
    assert.equal(pool.executionTaskUpdates.includes(taskId), true);

    const repeatedStoredOutput = {
      ...storedOutput,
      originalName: "worker-output-again.png",
    };
    const secondOutputFileId = await assetService.registerStoredAsset({
      userId: "user-a",
      stored: repeatedStoredOutput,
      content: outputBuffer,
      fileType: "image",
      sourceType: "output",
    });
    const sameContentInput = await filesRepository.registerFile({
      userId: "user-a",
      sha256: storedOutput.sha256,
      size: storedOutput.size,
      mimeType: storedOutput.mimeType,
      originalName: "same-content-input.png",
      fileType: "image",
      sourceType: "input",
    });

    assert.equal(secondOutputFileId, resultFileId);
    assert.equal(sameContentInput.uploadRequired, false);
    assert.equal(sameContentInput.file.sourceType, "input");
    assert.notEqual(sameContentInput.file.fileId, resultFileId);
    assert.equal(sameContentInput.file.blobId, file?.blobId);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
