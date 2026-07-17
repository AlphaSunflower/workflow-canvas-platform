import { randomUUID } from "node:crypto";

import type { DatabaseConfig } from "@newworkflow/backend-shared";
import {
  queryPostgres,
  withTransaction,
  type DatabasePool,
  type TransactionClient,
} from "@newworkflow/backend-shared";
import type {
  WorkflowDetailResponseData,
  WorkflowGroupSummaryItem,
  WorkflowPayload,
  WorkflowSummaryItem,
} from "@newworkflow/backend-shared/api";
import {
  resolveWorkflowContainerKey,
  type StoredWorkflowDocument,
} from "./workflow-storage.types.ts";
import type {
  WorkflowGroupRepository,
  WorkflowRepository,
} from "./workflow.repository.types.ts";
import type { WorkflowFileBindingRecord } from "./workflow-file-binding.types.ts";

type QueryExecutor = Pick<TransactionClient, "query">;
type DbQueryRow = Record<string, unknown>;

interface WorkflowDbRow extends DbQueryRow {
  id: string;
  project_id: string;
  owner_user_id: string;
  name: string;
  group_id: string | null;
  container_key: string;
  is_auto_named: boolean;
  node_count: number;
  connection_count: number;
  timestamp: string | number | null;
  version: number;
  payload: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkflowGroupDbRow extends DbQueryRow {
  id: string;
  owner_user_id: string;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface DbWorkflowRepositoryOptions {
  pool?: DatabasePool;
}

const WORKFLOW_SELECT_COLUMNS = `
  id,
  project_id,
  owner_user_id,
  name,
  group_id,
  container_key,
  is_auto_named,
  node_count,
  connection_count,
  timestamp,
  version,
  payload,
  created_at,
  updated_at
`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function countObjectKeys(input: unknown): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return 0;
  }

  return Object.keys(input as Record<string, unknown>).length;
}

function normalizeTimestamp(value: string | number | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  return Date.now();
}

function normalizeWorkflowPayload(
  workflowId: string,
  payload: unknown,
  fallback: {
    projectId: string;
    name: string;
    timestamp: number;
    version: number;
  },
): WorkflowPayload {
  const raw = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Partial<WorkflowPayload>
    : {};

  return {
    ...raw,
    id: workflowId,
    projectId: typeof raw.projectId === "string" ? raw.projectId : fallback.projectId,
    name: typeof raw.name === "string" ? raw.name : fallback.name,
    nodes: raw.nodes && typeof raw.nodes === "object" && !Array.isArray(raw.nodes)
      ? raw.nodes as Record<string, unknown>
      : {},
    connections: Array.isArray(raw.connections) ? raw.connections : [],
    viewport: raw.viewport && typeof raw.viewport === "object" && !Array.isArray(raw.viewport)
      ? raw.viewport as WorkflowPayload["viewport"]
      : { x: 0, y: 0, zoom: 1 },
    metadata: raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? raw.metadata as Record<string, unknown>
      : {},
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : fallback.timestamp,
    version: typeof raw.version === "number" ? raw.version : fallback.version,
  };
}

