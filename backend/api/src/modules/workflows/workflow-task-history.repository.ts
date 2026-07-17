import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  ExecutionStatus,
  ExecutionStepType,
  NodeTaskType,
} from "@newworkflow/backend-shared/execution";
import {
  type DatabaseConfig,
  type DatabasePool,
  queryPostgres,
} from "@newworkflow/backend-shared";
import type {
  ExecutionRunRecord,
  ExecutionTaskEventRecord,
  ExecutionTaskRecord,
} from "../executions/execution-records.types.ts";

export type WorkflowTaskHistorySortBy =
  | "sequence"
  | "createdAt"
  | "startedAt"
  | "completedAt";

export type WorkflowTaskHistorySortOrder = "asc" | "desc";

export interface WorkflowTaskHistoryRecord {
  sequence: number;
  taskId: string;
  taskNo: string;
  runId: string;
  runNo: string | null;
  userId: string | null;
  workflowId: string;
  projectId: string | null;
  nodeType: string;
  nodeId: string | null;
  nodeTitle: string | null;
  taskType: NodeTaskType;
  groupId: string | null;
  groupOrder: number | null;
  provider: string | null;
  model: string | null;
  input: Record<string, unknown> | null;
  status: ExecutionStatus;
  currentStep: ExecutionStepType | null;
  currentAttemptNo: number;
  retryCount: number;
  maxRetries: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  resultFileId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  whiteModelFileId: string | null;
  styleReferenceFileId: string | null;
}

export interface WorkflowTaskHistoryListQuery {
  runId?: string;
  status?: ExecutionStatus;
  nodeId?: string;
  nodeType?: string;
  taskType?: string;
  page: number;
  pageSize: number;
  sortBy: WorkflowTaskHistorySortBy;
  sortOrder: WorkflowTaskHistorySortOrder;
}

export interface WorkflowTaskHistoryListResult {
  items: WorkflowTaskHistoryRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WorkflowTaskHistoryEventListQuery {
  page: number;
  pageSize: number;
  sortOrder: WorkflowTaskHistorySortOrder;
}

export interface WorkflowTaskHistoryEventListResult {
  items: ExecutionTaskEventRecord[];
  total: number;
  page: number;
  pageSize: number;
}

interface WorkflowTaskHistoryIndex {
  nextSequence: number;
  items: WorkflowTaskHistoryRecord[];
}

type DbQueryRow = Record<string, unknown>;

interface WorkflowTaskHistoryDbRow extends DbQueryRow {
  sequence: string | number;
  task_id: string;
  task_no: string;
  run_id: string;
  run_no: string | null;
  user_id: string | null;
  workflow_id: string;
  project_id: string | null;
  node_type: string;
  node_id: string | null;
  node_title: string | null;
  task_type: string;
  group_id: string | null;
  group_order: number | null;
  provider: string | null;
  model: string | null;
  input: unknown;
  status: ExecutionStatus;
  current_step: ExecutionStepType | null;
  current_attempt_no: number;
  retry_count: number;
  max_retries: number;
  last_error_code: string | null;
  last_error_message: string | null;
  result_file_id: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface TaskEventDbRow extends DbQueryRow {
  id: string;
  run_id: string;
  task_id: string;
  attempt_no: number | null;
  event_type: ExecutionTaskEventRecord["eventType"];
  status: ExecutionTaskEventRecord["status"];
  phase: ExecutionTaskEventRecord["phase"];
  step_type: ExecutionTaskEventRecord["stepType"];
  progress: number;
  message: string | null;
  payload: unknown;
  created_at: Date | string;
}

interface CountDbRow extends DbQueryRow {
  total: string | number;
}

export interface WorkflowTaskHistoryRepositoryOptions {
  databaseConfig?: DatabaseConfig;
  pool?: DatabasePool;
  mode?: "json" | "db";
}

function createEmptyIndex(): WorkflowTaskHistoryIndex {
  return {
    nextSequence: 0,
    items: [],
  };
}

function toDurationMs(
  startedAt: string | null,
  completedAt: string | null,
): number | null {
  if (!startedAt || !completedAt) {
    return null;
  }

  const startedAtMs = Date.parse(startedAt);
  const completedAtMs = Date.parse(completedAt);

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) {
    return null;
  }

