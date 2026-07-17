import type {
  ExecutionPhase,
  ExecutionStatus,
  ExecutionStepType,
  NodeTaskType,
  TaskEventType,
} from "../../shared/src/types/execution.ts";
import type { TaskFileRole } from "../../shared/src/types/file.ts";
import type { DatabaseConfig } from "../../shared/src/db/db-config.ts";
import type {
  DatabaseClient,
  DatabasePool,
  QueryResult,
  QueryResultRow,
} from "../../shared/src/db/postgres-client.ts";

export const TEST_DATABASE_CONFIG: DatabaseConfig = {
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

export interface ExecutionRunMemoryRow extends QueryResultRow {
  id: string;
  run_no: string;
  user_id: string | null;
  workflow_id: string | null;
  project_id: string | null;
  node_type: string;
  task_type: NodeTaskType;
  execution_mode: string;
  node_id: string | null;
  node_title: string | null;
  provider: string | null;
  status: ExecutionStatus;
  total_task_count: number;
  completed_task_count: number;
  failed_task_count: number;
  request_payload: Record<string, unknown>;
  result_summary: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ExecutionTaskMemoryRow extends QueryResultRow {
  id: string;
  task_no: string;
  run_id: string;
  user_id: string | null;
  workflow_id: string | null;
  project_id: string | null;
  node_type: string;
  node_id: string | null;
  node_title: string | null;
  task_type: NodeTaskType;
  group_id: string | null;
  group_order: number | null;
  provider: string | null;
  model: string | null;
  input: Record<string, unknown> | null;
  status: ExecutionStatus;
  current_step: ExecutionStepType | null;
  current_attempt_no: number;
  retry_count: number;
  max_retries: number;
  last_error_code: string | null;
  last_error_message: string | null;
  result_file_id: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_until: string | null;
  heartbeat_at: string | null;
  attempt_started_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TaskAttemptMemoryRow extends QueryResultRow {
  task_id: string;
  attempt_no: number;
  status: ExecutionStatus;
  current_step: ExecutionStepType | null;
  progress: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface TaskEventMemoryRow extends QueryResultRow {
  id: string;
  run_id: string;
  task_id: string;
  workflow_id: string | null;
  attempt_no: number | null;
  event_type: TaskEventType;
  status: ExecutionStatus;
  phase: ExecutionPhase;
  step_type: ExecutionStepType | null;
  progress: number;
  message: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskFileLinkMemoryRow extends QueryResultRow {
  id: string;
  task_id: string;
  file_id: string;
  workflow_id: string | null;
  role: TaskFileRole;
  order_index: number | null;
  source_handle: string | null;
  group_id: string | null;
  created_at: string;
}

export interface ProviderLeaseMemoryRow extends QueryResultRow {
  id: string;
  provider_key: string;
  task_id: string;
  worker_id: string;
  lease_until: string;
  acquired_at: string;
  heartbeat_at: string;
  metadata: Record<string, unknown>;
}

interface CountRow extends QueryResultRow {
  total: number;
}

interface ProviderCountRow extends QueryResultRow {
  provider_key: string | null;
  total: number;
}

class InMemoryDatabaseClient implements DatabaseClient {
  constructor(private readonly pool: InMemoryExecutionsDatabasePool) {}

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

function normalizeSql(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return JSON.parse(value) as Record<string, unknown>;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function compareTaskOrder(
  left: Pick<ExecutionTaskMemoryRow, "created_at" | "group_order" | "id">,
  right: Pick<ExecutionTaskMemoryRow, "created_at" | "group_order" | "id">,
): number {
  if (left.created_at !== right.created_at) {
    return left.created_at < right.created_at ? -1 : 1;
  }

  const leftGroupOrder = left.group_order ?? Number.MAX_SAFE_INTEGER;
  const rightGroupOrder = right.group_order ?? Number.MAX_SAFE_INTEGER;

  if (leftGroupOrder !== rightGroupOrder) {
    return leftGroupOrder - rightGroupOrder;
  }

  return left.id.localeCompare(right.id);
}

function compareTaskEvents(
  left: Pick<TaskEventMemoryRow, "created_at" | "id">,
  right: Pick<TaskEventMemoryRow, "created_at" | "id">,
): number {
  if (left.created_at !== right.created_at) {
    return left.created_at < right.created_at ? -1 : 1;
  }

  return left.id.localeCompare(right.id);
}

export class InMemoryExecutionsDatabasePool implements DatabasePool {
  readonly runs: ExecutionRunMemoryRow[] = [];
  readonly tasks: ExecutionTaskMemoryRow[] = [];
  readonly events: TaskEventMemoryRow[] = [];
  readonly taskFileLinks: TaskFileLinkMemoryRow[] = [];
  readonly attempts: TaskAttemptMemoryRow[] = [];
  readonly providerLeases: ProviderLeaseMemoryRow[] = [];
  private runSequence = 0;
  private taskSequence = 0;

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
    const normalized = normalizeSql(text);

    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return createResult([] as T[]);
    }

    if (normalized.startsWith("select 1 as ok")) {
      return createResult(asRows<T>([{ ok: 1 }]));
    }

    if (normalized.startsWith("lock table provider_concurrency_leases")) {
      return createResult([] as T[]);
    }

    if (normalized.startsWith("delete from provider_concurrency_leases where id = $1")) {
      const index = this.providerLeases.findIndex((lease) => lease.id === values[0]);
      if (index >= 0) {
        this.providerLeases.splice(index, 1);
      }
      return createResult([] as T[]);
    }

    if (normalized.startsWith("delete from provider_concurrency_leases where lease_until < now()")) {
      const now = Date.now();
      for (let index = this.providerLeases.length - 1; index >= 0; index -= 1) {
        if (Date.parse(this.providerLeases[index]!.lease_until) < now) {
          this.providerLeases.splice(index, 1);
        }
      }
      return createResult([] as T[]);
    }

    if (normalized.includes("from provider_concurrency_leases") && normalized.includes("count(*) as total")) {
      const providerKey = values[0] as string;
      const now = Date.now();
      return createResult(asRows<T>([{
        total: this.providerLeases.filter((lease) =>
          lease.provider_key === providerKey && Date.parse(lease.lease_until) >= now).length,
      }]));
    }

    if (normalized.startsWith("insert into provider_concurrency_leases")) {
      const row = this.upsertProviderLease(values);
      return createResult(asRows<T>([{ id: row.id }]));
    }

    if (normalized.includes("nextval('execution_run_no_seq'::regclass)")) {
      this.runSequence += 1;
      return createResult(asRows<T>([{ value: this.runSequence }]));
    }

    if (normalized.includes("nextval('execution_task_no_seq'::regclass)")) {
      const count = normalized.includes("generate_series")
        ? Number(values[0] ?? 1)
        : 1;
      const rows = Array.from({ length: count }, () => {
        this.taskSequence += 1;
        return { value: this.taskSequence };
      });
      return createResult(asRows<T>(rows));
    }

    if (normalized.startsWith("insert into execution_runs")) {
      this.upsertRun(values);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into execution_tasks")) {
      this.upsertTask(values);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into task_events")) {
      this.insertEvent(values);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into task_file_links")) {
      this.upsertTaskFileLink(values);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("insert into task_attempts")) {
      this.upsertTaskAttempt(values);
      return createResult([] as T[]);
    }

    if (normalized.startsWith("update execution_tasks set heartbeat_at")) {
      const task = this.tasks.find((item) =>
        item.id === values[0]
        && item.status === "processing"
        && item.claimed_by === values[1]);

      if (!task) {
        return createResult([] as T[]);
      }

      task.heartbeat_at = values[2] as string;
      task.lease_until = values[3] as string;
      return createResult(asRows<T>([{ id: task.id }]));
    }

    if (
      normalized.includes("from task_events")
      && normalized.includes("order by created_at desc")
      && normalized.includes("limit 1")
    ) {
      return createResult(asRows<T>(
        this.events
          .filter((event) => event.task_id === values[0])
          .sort((left, right) => compareTaskEvents(right, left))
          .slice(0, 1),
      ));
    }

    if (normalized.startsWith("with history_tasks as")) {
      return this.queryWorkflowHistory<T>(normalized, values);
    }

    if (normalized.startsWith("select count(*) as total from execution_runs")) {
      return createResult(asRows<T>([{ total: this.runs.length } satisfies CountRow]));
    }

    if (normalized.includes("from execution_runs")) {
      return this.queryExecutionRuns<T>(normalized, values);
    }

    if (normalized.startsWith("select count(*) as total from execution_tasks")) {
      const rows = this.filterTasksFromSql(normalized, values, 0);
      return createResult(asRows<T>([{ total: rows.length } satisfies CountRow]));
    }

    if (normalized.includes("from execution_tasks")) {
      return this.queryExecutionTasks<T>(normalized, values);
    }

    if (normalized.includes("from task_events")) {
      return this.queryTaskEvents<T>(normalized, values);
    }

    if (normalized.includes("from task_file_links")) {
      return this.queryTaskFileLinks<T>(values);
    }

    throw new Error(`UNHANDLED_TEST_QUERY:${normalized}`);
  }

  private upsertRun(values: readonly unknown[]): void {
    const row: ExecutionRunMemoryRow = {
      id: values[0] as string,
      run_no: values[1] as string,
      user_id: values[2] as string | null,
      workflow_id: values[3] as string | null,
      project_id: values[4] as string | null,
      node_type: values[5] as string,
      task_type: values[6] as NodeTaskType,
      execution_mode: values[7] as string,
      node_id: values[8] as string | null,
      node_title: values[9] as string | null,
      provider: values[10] as string | null,
      status: values[11] as ExecutionStatus,
      total_task_count: values[12] as number,
      completed_task_count: values[13] as number,
      failed_task_count: values[14] as number,
      request_payload: parseJsonRecord(values[15]) ?? {},
      result_summary: parseJsonRecord(values[16]),
      created_at: values[17] as string,
      started_at: values[18] as string | null,
      completed_at: values[19] as string | null,
    };
    const existing = this.runs.find((item) => item.id === row.id);

    if (existing) {
      Object.assign(existing, row);
      return;
    }

    this.runs.push(row);
  }

  private upsertTask(values: readonly unknown[]): void {
    const row: ExecutionTaskMemoryRow = {
      id: values[0] as string,
      task_no: values[1] as string,
      run_id: values[2] as string,
      user_id: values[3] as string | null,
      workflow_id: values[4] as string | null,
      project_id: values[5] as string | null,
      node_type: values[6] as string,
      node_id: values[7] as string | null,
      node_title: values[8] as string | null,
      task_type: values[9] as NodeTaskType,
      group_id: values[10] as string | null,
      group_order: values[11] as number | null,
      provider: values[12] as string | null,
      model: values[13] as string | null,
      input: parseJsonRecord(values[14]),
      status: values[15] as ExecutionStatus,
      current_step: values[16] as ExecutionStepType | null,
      current_attempt_no: values[17] as number,
      retry_count: values[18] as number,
      max_retries: values[19] as number,
      last_error_code: values[20] as string | null,
      last_error_message: values[21] as string | null,
      result_file_id: values[22] as string | null,
      claimed_by: values[23] as string | null,
      claimed_at: values[24] as string | null,
      lease_until: values[25] as string | null,
      heartbeat_at: values[26] as string | null,
      attempt_started_at: values[27] as string | null,
      created_at: values[28] as string,
      started_at: values[29] as string | null,
      completed_at: values[30] as string | null,
    };
    const existing = this.tasks.find((item) => item.id === row.id);

    if (existing) {
      Object.assign(existing, row);
      return;
    }

    this.tasks.push(row);
  }

  private insertEvent(values: readonly unknown[]): void {
    if (this.events.some((event) => event.id === values[0])) {
      return;
    }

    this.events.push({
      id: values[0] as string,
      run_id: values[1] as string,
      task_id: values[2] as string,
      workflow_id: values[3] as string | null,
      attempt_no: values[4] as number | null,
      event_type: values[5] as TaskEventType,
      status: values[6] as ExecutionStatus,
      phase: values[7] as ExecutionPhase,
      step_type: values[8] as ExecutionStepType | null,
      progress: values[9] as number,
      message: values[10] as string | null,
      payload: parseJsonRecord(values[11]),
      created_at: values[12] as string,
    });
  }

  private upsertTaskFileLink(values: readonly unknown[]): void {
    const row: TaskFileLinkMemoryRow = {
      id: values[0] as string,
      task_id: values[1] as string,
      file_id: values[2] as string,
      workflow_id: values[3] as string | null,
      role: values[4] as TaskFileRole,
      order_index: values[5] as number | null,
      source_handle: values[6] as string | null,
      group_id: values[7] as string | null,
      created_at: values[8] as string,
    };
    const existing = this.taskFileLinks.find((link) => link.id === row.id);

    if (existing) {
      Object.assign(existing, row);
      return;
    }

    this.taskFileLinks.push(row);
  }

  private upsertTaskAttempt(values: readonly unknown[]): void {
    const row: TaskAttemptMemoryRow = {
      task_id: values[0] as string,
      attempt_no: values[1] as number,
      status: values[2] as ExecutionStatus,
      current_step: values[3] as ExecutionStepType | null,
      progress: values[4] as number,
      error_code: values[5] as string | null,
      error_message: values[6] as string | null,
      started_at: values[7] as string,
      completed_at: values[8] as string | null,
    };
    const existing = this.attempts.find((item) =>
      item.task_id === row.task_id && item.attempt_no === row.attempt_no);

    if (existing) {
      Object.assign(existing, row);
      return;
    }

    this.attempts.push(row);
  }

  private upsertProviderLease(values: readonly unknown[]): ProviderLeaseMemoryRow {
    const now = new Date().toISOString();
    const existing = this.providerLeases.find((lease) => lease.task_id === values[1]);
    const row: ProviderLeaseMemoryRow = {
      id: existing?.id ?? `provider-lease-${this.providerLeases.length + 1}`,
      provider_key: values[0] as string,
      task_id: values[1] as string,
      worker_id: values[2] as string,
      lease_until: values[3] as string,
      acquired_at: existing?.acquired_at ?? now,
      heartbeat_at: now,
      metadata: parseJsonRecord(values[4]) ?? {},
    };

    if (existing) {
      Object.assign(existing, row);
      return existing;
    }

    this.providerLeases.push(row);
    return row;
  }

  private queryExecutionRuns<T extends QueryResultRow>(
    normalized: string,
    values: readonly unknown[],
  ): QueryResult<T> {
    if (normalized.includes("where id = $1")) {
      return createResult(asRows<T>(
        this.runs.filter((run) => run.id === values[0]),
      ));
    }

    if (normalized.includes("where workflow_id = $1")) {
      const rows = this.runs
        .filter((run) =>
          run.workflow_id === values[0]
          && run.node_id === values[1]
          && run.status === "completed")
        .sort((left, right) => {
          const leftTime = left.completed_at ?? left.created_at;
          const rightTime = right.completed_at ?? right.created_at;
          return rightTime.localeCompare(leftTime);
        });

      return createResult(asRows<T>(rows.slice(0, 1)));
    }

    return createResult([] as T[]);
  }

  private queryExecutionTasks<T extends QueryResultRow>(
    normalized: string,
    values: readonly unknown[],
  ): QueryResult<T> {
    if (normalized.includes("group by provider_key")) {
      const counts = new Map<string, number>();
      for (const task of this.tasks.filter((item) =>
        item.status === "queued"
        || (
          item.status === "processing"
          && item.lease_until !== null
          && Date.parse(item.lease_until) < Date.now()
        ))) {
        const providerKey = task.provider?.trim() || task.task_type || "default";
        counts.set(providerKey, (counts.get(providerKey) ?? 0) + 1);
      }

      return createResult(asRows<T>(Array.from(counts, ([provider_key, total]) => ({
        provider_key,
        total,
      } satisfies ProviderCountRow))));
    }

    if (
      normalized.includes("where id = $1")
      && normalized.includes("status = 'queued'")
      && normalized.includes("for update skip locked")
    ) {
      return createResult(asRows<T>(
        this.tasks.filter((task) =>
          task.id === values[0]
          && (
            task.status === "queued"
            || (
              task.status === "processing"
              && task.lease_until !== null
              && Date.parse(task.lease_until) < Date.now()
            )
          )),
      ));
    }

    if (normalized.includes("where id = $1")) {
      return createResult(asRows<T>(
        this.tasks.filter((task) => task.id === values[0]),
      ));
    }

    if (normalized.includes("where run_id = $1") && !normalized.includes("status = $")) {
      const rows = this.tasks
        .filter((task) => task.run_id === values[0])
        .sort(compareTaskOrder);
      return createResult(asRows<T>(rows));
    }

    if (normalized.includes("where status = 'processing'") && normalized.includes("lease_until < now()")) {
      const limit = Number(values[0] ?? this.tasks.length);
      const rows = this.tasks
        .filter((task) =>
          task.status === "processing"
          && task.lease_until !== null
          && Date.parse(task.lease_until) < Date.now())
        .sort((left, right) => String(left.lease_until).localeCompare(String(right.lease_until)))
        .slice(0, limit);
      return createResult(asRows<T>(rows));
    }

    if (normalized.includes("where status = 'queued'")) {
      const limit = Number(values[0] ?? this.tasks.length);
      const rows = this.tasks
        .filter((task) =>
          task.status === "queued"
          || (
            normalized.includes("lease_until < now()")
            && task.status === "processing"
            && task.lease_until !== null
            && Date.parse(task.lease_until) < Date.now()
          ))
        .sort(compareTaskOrder)
        .slice(0, limit);
      return createResult(asRows<T>(rows));
    }

    const rows = this.filterTasksFromSql(normalized, values, 0)
      .sort((left, right) => compareTaskOrder(right, left));
    const limit = Number(values.at(-2) ?? rows.length);
    const offset = Number(values.at(-1) ?? 0);
    return createResult(asRows<T>(rows.slice(offset, offset + limit)));
  }

  private filterTasksFromSql(
    normalized: string,
    values: readonly unknown[],
    startIndex: number,
  ): ExecutionTaskMemoryRow[] {
    let valueIndex = startIndex;
    let rows = [...this.tasks];

    if (normalized.includes("run_id = $")) {
      rows = rows.filter((task) => task.run_id === values[valueIndex]);
      valueIndex += 1;
    }

    if (normalized.includes("user_id = $")) {
      rows = rows.filter((task) => task.user_id === values[valueIndex]);
      valueIndex += 1;
    }

    if (normalized.includes("status = $")) {
      rows = rows.filter((task) => task.status === values[valueIndex]);
      valueIndex += 1;
    }

    if (normalized.includes("node_id = $")) {
      rows = rows.filter((task) => task.node_id === values[valueIndex]);
      valueIndex += 1;
    }

    if (normalized.includes("node_type = $")) {
      rows = rows.filter((task) => task.node_type === values[valueIndex]);
      valueIndex += 1;
    }

    if (normalized.includes("task_type = $")) {
      rows = rows.filter((task) => task.task_type === values[valueIndex]);
    }

    return rows;
  }

  private queryTaskEvents<T extends QueryResultRow>(
    normalized: string,
    values: readonly unknown[],
  ): QueryResult<T> {
    if (normalized.startsWith("select count(*) as total")) {
      return createResult(asRows<T>([{
        total: this.events.filter((event) =>
          event.workflow_id === values[0] && event.task_id === values[1]).length,
      } satisfies CountRow]));
    }

    const sortDesc = normalized.includes("order by created_at desc");
    const rows = this.events
      .filter((event) => {
        if (normalized.includes("where workflow_id = $1")) {
          return event.workflow_id === values[0] && event.task_id === values[1];
        }

        return event.task_id === values[0];
      })
      .sort((left, right) =>
        sortDesc ? compareTaskEvents(right, left) : compareTaskEvents(left, right));
    const limit = normalized.includes("limit $3") ? Number(values[2]) : rows.length;
    const offset = normalized.includes("offset $4") ? Number(values[3]) : 0;

    return createResult(asRows<T>(rows.slice(offset, offset + limit)));
  }

  private queryTaskFileLinks<T extends QueryResultRow>(
    values: readonly unknown[],
  ): QueryResult<T> {
    const rows = this.taskFileLinks
      .filter((link) => link.task_id === values[0])
      .sort((left, right) => {
        if (left.created_at !== right.created_at) {
          return left.created_at.localeCompare(right.created_at);
        }

        return (left.order_index ?? Number.MAX_SAFE_INTEGER)
          - (right.order_index ?? Number.MAX_SAFE_INTEGER);
      });

    return createResult(asRows<T>(rows));
  }

  private queryWorkflowHistory<T extends QueryResultRow>(
    normalized: string,
    values: readonly unknown[],
  ): QueryResult<T> {
    const workflowId = values[0] as string;
    let rows = this.buildWorkflowHistoryRows(workflowId);

    if (normalized.includes("where task_id = $2")) {
      return createResult(asRows<T>(
        rows.filter((row) => row.task_id === values[1]).slice(0, 1),
      ));
    }

    rows = this.filterHistoryRowsFromSql(normalized, rows, values);

    if (normalized.includes("select count(*) as total")) {
      return createResult(asRows<T>([{ total: rows.length } satisfies CountRow]));
    }

    rows = this.sortHistoryRows(normalized, rows);
    const limit = Number(values.at(-2) ?? rows.length);
    const offset = Number(values.at(-1) ?? 0);
    return createResult(asRows<T>(rows.slice(offset, offset + limit)));
  }

  private buildWorkflowHistoryRows(workflowId: string): QueryResultRow[] {
    return this.tasks
      .filter((task) => task.workflow_id === workflowId)
      .sort((left, right) => {
        if (left.created_at !== right.created_at) {
          return left.created_at.localeCompare(right.created_at);
        }

        return left.task_no.localeCompare(right.task_no) || left.id.localeCompare(right.id);
      })
      .map((task, index) => {
        const run = this.runs.find((item) => item.id === task.run_id);
        return {
          sequence: index + 1,
          task_id: task.id,
          task_no: task.task_no,
          run_id: task.run_id,
          run_no: run?.run_no ?? null,
          user_id: task.user_id,
          workflow_id: task.workflow_id,
          project_id: task.project_id,
          node_type: task.node_type,
          node_id: task.node_id,
          node_title: task.node_title,
          task_type: task.task_type,
          group_id: task.group_id,
          group_order: task.group_order,
          provider: task.provider,
          model: task.model,
          input: task.input,
          status: task.status,
          current_step: task.current_step,
          current_attempt_no: task.current_attempt_no,
          retry_count: task.retry_count,
          max_retries: task.max_retries,
          last_error_code: task.last_error_code,
          last_error_message: task.last_error_message,
          result_file_id: task.result_file_id,
          created_at: task.created_at,
          started_at: task.started_at,
          completed_at: task.completed_at,
        };
      });
  }

  private filterHistoryRowsFromSql(
    normalized: string,
    inputRows: QueryResultRow[],
    values: readonly unknown[],
  ): QueryResultRow[] {
    let valueIndex = 1;
    let rows = [...inputRows];

    if (normalized.includes("run_id = $")) {
      rows = rows.filter((row) => row.run_id === values[valueIndex]);
      valueIndex += 1;
    }

    if (normalized.includes("status = $")) {
      rows = rows.filter((row) => row.status === values[valueIndex]);
      valueIndex += 1;
    }

    if (normalized.includes("node_id = $")) {
      rows = rows.filter((row) => row.node_id === values[valueIndex]);
      valueIndex += 1;
    }

    if (normalized.includes("node_type = $")) {
      rows = rows.filter((row) => row.node_type === values[valueIndex]);
      valueIndex += 1;
    }

    if (normalized.includes("task_type = $")) {
      rows = rows.filter((row) => row.task_type === values[valueIndex]);
    }

    return rows;
  }

  private sortHistoryRows(normalized: string, rows: QueryResultRow[]): QueryResultRow[] {
    const sortedRows = [...rows];
    const direction = normalized.includes(" desc") ? -1 : 1;
    const compareNullableString = (left: unknown, right: unknown): number => {
      if (left === right) {
        return 0;
      }

      if (left === null || left === undefined) {
        return 1;
      }

      if (right === null || right === undefined) {
        return -1;
      }

      return String(left).localeCompare(String(right));
    };

    if (normalized.includes("order by created_at")) {
      return sortedRows.sort((left, right) =>
        direction * compareNullableString(left.created_at, right.created_at));
    }

    if (normalized.includes("order by started_at")) {
      return sortedRows.sort((left, right) =>
        direction * compareNullableString(left.started_at, right.started_at));
    }

    if (normalized.includes("order by completed_at")) {
      return sortedRows.sort((left, right) =>
        direction * compareNullableString(left.completed_at, right.completed_at));
    }

    return sortedRows.sort((left, right) =>
      direction * (Number(left.sequence) - Number(right.sequence)));
  }
}