function toSummary(row: WorkflowDbRow): WorkflowSummaryItem {
  return {
    workflowId: row.id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    groupId: row.group_id,
    containerKey: row.container_key,
    isAutoNamed: row.is_auto_named,
    nodeCount: Number(row.node_count),
    connectionCount: Number(row.connection_count),
    timestamp: normalizeTimestamp(row.timestamp),
    version: Number(row.version),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toDetail(row: WorkflowDbRow): WorkflowDetailResponseData {
  const summary = toSummary(row);
  return {
    workflowId: summary.workflowId,
    ownerUserId: summary.ownerUserId,
    groupId: summary.groupId,
    containerKey: summary.containerKey,
    isAutoNamed: summary.isAutoNamed,
    workflow: normalizeWorkflowPayload(row.id, row.payload, {
      projectId: summary.projectId,
      name: summary.name,
      timestamp: summary.timestamp,
      version: summary.version,
    }),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

function toGroupSummary(row: WorkflowGroupDbRow): WorkflowGroupSummaryItem {
  return {
    groupId: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    workflowCount: 0,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export class DbWorkflowRepository implements WorkflowRepository {
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;

  constructor(databaseConfig: DatabaseConfig, options: DbWorkflowRepositoryOptions = {}) {
    this.databaseConfig = databaseConfig;
    this.pool = options.pool ?? null;
  }

  async ensureInitialized(): Promise<void> {
    await this.query("select 1 as ok");
  }

  async listByOwner(ownerUserId: string): Promise<WorkflowSummaryItem[]> {
    const result = await this.query<WorkflowDbRow>(
      `
        select ${WORKFLOW_SELECT_COLUMNS}
        from workflows
        where owner_user_id = $1
        order by updated_at desc
      `,
      [ownerUserId],
    );

    return result.rows.map(toSummary);
  }

  async listByOwnerAndContainer(
    ownerUserId: string,
    containerKey: string,
  ): Promise<WorkflowSummaryItem[]> {
    const result = await this.query<WorkflowDbRow>(
      `
        select ${WORKFLOW_SELECT_COLUMNS}
        from workflows
        where owner_user_id = $1
          and container_key = $2
        order by updated_at desc
      `,
      [ownerUserId, containerKey.trim()],
    );

    return result.rows.map(toSummary);
  }

  async listAll(): Promise<WorkflowSummaryItem[]> {
    const result = await this.query<WorkflowDbRow>(
      `
        select ${WORKFLOW_SELECT_COLUMNS}
        from workflows
        order by updated_at desc
      `,
    );

    return result.rows.map(toSummary);
  }

  async findSummaryById(workflowId: string): Promise<WorkflowSummaryItem | null> {
    const result = await this.query<WorkflowDbRow>(
      `
        select ${WORKFLOW_SELECT_COLUMNS}
        from workflows
        where id = $1
        limit 1
      `,
      [workflowId],
    );

    return result.rows[0] ? toSummary(result.rows[0]) : null;
  }

  async findById(workflowId: string): Promise<WorkflowDetailResponseData | null> {
    const result = await this.query<WorkflowDbRow>(
      `
        select ${WORKFLOW_SELECT_COLUMNS}
        from workflows
        where id = $1
        limit 1
      `,
      [workflowId],
    );

    return result.rows[0] ? toDetail(result.rows[0]) : null;
  }

  async createWorkflow(
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    options?: {
      workflowId?: string;
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    return this.withTransaction(async (client) =>
      this.insertWorkflowRecord(client, ownerUserId, workflow, options)
    );
  }

  async createWorkflowWithBindings(
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    bindings: WorkflowFileBindingRecord[],
    options?: {
      workflowId?: string;
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    return this.withTransaction(async (client) => {
      const created = await this.insertWorkflowRecord(client, ownerUserId, workflow, options);
      await this.replaceBindingsWithExecutor(client, created.workflowId, bindings);
      return created;
    });
  }

  private async insertWorkflowRecord(
    executor: QueryExecutor,
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    options?: {
      workflowId?: string;
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    const workflowId = options?.workflowId?.trim() || workflow.id?.trim() || randomUUID();
    const groupId = options?.groupId?.trim() || null;
    const now = new Date().toISOString();
    const payload = {
      ...workflow,
      id: workflowId,
      ...(workflow.version !== undefined ? {} : { version: 1 }),
    };

    const result = await executor.query<WorkflowDbRow>(
      `
        insert into workflows (
          id,
          project_id,
          owner_user_id,
          name,
          group_id,
          container_key,
          is_auto_named,
          node_count,
          connection_count,
          timestamp,
          version,
          payload,
          created_at,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12::jsonb, $13, $14
        )
        on conflict (id) do nothing
        returning ${WORKFLOW_SELECT_COLUMNS}
      `,
      [
        workflowId,
        payload.projectId,
        ownerUserId,
        payload.name,
        groupId,
        resolveWorkflowContainerKey(groupId),
        options?.isAutoNamed ?? false,
        countObjectKeys(payload.nodes),
        Array.isArray(payload.connections) ? payload.connections.length : 0,
        payload.timestamp,
        payload.version ?? 1,
        JSON.stringify(payload),
        now,
        now,
      ],
    );

    if (!result.rows[0]) {
      throw new Error("WORKFLOW_ALREADY_EXISTS");
    }

    return toDetail(result.rows[0]);
  }

  async updateWorkflow(
    workflowId: string,
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    options?: {
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    return this.withTransaction(async (client) =>
      this.updateWorkflowRecord(client, workflowId, ownerUserId, workflow, options)
    );
  }

  async updateWorkflowWithBindings(
    workflowId: string,
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    bindings: WorkflowFileBindingRecord[],
    options?: {
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    return this.withTransaction(async (client) => {
      const updated = await this.updateWorkflowRecord(
        client,
        workflowId,
        ownerUserId,
        workflow,
        options,
      );
      await this.replaceBindingsWithExecutor(client, workflowId, bindings);
      return updated;
    });
  }

  private async updateWorkflowRecord(
    executor: QueryExecutor,
    workflowId: string,
    ownerUserId: string,
    workflow: StoredWorkflowDocument["workflow"],
    options?: {
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    const existing = await this.findByIdWithExecutor(executor, workflowId);

    if (!existing) {
      throw new Error("WORKFLOW_NOT_FOUND");
    }

    const groupId = options?.groupId !== undefined
      ? (options.groupId?.trim() || null)
      : existing.groupId;
    const nextVersion = workflow.version ?? (existing.workflow.version ?? 1) + 1;
    const payload = {
      ...workflow,
      id: workflowId,
      version: nextVersion,
    };
    const result = await executor.query<WorkflowDbRow>(
      `
        update workflows
        set
          project_id = $2,
          owner_user_id = $3,
          name = $4,
          group_id = $5,
          container_key = $6,
          is_auto_named = $7,
          node_count = $8,
          connection_count = $9,
          timestamp = $10,
          version = $11,
          payload = $12::jsonb,
          updated_at = now()
        where id = $1
        returning ${WORKFLOW_SELECT_COLUMNS}
      `,
      [
        workflowId,
        payload.projectId,
        ownerUserId,
        payload.name,
        groupId,
        resolveWorkflowContainerKey(groupId),
        options?.isAutoNamed ?? existing.isAutoNamed,
        countObjectKeys(payload.nodes),
        Array.isArray(payload.connections) ? payload.connections.length : 0,
        payload.timestamp,
        nextVersion,
        JSON.stringify(payload),
      ],
    );

    if (!result.rows[0]) {
      throw new Error("WORKFLOW_NOT_FOUND");
    }

    return toDetail(result.rows[0]);
  }

  async updateWorkflowMetadata(
    workflowId: string,
    updates: {
      name?: string;
      groupId?: string | null;
      isAutoNamed?: boolean;
    },
  ): Promise<WorkflowDetailResponseData> {
    return this.withTransaction(async (client) => {
      const existing = await this.findByIdWithExecutor(client, workflowId);

      if (!existing) {
        throw new Error("WORKFLOW_NOT_FOUND");
      }

      const groupId = updates.groupId !== undefined
        ? (updates.groupId?.trim() || null)
        : existing.groupId;
      const payload = {
        ...existing.workflow,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
      };
      const result = await client.query<WorkflowDbRow>(
        `
          update workflows
          set
            name = $2,
            group_id = $3,
            container_key = $4,
            is_auto_named = $5,
            payload = $6::jsonb,
            updated_at = now()
          where id = $1
          returning ${WORKFLOW_SELECT_COLUMNS}
        `,
        [
          workflowId,
          payload.name,
          groupId,
          resolveWorkflowContainerKey(groupId),
          updates.isAutoNamed ?? existing.isAutoNamed,
          JSON.stringify(payload),
        ],
      );

      if (!result.rows[0]) {
        throw new Error("WORKFLOW_NOT_FOUND");
      }

      return toDetail(result.rows[0]);
    });
  }

  async deleteWorkflow(workflowId: string): Promise<WorkflowDetailResponseData> {
    return this.withTransaction(async (client) => {
      const result = await client.query<WorkflowDbRow>(
        `
          delete from workflows
          where id = $1
          returning ${WORKFLOW_SELECT_COLUMNS}
        `,
        [workflowId],
      );

      if (!result.rows[0]) {
        throw new Error("WORKFLOW_NOT_FOUND");
      }

      return toDetail(result.rows[0]);
    });
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

  private async withTransaction<T>(
    callback: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withTransaction(this.pool ?? this.databaseConfig, callback);
  }

  private async findByIdWithExecutor(
    executor: QueryExecutor,
    workflowId: string,
  ): Promise<WorkflowDetailResponseData | null> {
    const result = await executor.query<WorkflowDbRow>(
      `
        select ${WORKFLOW_SELECT_COLUMNS}
        from workflows
        where id = $1
        limit 1
      `,
      [workflowId],
    );

    return result.rows[0] ? toDetail(result.rows[0]) : null;
  }

  private async replaceBindingsWithExecutor(
    executor: QueryExecutor,
    workflowId: string,
    bindings: WorkflowFileBindingRecord[],
  ): Promise<void> {
    await executor.query(
      `
        delete from workflow_file_bindings
        where workflow_id = $1
      `,
      [workflowId],
    );

    for (const binding of bindings) {
      await executor.query(
        `
          insert into workflow_file_bindings (
            id,
            workflow_id,
            owner_user_id,
            node_id,
            file_id,
            role,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          on conflict (workflow_id, node_id, file_id, role) do update set
            owner_user_id = excluded.owner_user_id,
            updated_at = excluded.updated_at
        `,
        [
          binding.bindingId,
          workflowId,
          binding.ownerUserId,
          binding.nodeId,
          binding.fileId,
          binding.role,
          binding.createdAt,
          binding.updatedAt,
        ],
      );
    }
  }
}

export class DbWorkflowGroupsRepository implements WorkflowGroupRepository {
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;

  constructor(databaseConfig: DatabaseConfig, options: DbWorkflowRepositoryOptions = {}) {
    this.databaseConfig = databaseConfig;
    this.pool = options.pool ?? null;
  }

  async ensureInitialized(): Promise<void> {
    await this.query("select 1 as ok");
  }

  async listByOwner(ownerUserId: string): Promise<WorkflowGroupSummaryItem[]> {
    const result = await this.query<WorkflowGroupDbRow>(
      `
        select id, owner_user_id, name, created_at, updated_at
        from workflow_groups
        where owner_user_id = $1
        order by name asc
      `,
      [ownerUserId],
    );

    return result.rows.map(toGroupSummary);
  }

  async listAll(): Promise<WorkflowGroupSummaryItem[]> {
    const result = await this.query<WorkflowGroupDbRow>(
      `
        select id, owner_user_id, name, created_at, updated_at
        from workflow_groups
        order by updated_at asc
      `,
    );

    return result.rows.map(toGroupSummary);
  }

  async findById(groupId: string): Promise<WorkflowGroupSummaryItem | null> {
    const result = await this.query<WorkflowGroupDbRow>(
      `
        select id, owner_user_id, name, created_at, updated_at
        from workflow_groups
        where id = $1
        limit 1
      `,
      [groupId],
    );

    return result.rows[0] ? toGroupSummary(result.rows[0]) : null;
  }

  async upsertGroup(
    input: Omit<WorkflowGroupSummaryItem, "createdAt" | "updatedAt">
      & Partial<Pick<WorkflowGroupSummaryItem, "createdAt" | "updatedAt">>,
  ): Promise<WorkflowGroupSummaryItem> {
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = now;
    const result = await this.query<WorkflowGroupDbRow>(
      `
        insert into workflow_groups (
          id,
          owner_user_id,
          name,
          payload,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4::jsonb, $5, $6)
        on conflict (id) do update set
          owner_user_id = excluded.owner_user_id,
          name = excluded.name,
          payload = excluded.payload,
          updated_at = excluded.updated_at
        returning id, owner_user_id, name, created_at, updated_at
      `,
      [
        input.groupId,
        input.ownerUserId,
        input.name,
        JSON.stringify({ workflowCount: input.workflowCount }),
        createdAt,
        updatedAt,
      ],
    );

    return toGroupSummary(result.rows[0]!);
  }

  async createGroup(ownerUserId: string, name: string): Promise<WorkflowGroupSummaryItem> {
    return this.upsertGroup({
      groupId: randomUUID(),
      ownerUserId,
      name,
      workflowCount: 0,
    });
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.query(
      `
        delete from workflow_groups
        where id = $1
      `,
      [groupId],
    );
  }

  async renameGroup(groupId: string, name: string): Promise<WorkflowGroupSummaryItem> {
    const result = await this.query<WorkflowGroupDbRow>(
      `
        update workflow_groups
        set
          name = $2,
          updated_at = now()
        where id = $1
        returning id, owner_user_id, name, created_at, updated_at
      `,
      [groupId, name],
    );

    if (!result.rows[0]) {
      throw new Error("WORKFLOW_GROUP_NOT_FOUND");
    }

    return toGroupSummary(result.rows[0]);
  }

  async updateWorkflowCount(
    groupId: string,
    workflowCount: number,
  ): Promise<WorkflowGroupSummaryItem> {
    const existing = await this.findById(groupId);

    if (!existing) {
      throw new Error("WORKFLOW_GROUP_NOT_FOUND");
    }

    return this.upsertGroup({
      ...existing,
      workflowCount,
    });
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
}