  return Math.max(0, completedAtMs - startedAtMs);
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toTaskHistoryRecord(
  sequence: number,
  runNo: string | null,
  task: ExecutionTaskRecord,
): WorkflowTaskHistoryRecord {
  return {
    sequence,
    taskId: task.id,
    taskNo: task.taskNo,
    runId: task.runId,
    runNo,
    userId: task.userId,
    workflowId: task.workflowId ?? "",
    projectId: task.projectId,
    nodeType: task.nodeType,
    nodeId: task.nodeId,
    nodeTitle: task.nodeTitle,
    taskType: task.taskType,
    groupId: task.groupId,
    groupOrder: task.groupOrder,
    provider: task.provider,
    model: task.model,
    input: task.input,
    status: task.status,
    currentStep: task.currentStep,
    currentAttemptNo: task.currentAttemptNo,
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    lastErrorCode: task.lastErrorCode,
    lastErrorMessage: task.lastErrorMessage,
    resultFileId: task.resultFileId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    durationMs: toDurationMs(task.startedAt, task.completedAt),
    whiteModelFileId: task.whiteModelFileId,
    styleReferenceFileId: task.styleReferenceFileId,
  };
}

function toDbTaskHistoryRecord(row: WorkflowTaskHistoryDbRow): WorkflowTaskHistoryRecord {
  const input = toJsonRecord(row.input);
  const createdAt = toIsoString(row.created_at)!;
  const startedAt = toIsoString(row.started_at);
  const completedAt = toIsoString(row.completed_at);

  return {
    sequence: Number(row.sequence),
    taskId: row.task_id,
    taskNo: row.task_no,
    runId: row.run_id,
    runNo: row.run_no,
    userId: row.user_id,
    workflowId: row.workflow_id,
    projectId: row.project_id,
    nodeType: row.node_type,
    nodeId: row.node_id,
    nodeTitle: row.node_title,
    taskType: row.task_type as NodeTaskType,
    groupId: row.group_id,
    groupOrder: row.group_order,
    provider: row.provider,
    model: row.model,
    input,
    status: row.status,
    currentStep: row.current_step,
    currentAttemptNo: Number(row.current_attempt_no),
    retryCount: Number(row.retry_count),
    maxRetries: Number(row.max_retries),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    resultFileId: row.result_file_id,
    createdAt,
    startedAt,
    completedAt,
    durationMs: toDurationMs(startedAt, completedAt),
    whiteModelFileId: toOptionalString(input?.whiteModelFileId),
    styleReferenceFileId: toOptionalString(input?.styleReferenceFileId),
  };
}

function toTaskEventRecord(row: TaskEventDbRow): ExecutionTaskEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    attemptNo: row.attempt_no,
    eventType: row.event_type,
    status: row.status,
    phase: row.phase,
    stepType: row.step_type,
    progress: Number(row.progress),
    message: row.message,
    payload: toJsonRecord(row.payload),
    createdAt: toIsoString(row.created_at)!,
  };
}

