import assert from "node:assert/strict";

import { DbFilesRepository } from "../api/src/modules/files/db-files.repository.ts";
import type {
  FileAssetDbRow,
  FileBlobDbRow,
  PendingUploadDbRow,
} from "../api/src/modules/files/db-files.mapper.ts";
import {
  DbWorkflowGroupsRepository,
  DbWorkflowRepository,
} from "../api/src/modules/workflows/db-workflow.repository.ts";
import { DbWorkflowFilesRepository } from "../api/src/modules/workflows/db-workflow-files.repository.ts";
import { WorkflowAccessPolicy } from "../api/src/modules/workflows/workflow-access.policy.ts";
import { WorkflowFileHydrator } from "../api/src/modules/workflows/workflow-file-hydrator.ts";
import { WorkflowNodeSanitizer } from "../api/src/modules/workflows/workflow-node-sanitizer.ts";
import { WorkflowsService } from "../api/src/modules/workflows/workflows.service.ts";
import type { AuthenticatedAccount } from "../api/src/modules/auth/auth.service.ts";
import type {
  DatabaseClient,
  DatabasePool,
  QueryResult,
  QueryResultRow,
} from "../shared/src/db/postgres-client.ts";
import type { DatabaseConfig } from "../shared/src/db/db-config.ts";