function compareSortableValue(
  left: number | string | null,
  right: number | string | null,
): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return -1;
  }

  if (right === null) {
    return 1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

function toSortValue(
  record: WorkflowTaskHistoryRecord,
  sortBy: WorkflowTaskHistorySortBy,
): number | string | null {
  switch (sortBy) {
    case "createdAt":
      return record.createdAt;
    case "startedAt":
      return record.startedAt;
    case "completedAt":
      return record.completedAt;
    case "sequence":
    default:
      return record.sequence;
  }
}

function normalizeJsonlLines(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export class WorkflowTaskHistoryRepository {
  private readonly dataDir: string;
  private readonly workflowsDir: string;
  private readonly databaseConfig: DatabaseConfig | null;
  private readonly pool: DatabasePool | null;
  private readonly mode: "json" | "db";
  private readonly lockRetryDelayMs = 25;
  private readonly lockTimeoutMs = 5_000;
  private readonly staleLockThresholdMs = 30_000;
  private readonly unlockRetryCount = 3;

  constructor(rootDir: string, options: WorkflowTaskHistoryRepositoryOptions = {}) {
    this.dataDir = path.join(rootDir, "data");
    this.workflowsDir = path.join(this.dataDir, "workflows");
    this.databaseConfig = options.databaseConfig ?? null;
    this.pool = options.pool ?? null;
    this.mode = options.mode ?? "json";
  }

  async ensureInitialized(workflowId: string): Promise<void> {
    if (this.isDbMode()) {
      await this.query("select 1 as ok");
      return;
    }

    await this.withWorkflowHistoryLock(workflowId, async () => {
      await this.ensureInitializedUnsafe(workflowId);
    });
  }

  async recordExecutionCreated(
    run: ExecutionRunRecord,
    tasks: ExecutionTaskRecord[],
    events: ExecutionTaskEventRecord[],
  ): Promise<void> {
    if (this.isDbMode()) {
      return;
    }

    const tasksByWorkflow = new Map<string, ExecutionTaskRecord[]>();
    const eventsByTaskId = new Map(events.map((event) => [event.taskId, event]));

    for (const task of tasks) {
      if (!task.workflowId) {
        continue;
      }

      const existing = tasksByWorkflow.get(task.workflowId) ?? [];
      existing.push(task);
      tasksByWorkflow.set(task.workflowId, existing);
    }

    for (const [workflowId, workflowTasks] of tasksByWorkflow.entries()) {
      await this.withWorkflowHistoryLock(workflowId, async () => {
        const index = await this.readIndexUnsafe(workflowId);

        for (const task of workflowTasks) {
          const existing = index.items.find((item) => item.taskId === task.id);
          const sequence = existing?.sequence ?? index.nextSequence + 1;

          if (!existing) {
            index.nextSequence = sequence;
          }

          const record = toTaskHistoryRecord(sequence, run.runNo, task);
          index.items = index.items.filter((item) => item.taskId !== task.id);
          index.items.push(record);

          const event = eventsByTaskId.get(task.id);
          if (event) {
            await this.appendEventUnsafe(workflowId, task.id, event);
          }
        }

        await this.writeIndexUnsafe(workflowId, index);
      });
    }
  }

  async syncTask(task: ExecutionTaskRecord): Promise<void> {
    if (this.isDbMode()) {
      return;
    }

    if (!task.workflowId) {
      return;
    }

    await this.withWorkflowHistoryLock(task.workflowId, async () => {
      const index = await this.readIndexUnsafe(task.workflowId!);
      const existing = index.items.find((item) => item.taskId === task.id);
      const sequence = existing?.sequence ?? index.nextSequence + 1;

      if (!existing) {
        index.nextSequence = sequence;
      }

      const record = toTaskHistoryRecord(sequence, existing?.runNo ?? null, task);
      index.items = index.items.filter((item) => item.taskId !== task.id);
      index.items.push(record);
      await this.writeIndexUnsafe(task.workflowId!, index);
    });
  }

  async appendTaskEvent(
    task: ExecutionTaskRecord,
    event: ExecutionTaskEventRecord,
  ): Promise<void> {
    if (this.isDbMode()) {
      return;
    }

    if (!task.workflowId) {
      return;
    }

    await this.withWorkflowHistoryLock(task.workflowId, async () => {
      await this.ensureInitializedUnsafe(task.workflowId!);
      await this.appendEventUnsafe(task.workflowId!, task.id, event);
    });
  }

  async getTaskById(
    workflowId: string,
    taskId: string,
  ): Promise<WorkflowTaskHistoryRecord | null> {
    if (this.isDbMode()) {
      const result = await this.query<WorkflowTaskHistoryDbRow>(
        `
          with history_tasks as (
            ${this.getDbTaskBaseSelect()}
            where t.workflow_id = $1
          )
          select *
          from history_tasks
          where task_id = $2
          limit 1
        `,
        [workflowId, taskId],
      );

      return result.rows[0] ? toDbTaskHistoryRecord(result.rows[0]) : null;
    }

    return this.withWorkflowHistoryLock(workflowId, async () => {
      const index = await this.readIndexUnsafe(workflowId);
      return index.items.find((item) => item.taskId === taskId) ?? null;
    });
  }

  async listTasks(
    workflowId: string,
    query: WorkflowTaskHistoryListQuery,
  ): Promise<WorkflowTaskHistoryListResult> {
    if (this.isDbMode()) {
      return this.listTasksFromDb(workflowId, query);
    }

    return this.withWorkflowHistoryLock(workflowId, async () => {
      const index = await this.readIndexUnsafe(workflowId);
      let items = [...index.items];

      if (query.runId) {
        items = items.filter((item) => item.runId === query.runId);
      }

      if (query.status) {
        items = items.filter((item) => item.status === query.status);
      }

      if (query.nodeId) {
        items = items.filter((item) => item.nodeId === query.nodeId);
      }

      if (query.nodeType) {
        items = items.filter((item) => item.nodeType === query.nodeType);
      }

      if (query.taskType) {
        items = items.filter((item) => item.taskType === query.taskType);
      }

      items.sort((left, right) => {
        const order = compareSortableValue(
          toSortValue(left, query.sortBy),
          toSortValue(right, query.sortBy),
        );

        if (order !== 0) {
          return query.sortOrder === "asc" ? order : -order;
        }

        return query.sortOrder === "asc"
          ? left.sequence - right.sequence
          : right.sequence - left.sequence;
      });

      const total = items.length;
      const start = (query.page - 1) * query.pageSize;

      return {
        items: items.slice(start, start + query.pageSize),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async getTaskEvents(
    workflowId: string,
    taskId: string,
    query?: Partial<WorkflowTaskHistoryEventListQuery>,
  ): Promise<WorkflowTaskHistoryEventListResult> {
    if (this.isDbMode()) {
      return this.getTaskEventsFromDb(workflowId, taskId, query);
    }

    return this.withWorkflowHistoryLock(workflowId, async () => {
      await this.ensureInitializedUnsafe(workflowId);

      const raw = await this.readEventsFileUnsafe(workflowId, taskId);
      const items = normalizeJsonlLines(raw)
        .map((line) => JSON.parse(line) as ExecutionTaskEventRecord)
        .sort((left, right) => {
          if (left.createdAt === right.createdAt) {
            return left.id.localeCompare(right.id);
          }

          return left.createdAt < right.createdAt ? -1 : 1;
        });

      const sortOrder = query?.sortOrder ?? "asc";
      const page = query?.page ?? 1;
      const pageSize = query?.pageSize ?? Math.max(items.length, 1);
      const sortedItems = sortOrder === "asc" ? items : [...items].reverse();
      const start = (page - 1) * pageSize;

      return {
        items: sortedItems.slice(start, start + pageSize),
        total: items.length,
        page,
        pageSize,
      };
    });
  }

  async query<T extends DbQueryRow = DbQueryRow>(
    text: string,
    values?: readonly unknown[],
  ) {
    if (this.pool) {
      return this.pool.query<T>(text, values);
    }

    if (!this.databaseConfig) {
      throw new Error("DATABASE_CONFIG_REQUIRED");
    }

    return queryPostgres<T>(this.databaseConfig, text, values);
  }

  private isDbMode(): boolean {
    return this.mode === "db";
  }

  private async listTasksFromDb(
    workflowId: string,
    query: WorkflowTaskHistoryListQuery,
  ): Promise<WorkflowTaskHistoryListResult> {
    const conditions: string[] = [];
    const values: unknown[] = [workflowId];
    const addFilter = (column: string, value: unknown) => {
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    };

    if (query.runId) {
      addFilter("run_id", query.runId);
    }
    if (query.status) {
      addFilter("status", query.status);
    }
    if (query.nodeId) {
      addFilter("node_id", query.nodeId);
    }
    if (query.nodeType) {
      addFilter("node_type", query.nodeType);
    }
    if (query.taskType) {
      addFilter("task_type", query.taskType);
    }

    const whereClause = conditions.length > 0
      ? `where ${conditions.join(" and ")}`
      : "";
    const countResult = await this.query<CountDbRow>(
      `
        with history_tasks as (
          ${this.getDbTaskBaseSelect()}
          where t.workflow_id = $1
        )
        select count(*) as total
        from history_tasks
        ${whereClause}
      `,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;
    const orderBy = this.toDbOrderBy(query.sortBy, query.sortOrder);
    const result = await this.query<WorkflowTaskHistoryDbRow>(
      `
        with history_tasks as (
          ${this.getDbTaskBaseSelect()}
          where t.workflow_id = $1
        )
        select *
        from history_tasks
        ${whereClause}
        ${orderBy}
        limit $${values.length + 1}
        offset $${values.length + 2}
      `,
      [...values, query.pageSize, offset],
    );

    return {
      items: result.rows.map(toDbTaskHistoryRecord),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async getTaskEventsFromDb(
    workflowId: string,
    taskId: string,
    query?: Partial<WorkflowTaskHistoryEventListQuery>,
  ): Promise<WorkflowTaskHistoryEventListResult> {
    const sortOrder = query?.sortOrder ?? "asc";
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 50;
    const offset = (page - 1) * pageSize;
    const countResult = await this.query<CountDbRow>(
      `
        select count(*) as total
        from task_events
        where workflow_id = $1
          and task_id = $2
      `,
      [workflowId, taskId],
    );
    const result = await this.query<TaskEventDbRow>(
      `
        select
          id::text,
          run_id::text,
          task_id::text,
          attempt_no,
          event_type,
          status,
          phase,
          step_type,
          progress,
          message,
          payload,
          created_at
        from task_events
        where workflow_id = $1
          and task_id = $2
        order by created_at ${sortOrder}, id ${sortOrder}
        limit $3
        offset $4
      `,
      [workflowId, taskId, pageSize, offset],
    );

    return {
      items: result.rows.map(toTaskEventRecord),
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }

  private toDbOrderBy(
    sortBy: WorkflowTaskHistorySortBy,
    sortOrder: WorkflowTaskHistorySortOrder,
  ): string {
    const direction = sortOrder === "asc" ? "asc" : "desc";

    switch (sortBy) {
      case "createdAt":
        return `order by created_at ${direction}, task_id ${direction}`;
      case "startedAt":
        return `order by started_at ${direction} nulls last, created_at ${direction}, task_id ${direction}`;
      case "completedAt":
        return `order by completed_at ${direction} nulls last, created_at ${direction}, task_id ${direction}`;
      case "sequence":
      default:
        return `order by sequence ${direction}`;
    }
  }

  private getDbTaskBaseSelect(): string {
    return `
      select
      row_number() over (order by t.created_at asc, t.task_no asc, t.id asc) as sequence,
      t.id::text as task_id,
      t.task_no,
      t.run_id::text,
      r.run_no,
      t.user_id,
      t.workflow_id,
      t.project_id,
      t.node_type,
      t.node_id,
      t.node_title,
      t.task_type,
      t.group_id,
      t.group_order,
      t.provider,
      t.model,
      t.input,
      t.status,
      t.current_step,
      t.current_attempt_no,
      t.retry_count,
      t.max_retries,
      t.last_error_code,
      t.last_error_message,
      t.result_file_id::text,
      t.created_at,
      t.started_at,
      t.completed_at
      from execution_tasks t
      join execution_runs r on r.id = t.run_id
    `;
  }

  private getWorkflowDir(workflowId: string): string {
    return path.join(this.workflowsDir, workflowId);
  }

  private getHistoryDir(workflowId: string): string {
    return path.join(this.getWorkflowDir(workflowId), "task-history");
  }

  private getEventsDir(workflowId: string): string {
    return path.join(this.getHistoryDir(workflowId), "events");
  }

  private getIndexPath(workflowId: string): string {
    return path.join(this.getHistoryDir(workflowId), "index.json");
  }

  private getLockPath(workflowId: string): string {
    return path.join(this.getHistoryDir(workflowId), "history.lock");
  }

  private getEventsPath(workflowId: string, taskId: string): string {
    return path.join(this.getEventsDir(workflowId), `${taskId}.jsonl`);
  }

  private async ensureInitializedUnsafe(workflowId: string): Promise<void> {
    await fs.mkdir(this.workflowsDir, { recursive: true });
    await fs.mkdir(this.getHistoryDir(workflowId), { recursive: true });
    await fs.mkdir(this.getEventsDir(workflowId), { recursive: true });

    try {
      await fs.access(this.getIndexPath(workflowId));
    } catch {
      await this.writeJsonAtomic(this.getIndexPath(workflowId), createEmptyIndex());
    }
  }

  private async readIndexUnsafe(workflowId: string): Promise<WorkflowTaskHistoryIndex> {
    await this.ensureInitializedUnsafe(workflowId);
    const raw = await fs.readFile(this.getIndexPath(workflowId), "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkflowTaskHistoryIndex>;

    return {
      nextSequence: parsed.nextSequence ?? 0,
      items: parsed.items ?? [],
    };
  }

  private async writeIndexUnsafe(
    workflowId: string,
    index: WorkflowTaskHistoryIndex,
  ): Promise<void> {
    await this.writeJsonAtomic(this.getIndexPath(workflowId), index);
  }

  private async readEventsFileUnsafe(workflowId: string, taskId: string): Promise<string> {
    try {
      return await fs.readFile(this.getEventsPath(workflowId, taskId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return "";
      }

      throw error;
    }
  }

  private async appendEventUnsafe(
    workflowId: string,
    taskId: string,
    event: ExecutionTaskEventRecord,
  ): Promise<void> {
    const eventPath = this.getEventsPath(workflowId, taskId);
    await fs.mkdir(path.dirname(eventPath), { recursive: true });
    await fs.appendFile(eventPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tempPath, filePath);
  }

  private async withWorkflowHistoryLock<T>(
    workflowId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    await fs.mkdir(this.getHistoryDir(workflowId), { recursive: true });
    const lockPath = this.getLockPath(workflowId);
    const startedAt = Date.now();

    while (true) {
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

      try {
        handle = await fs.open(lockPath, "wx");
      } catch (error) {
        if (!this.isLockConflictError(error)) {
          throw error;
        }

        await this.cleanupStaleLockIfNeeded(lockPath);

        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new Error("WORKFLOW_TASK_HISTORY_LOCK_TIMEOUT");
        }

        await this.delay(this.lockRetryDelayMs);
        continue;
      }

      try {
        return await action();
      } finally {
        await handle.close();
        await this.releaseLockFile(lockPath);
      }
    }
  }

  private isLockConflictError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "EEXIST" || code === "EPERM" || code === "EACCES";
  }

  private async cleanupStaleLockIfNeeded(lockPath: string): Promise<void> {
    try {
      const stat = await fs.stat(lockPath);

      if (Date.now() - stat.mtimeMs < this.staleLockThresholdMs) {
        return;
      }

      await fs.rm(lockPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async releaseLockFile(lockPath: string): Promise<void> {
    for (let attempt = 0; attempt <= this.unlockRetryCount; attempt += 1) {
      try {
        await fs.rm(lockPath, { force: true });
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
}