interface WorkflowMemoryRow extends QueryResultRow {
  id: string;
  project_id: string;
  owner_user_id: string;
  name: string;
  group_id: string | null;
  container_key: string;
  is_auto_named: boolean;
  node_count: number;
  connection_count: number;
  timestamp: number;
  version: number;
  payload: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface WorkflowGroupMemoryRow extends QueryResultRow {
  id: string;
  owner_user_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

interface WorkflowFileBindingMemoryRow extends QueryResultRow {
  id: string;
  workflow_id: string;
  owner_user_id: string;
  node_id: string;
  file_id: string;
  role: "file-node" | "node-reference" | "connection-reference" | "file-group";
  created_at: Date;
  updated_at: Date;
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

function createAuthenticatedAccount(
  userId: string,
  role: "admin" | "member" = "member",
): AuthenticatedAccount {
  return {
    user: {
      userId,
      email: `${userId}@example.com`,
      displayName: userId,
      role,
      status: "enabled",
      lastLoginAt: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
    },
    accessTokenPayload: {
      userId,
      role,
      status: "enabled",
    },
  };
}

class InMemoryDatabaseClient implements DatabaseClient {
  constructor(private readonly pool: InMemoryWorkflowDatabasePool) {}

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

class InMemoryWorkflowDatabasePool implements DatabasePool {
  readonly workflows: WorkflowMemoryRow[] = [];
  readonly groups: WorkflowGroupMemoryRow[] = [];
  readonly bindings: WorkflowFileBindingMemoryRow[] = [];
  readonly files: FileAssetDbRow[] = [];
  readonly blobs: FileBlobDbRow[] = [];
  readonly uploads: PendingUploadDbRow[] = [];

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

    if (normalized.startsWith("insert into workflows")) {
      const existing = this.workflows.find((workflow) => workflow.id === values[0]);
      if (existing) {
        return createResult([] as T[]);
      }

      const row = this.insertWorkflow(values);
      return createResult(asRows<T>([row]));
    }

    if (normalized.startsWith("update workflows") && normalized.includes("project_id = $2")) {
      const row = this.updateWorkflow(values);
      return createResult(asRows<T>(row ? [row] : []));
    }

    if (normalized.startsWith("update workflows") && normalized.includes("payload = $6::jsonb")) {
      const row = this.updateWorkflowMetadata(values);
      return createResult(asRows<T>(row ? [row] : []));
    }

    if (normalized.startsWith("delete from workflows")) {
      const row = this.deleteWorkflow(values[0] as string);
      return createResult(asRows<T>(row ? [row] : []));
    }

    if (normalized.includes("from workflows")) {
      return this.selectWorkflows<T>(normalized, values);
    }

    if (normalized.startsWith("insert into workflow_groups")) {
      const row = this.upsertGroup(values);
      return createResult(asRows<T>([row]));
    }

    if (normalized.startsWith("update workflow_groups")) {
      const row = this.renameGroup(values[0] as string, values[1] as string);
      return createResult(asRows<T>(row ? [row] : []));
    }

    if (normalized.startsWith("delete from workflow_groups")) {
      this.deleteGroup(values[0] as string);
      return createResult([] as T[]);
    }

    if (normalized.includes("from workflow_groups")) {
      return this.selectGroups<T>(normalized, values);
    }

    if (normalized.startsWith("delete from workflow_file_bindings")) {
      this.deleteBindings(values[0] as string);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into workflow_file_bindings")) {
      this.insertBinding(values);
      return createResult([] as T[]);
    }

    if (normalized.includes("from workflow_file_bindings")) {
      const workflowId = values[0] as string;
      const rows = this.bindings
        .filter((binding) => binding.workflow_id === workflowId)
        .sort((left, right) =>
          left.node_id.localeCompare(right.node_id)
          || left.file_id.localeCompare(right.file_id)
          || left.role.localeCompare(right.role));
      return createResult(asRows<T>(rows));
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

    if (normalized.includes("from file_blobs")) {
      return createResult(asRows<T>(
        this.blobs.filter((blob) => blob.sha256 === values[0]),
      ));
    }

    if (normalized.includes("from file_uploads")) {
      return createResult([] as T[]);
    }

    throw new Error(`UNHANDLED_TEST_QUERY:${normalized}`);
  }

  seedReadyFile(input: {
    fileId: string;
    userId: string;
    blobId: string;
    displayName: string;
  }): void {
    const createdAt = new Date("2026-05-01T00:00:00.000Z");
    this.files.push({
      id: input.fileId,
      user_id: input.userId,
      blob_id: input.blobId,
      original_name: input.displayName,
      display_name: input.displayName,
      mime_type: "image/png",
      file_type: "image",
      source_type: "input",
      status: "ready",
      pending_upload_id: null,
      sha256: "a".repeat(64),
      size: 1024,
      extension: "png",
      width: 512,
      height: 512,
      duration: null,
      preview_ready: true,
      preview_width: 512,
      preview_height: 512,
      thumbnail_ready: true,
      thumbnail_width: 128,
      thumbnail_height: 128,
      created_at: createdAt,
    });
  }

  private insertWorkflow(values: readonly unknown[]): WorkflowMemoryRow {
    const row: WorkflowMemoryRow = {
      id: values[0] as string,
      project_id: values[1] as string,
      owner_user_id: values[2] as string,
      name: values[3] as string,
      group_id: values[4] as string | null,
      container_key: values[5] as string,
      is_auto_named: values[6] as boolean,
      node_count: values[7] as number,
      connection_count: values[8] as number,
      timestamp: values[9] as number,
      version: values[10] as number,
      payload: JSON.parse(values[11] as string) as Record<string, unknown>,
      created_at: new Date(values[12] as string),
      updated_at: new Date(values[13] as string),
    };

    this.workflows.push(row);
    return row;
  }

  private updateWorkflow(values: readonly unknown[]): WorkflowMemoryRow | null {
    const row = this.workflows.find((workflow) => workflow.id === values[0]);
    if (!row) {
      return null;
    }

    row.project_id = values[1] as string;
    row.owner_user_id = values[2] as string;
    row.name = values[3] as string;
    row.group_id = values[4] as string | null;
    row.container_key = values[5] as string;
    row.is_auto_named = values[6] as boolean;
    row.node_count = values[7] as number;
    row.connection_count = values[8] as number;
    row.timestamp = values[9] as number;
    row.version = values[10] as number;
    row.payload = JSON.parse(values[11] as string) as Record<string, unknown>;
    row.updated_at = new Date();
    return row;
  }

  private updateWorkflowMetadata(values: readonly unknown[]): WorkflowMemoryRow | null {
    const row = this.workflows.find((workflow) => workflow.id === values[0]);
    if (!row) {
      return null;
    }

    row.name = values[1] as string;
    row.group_id = values[2] as string | null;
    row.container_key = values[3] as string;
    row.is_auto_named = values[4] as boolean;
    row.payload = JSON.parse(values[5] as string) as Record<string, unknown>;
    row.updated_at = new Date();
    return row;
  }

  private deleteWorkflow(workflowId: string): WorkflowMemoryRow | null {
    const index = this.workflows.findIndex((workflow) => workflow.id === workflowId);
    if (index < 0) {
      return null;
    }

    return this.workflows.splice(index, 1)[0] ?? null;
  }

  private selectWorkflows<T extends QueryResultRow>(
    normalized: string,
    values: readonly unknown[],
  ): QueryResult<T> {
    if (normalized.includes("owner_user_id = $1") && normalized.includes("and container_key = $2")) {
      return createResult(asRows<T>(
        this.workflows
          .filter((workflow) => workflow.owner_user_id === values[0] && workflow.container_key === values[1])
          .sort((left, right) => right.updated_at.getTime() - left.updated_at.getTime()),
      ));
    }

    if (normalized.includes("owner_user_id = $1")) {
      return createResult(asRows<T>(
        this.workflows
          .filter((workflow) => workflow.owner_user_id === values[0])
          .sort((left, right) => right.updated_at.getTime() - left.updated_at.getTime()),
      ));
    }

    if (normalized.includes("where id = $1")) {
      return createResult(asRows<T>(
        this.workflows.filter((workflow) => workflow.id === values[0]),
      ));
    }

    return createResult(asRows<T>(
      [...this.workflows].sort((left, right) => right.updated_at.getTime() - left.updated_at.getTime()),
    ));
  }

  private upsertGroup(values: readonly unknown[]): WorkflowGroupMemoryRow {
    const existing = this.groups.find((group) => group.id === values[0]);
    if (existing) {
      existing.owner_user_id = values[1] as string;
      existing.name = values[2] as string;
      existing.updated_at = new Date(values[5] as string);
      return existing;
    }

    const row: WorkflowGroupMemoryRow = {
      id: values[0] as string,
      owner_user_id: values[1] as string,
      name: values[2] as string,
      created_at: new Date(values[4] as string),
      updated_at: new Date(values[5] as string),
    };

    this.groups.push(row);
    return row;
  }

  private renameGroup(groupId: string, name: string): WorkflowGroupMemoryRow | null {
    const row = this.groups.find((group) => group.id === groupId);
    if (!row) {
      return null;
    }

    row.name = name;
    row.updated_at = new Date();
    return row;
  }

  private deleteGroup(groupId: string): void {
    const index = this.groups.findIndex((group) => group.id === groupId);
    if (index >= 0) {
      this.groups.splice(index, 1);
    }
  }

  private selectGroups<T extends QueryResultRow>(
    normalized: string,
    values: readonly unknown[],
  ): QueryResult<T> {
    if (normalized.includes("where owner_user_id = $1")) {
      return createResult(asRows<T>(
        this.groups
          .filter((group) => group.owner_user_id === values[0])
          .sort((left, right) => left.name.localeCompare(right.name)),
      ));
    }

    if (normalized.includes("where id = $1")) {
      return createResult(asRows<T>(
        this.groups.filter((group) => group.id === values[0]),
      ));
    }

    return createResult(asRows<T>(
      [...this.groups].sort((left, right) => left.updated_at.getTime() - right.updated_at.getTime()),
    ));
  }

  private deleteBindings(workflowId: string): void {
    const nextBindings = this.bindings.filter((binding) => binding.workflow_id !== workflowId);
    this.bindings.splice(0, this.bindings.length, ...nextBindings);
  }

  private insertBinding(values: readonly unknown[]): void {
    const row: WorkflowFileBindingMemoryRow = {
      id: values[0] as string,
      workflow_id: values[1] as string,
      owner_user_id: values[2] as string,
      node_id: values[3] as string,
      file_id: values[4] as string,
      role: values[5] as WorkflowFileBindingMemoryRow["role"],
      created_at: new Date(values[6] as string),
      updated_at: new Date(values[7] as string),
    };
    const existing = this.bindings.find((binding) =>
      binding.workflow_id === row.workflow_id
      && binding.node_id === row.node_id
      && binding.file_id === row.file_id
      && binding.role === row.role);

    if (existing) {
      Object.assign(existing, row);
      return;
    }

    this.bindings.push(row);
  }
}

function createService(pool: InMemoryWorkflowDatabasePool): WorkflowsService {
  return new WorkflowsService(
    new DbWorkflowRepository(TEST_DATABASE_CONFIG, { pool }),
    new DbWorkflowGroupsRepository(TEST_DATABASE_CONFIG, { pool }),
    new DbWorkflowFilesRepository(TEST_DATABASE_CONFIG, { pool }),
    new DbFilesRepository(TEST_DATABASE_CONFIG, { pool }),
    {
      accessPolicy: new WorkflowAccessPolicy(),
      nodeSanitizer: new WorkflowNodeSanitizer(),
      fileHydrator: new WorkflowFileHydrator(),
    },
  );
}

async function run(): Promise<void> {
  const pool = new InMemoryWorkflowDatabasePool();
  const service = createService(pool);
  const owner = createAuthenticatedAccount("user-a");
  const other = createAuthenticatedAccount("user-b");
  const fileId = "11111111-1111-4111-8111-111111111111";

  pool.seedReadyFile({
    fileId,
    userId: owner.user.userId,
    blobId: "22222222-2222-4222-8222-222222222222",
    displayName: "source.png",
  });

  const group = await service.createGroupForActor(owner, { name: "Group A" });
  const created = await service.createWorkflowForActor(owner, {
    id: "workflow-db-a",
    projectId: "project-a",
    name: "DB Canvas",
    nodes: {
      "node-file": {
        id: "node-file",
        type: "image",
        fileId,
        previewUrl: "blob:temporary",
        imageAsset: { transient: true },
      },
      "node-ai": {
        id: "node-ai",
        type: "aiImageGen",
        references: [
          {
            id: "ref-a",
            fileId,
          },
        ],
      },
    },
    connections: [],
    viewport: { x: 1, y: 2, zoom: 0.5 },
    metadata: { purpose: "db-test" },
    timestamp: 1710000000000,
  });

  assert.equal(created.workflowId, "workflow-db-a");
  assert.equal(created.ownerUserId, owner.user.userId);
  assert.equal(created.workflow.name, "DB Canvas");
  assert.equal(pool.workflows.length, 1, "workflow row should be inserted");
  assert.equal(pool.workflows[0]?.owner_user_id, owner.user.userId);
  const storedMetadata = pool.workflows[0]?.payload.metadata as Record<string, unknown> | undefined;
  assert.equal(storedMetadata?.purpose, "db-test");
  assert.equal(pool.workflows[0]?.payload.nodes instanceof Object, true);
  assert.equal(pool.bindings.length, 2);
  assert.equal(
    pool.bindings.some((binding) =>
      binding.node_id === "node-file" && binding.file_id === fileId && binding.role === "file-node"),
    true,
  );
  assert.equal(
    pool.bindings.some((binding) =>
      binding.node_id === "node-ai" && binding.file_id === fileId && binding.role === "node-reference"),
    true,
  );

  const list = await service.listManagedWorkflowsForActor(owner);
  assert.equal(list.total, 1, "managed list should include created workflow");
  assert.equal(list.items[0]?.workflowId, created.workflowId);
  assert.equal(list.items[0]?.nodeCount, 2);
  assert.equal(list.groups[0]?.workflowCount, 0);

  const hydrated = await service.getWorkflowForActor(owner, created.workflowId);
  assert.equal(hydrated?.workflow.nodes["node-file"] instanceof Object, true);
  const hydratedFileNode = hydrated?.workflow.nodes["node-file"] as Record<string, unknown>;
  assert.equal(hydratedFileNode.fileName, "source.png");
  assert.equal(hydratedFileNode.previewUrl, `/api/v1/files/${fileId}/preview`);
  assert.equal(
    ((hydratedFileNode.imageAsset as Record<string, unknown>).variants as Record<string, unknown>).thumbnail
      instanceof Object,
    true,
  );

  await assert.rejects(
    () => service.getWorkflowForActor(other, created.workflowId),
    /WORKFLOW_ACCESS_FORBIDDEN/,
  );

  const moved = await service.moveWorkflowGroupForActor(owner, created.workflowId, {
    groupId: group.groupId,
  });
  assert.equal(moved.groupId, group.groupId);
  assert.equal(moved.containerKey, group.groupId);

  const updated = await service.updateWorkflowForActor(owner, created.workflowId, {
    projectId: "project-a",
    name: "DB Canvas Updated",
    nodes: {
      "node-file": {
        id: "node-file",
        type: "image",
      },
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {},
    timestamp: 1710000001000,
  });
  assert.equal(updated.workflow.name, "DB Canvas Updated");
  assert.equal(updated.workflow.version, 2);
  assert.equal(pool.bindings.length, 0);
  assert.equal(pool.workflows[0]?.payload.name, "DB Canvas Updated");

  const deleteResult = await service.deleteWorkflowForActor(owner, created.workflowId);
  assert.equal(deleteResult.deleted, true);
  assert.equal(pool.workflows.length, 0);
  assert.equal(pool.files.length, 1, "delete workflow must not delete file asset");
  assert.equal(pool.bindings.length, 0);
}

void run();
