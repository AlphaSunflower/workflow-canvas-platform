import { randomUUID } from "node:crypto";

import {
  EXECUTION_PHASES,
  RETRY_LIMITS,
  TASK_EVENT_TYPES,
  type DatabaseConfig,
  type DatabasePool,
  type TaskFileRole,
  type TransactionClient,
  queryPostgres,
  withTransaction,
} from "@newworkflow/backend-shared";
import type {
  CreateExecutionRequest,
  CreateExecutionResponseData,
  CreateExecutionTaskResponse,
} from "@newworkflow/backend-shared/api";
import type {
  ExecutionPhase,
  ExecutionStatus,
  ExecutionStepType,
  TaskEventType,
} from "@newworkflow/backend-shared/execution";
import type {
  ExecutionRunRecord,
  ExecutionTaskEventRecord,
  ExecutionTaskRecord,
} from "./execution-records.types.ts";
import {
  buildTaskInputFileLinks,
  buildTaskPayload,
  compareTaskOrder,
  deterministicUuid,
  formatSequence,
  normalizeOptionalString,
} from "./executions.repository.helpers.ts";
import type {
  AppendTaskEventInput,
  CreateExecutionStoreInput,
  ExecutionTaskFileLinkRecord,
  ExecutionsRepository,
  LinkTaskFileInput,
  QueueClaimResult,
  QueuedTaskStats,
  RequeueTaskInput,
} from "./executions.repository.types.ts";

type QueryExecutor = Pick<TransactionClient, "query">;
type DbQueryRow = Record<string, unknown>;

interface ExecutionRunDbRow extends DbQueryRow {
  id: string;
  run_no: string;
  user_id: string | null;
  workflow_id: string | null;
  project_id: string | null;
  node_type: string;
  task_type: string;
  execution_mode: string;
  node_id: string | null;
  node_title: string | null;
  provider: string | null;
  status: ExecutionStatus;
  total_task_count: number;
  completed_task_count: number;
  failed_task_count: number;
  request_payload: unknown;
  result_summary: unknown;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface ExecutionTaskDbRow extends DbQueryRow {
  id: string;
  task_no: string;
  run_id: string;
  user_id: string | null;
  workflow_id: string | null;
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
  claimed_by: string | null;
  claimed_at: Date | string | null;
  lease_until: Date | string | null;
  heartbeat_at: Date | string | null;
  attempt_started_at: Date | string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface TaskEventDbRow extends DbQueryRow {
  id: string;
  run_id: string;
  task_id: string;
  attempt_no: number | null;
  event_type: TaskEventType;
  status: ExecutionStatus;
  phase: ExecutionPhase;
  step_type: ExecutionStepType | null;
  progress: number;
  message: string | null;
  payload: unknown;
  created_at: Date | string;
}

interface TaskFileLinkDbRow extends DbQueryRow {
  id: string;
  task_id: string;
  file_id: string;
  workflow_id: string | null;
  role: TaskFileRole;
  order_index: number | null;
  source_handle: string | null;
  group_id: string | null;
  created_at: Date | string;
}

interface LatestTaskEventCreatedAtRow extends DbQueryRow {
  created_at: Date | string;
}

export interface DbExecutionsRepositoryOptions {
  pool?: DatabasePool;
}

const TASK_CREATED_MESSAGE = "浠诲姟宸插垱寤猴紝绛夊緟璋冨害銆?";
const TASK_STARTED_MESSAGE = "浠诲姟宸茶 Worker 鎷夎捣鎵ц銆?";
const TASK_COMPLETED_MESSAGE = "浠诲姟鎵ц瀹屾垚銆?";
const TASK_FILE_LINK_ROLES = new Set<TaskFileRole>([
  "input",
  "reference",
  "intermediate",
  "output",
]);
const DEFAULT_TASK_LEASE_MS = 120_000;

const RUN_SELECT_COLUMNS = `
  id::text,
  run_no,
  user_id,
  workflow_id,
  project_id,
  node_type,
  task_type,
  execution_mode,
  node_id,
  node_title,
  provider,
  status,
  total_task_count,
  completed_task_count,
  failed_task_count,
  request_payload,
  result_summary,
  created_at,
  started_at,
  completed_at
`;

const TASK_SELECT_COLUMNS = `
  id::text,
  task_no,
  run_id::text,
  user_id,
  workflow_id,
  project_id,
  node_type,
  node_id,
  node_title,
  task_type,
  group_id,
  group_order,
  provider,
  model,
  input,
  status,
  current_step,
  current_attempt_no,
  retry_count,
  max_retries,
  last_error_code,
  last_error_message,
  result_file_id::text,
  claimed_by,
  claimed_at,
  lease_until,
  heartbeat_at,
  attempt_started_at,
  created_at,
  started_at,
  completed_at
`;

const EVENT_SELECT_COLUMNS = `
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
`;

const TASK_FILE_LINK_SELECT_COLUMNS = `
  id::text,
  task_id::text,
  file_id::text,
  workflow_id,
  role,
  order_index,
  source_handle,
  group_id,
  created_at
`;

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toRunRecord(row: ExecutionRunDbRow): ExecutionRunRecord {
  return {
    id: row.id,
    runNo: row.run_no,
    userId: row.user_id,
    workflowId: row.workflow_id,
    projectId: row.project_id,
    nodeType: row.node_type,
    taskType: row.task_type as ExecutionRunRecord["taskType"],
    executionMode: row.execution_mode,
    nodeId: row.node_id,
    nodeTitle: row.node_title,
    provider: row.provider,
    status: row.status,
    totalTaskCount: Number(row.total_task_count),
    completedTaskCount: Number(row.completed_task_count),
    failedTaskCount: Number(row.failed_task_count),
    requestPayload: (toJsonRecord(row.request_payload) ?? {}) as unknown as CreateExecutionRequest,
    resultSummary: null,
    createdAt: toIsoString(row.created_at)!,
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
  };
}

function toTaskRecord(row: ExecutionTaskDbRow): ExecutionTaskRecord {
  const input = toJsonRecord(row.input);

  return {
    id: row.id,
    taskNo: row.task_no,
    runId: row.run_id,
    userId: row.user_id,
    workflowId: row.workflow_id,
    projectId: row.project_id,
    nodeType: row.node_type,
    nodeId: row.node_id,
    nodeTitle: row.node_title,
    taskType: row.task_type as ExecutionTaskRecord["taskType"],
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
    claimedBy: row.claimed_by,
    claimedAt: toIsoString(row.claimed_at),
    leaseUntil: toIsoString(row.lease_until),
    heartbeatAt: toIsoString(row.heartbeat_at),
    attemptStartedAt: toIsoString(row.attempt_started_at),
    createdAt: toIsoString(row.created_at)!,
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
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

function toTaskFileLinkRecord(row: TaskFileLinkDbRow): ExecutionTaskFileLinkRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    fileId: row.file_id,
    workflowId: row.workflow_id,
    role: row.role,
    orderIndex: row.order_index,
    sourceHandle: row.source_handle,
    groupId: row.group_id,
    createdAt: toIsoString(row.created_at)!,
  };
}

function createTaskEvent(
  task: ExecutionTaskRecord,
  input: {
    eventType: TaskEventType;
    status: ExecutionStatus;
    phase: ExecutionPhase;
    stepType: ExecutionStepType | null;
    progress: number;
    message: string | null;
    payload: Record<string, unknown> | null;
    createdAt: string;
    attemptNo?: number | null;
  },
): ExecutionTaskEventRecord {
  return {
    id: randomUUID(),
    runId: task.runId,
    taskId: task.id,
    attemptNo: input.attemptNo ?? task.currentAttemptNo,
    eventType: input.eventType,
    status: input.status,
    phase: input.phase,
    stepType: input.stepType,
    progress: input.progress,
    message: input.message,
    payload: input.payload,
    createdAt: input.createdAt,
  };
}

function applyQueuedTaskClaim(task: ExecutionTaskRecord, claimedAt: string): {
  task: ExecutionTaskRecord;
  event: ExecutionTaskEventRecord;
} {
  const claimedTask: ExecutionTaskRecord = {
    ...task,
    status: "processing",
    currentStep: null,
    currentAttemptNo: 1,
    startedAt: claimedAt,
  };
  const event = createTaskEvent(claimedTask, {
    eventType: "task_started",
    status: "processing",
    phase: "processing",
    stepType: null,
    progress: 0,
    message: TASK_STARTED_MESSAGE,
    payload: buildTaskPayload(claimedTask),
    createdAt: claimedAt,
  });

  return {
    task: claimedTask,
    event,
  };
}

function calculateLeaseUntil(claimedAt: string, leaseMs: number): string {
  return new Date(Date.parse(claimedAt) + leaseMs).toISOString();
}

function normalizeLeaseMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1_000) {
    return DEFAULT_TASK_LEASE_MS;
  }

  return Math.trunc(value);
}

function normalizeWorkerId(value: string | undefined): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return `worker-${process.pid}`;
}

export class DbExecutionsRepository implements ExecutionsRepository {
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;

  constructor(databaseConfig: DatabaseConfig, options: DbExecutionsRepositoryOptions = {}) {
    this.databaseConfig = databaseConfig;
    this.pool = options.pool ?? null;
  }

  async ensureInitialized(): Promise<void> {
    await this.query("select 1 as ok");
  }

  async createExecution(
    input: CreateExecutionStoreInput,
  ): Promise<CreateExecutionResponseData> {
    return this.withTransaction(async (client) => {
      const runSequence = await this.nextSequenceValue(client, "execution_run_no_seq");
      const taskSequences = await this.nextSequenceValues(
        client,
        "execution_task_no_seq",
        input.tasks.length,
      );
      const runId = randomUUID();
      const createdAt = new Date().toISOString();
      const runNo = formatSequence("RUN", runSequence);
      const taskResponses: CreateExecutionTaskResponse[] = [];
      const taskRecords: ExecutionTaskRecord[] = input.tasks.map((taskInput, index) => {
        const taskId = randomUUID();
        const taskNo = formatSequence("TASK", taskSequences[index] ?? index + 1);

        taskResponses.push({
          taskId,
          taskNo,
          groupId: taskInput.groupId,
          groupOrder: taskInput.groupOrder,
          status: "queued",
        });

        return {
          id: taskId,
          taskNo,
          runId,
          userId: input.run.userId,
          workflowId: taskInput.workflowId,
          projectId: taskInput.projectId,
          nodeType: taskInput.nodeType,
          nodeId: taskInput.nodeId,
          nodeTitle: taskInput.nodeTitle,
          taskType: taskInput.taskType,
          groupId: taskInput.groupId,
          groupOrder: taskInput.groupOrder,
          provider: taskInput.provider,
          model: taskInput.model,
          input: taskInput.input,
          status: "queued",
          currentStep: null,
          currentAttemptNo: 0,
          retryCount: 0,
          maxRetries: RETRY_LIMITS.maxRetries,
          lastErrorCode: null,
          lastErrorMessage: null,
          resultFileId: null,
          claimedBy: null,
          claimedAt: null,
          leaseUntil: null,
          heartbeatAt: null,
          attemptStartedAt: null,
          createdAt,
          startedAt: null,
          completedAt: null,
          whiteModelFileId: taskInput.whiteModelFileId ?? null,
          styleReferenceFileId: taskInput.styleReferenceFileId ?? null,
        };
      });
      const eventRecords = taskRecords.map((task) =>
        createTaskEvent(task, {
          eventType: TASK_EVENT_TYPES[0],
          status: "queued",
          phase: EXECUTION_PHASES[0],
          stepType: null,
          progress: 0,
          message: TASK_CREATED_MESSAGE,
          payload: buildTaskPayload(task),
          createdAt,
          attemptNo: null,
        })
      );
      const runRecord: ExecutionRunRecord = {
        id: runId,
        runNo,
        userId: input.run.userId,
        workflowId: input.run.workflowId,
        projectId: input.run.projectId,
        nodeType: input.run.nodeType,
        taskType: input.run.taskType,
        executionMode: input.run.executionMode,
        nodeId: input.run.nodeId,
        nodeTitle: input.run.nodeTitle,
        provider: input.run.provider,
        status: "queued",
        totalTaskCount: taskRecords.length,
        completedTaskCount: 0,
        failedTaskCount: 0,
        requestPayload: input.run.requestPayload,
        resultSummary: null,
        createdAt,
        startedAt: null,
        completedAt: null,
      };
      const inputFileLinks = taskRecords.flatMap((task) =>
        buildTaskInputFileLinks(task, createdAt)
      );

      await this.upsertRunRecord(client, runRecord);
      for (const task of taskRecords) {
        await this.upsertTaskRecord(client, task);
      }
      for (const event of eventRecords) {
        const task = taskRecords.find((item) => item.id === event.taskId);
        await this.insertTaskEventRecord(client, event, task?.workflowId ?? null);
      }
      for (const link of inputFileLinks) {
        await this.insertTaskFileLinkRecord(client, link);
      }

      return {
        runId,
        runNo,
        nodeType: input.run.nodeType,
        taskType: input.run.taskType,
        executionMode: input.run.executionMode,
        status: "queued",
        tasks: taskResponses,
      };
    });
  }

  async getExecutionRun(runId: string): Promise<ExecutionRunRecord | null> {
    const result = await this.query<ExecutionRunDbRow>(
      `
        select ${RUN_SELECT_COLUMNS}
        from execution_runs
        where id = $1
        limit 1
      `,
      [runId],
    );

    return result.rows[0] ? toRunRecord(result.rows[0]) : null;
  }

  async getExecutionRunById(runId: string): Promise<ExecutionRunRecord | null> {
    return this.getExecutionRun(runId);
  }

  async getTasksByRunId(runId: string): Promise<ExecutionTaskRecord[]> {
    const result = await this.query<ExecutionTaskDbRow>(
      `
        select ${TASK_SELECT_COLUMNS}
        from execution_tasks
        where run_id = $1
        order by created_at asc, group_order asc nulls last
      `,
      [runId],
    );

    return result.rows.map(toTaskRecord).sort(compareTaskOrder);
  }

  async findLatestCompletedRunForWorkflowNode(
    workflowId: string,
    nodeId: string,
  ): Promise<ExecutionRunRecord | null> {
    const result = await this.query<ExecutionRunDbRow>(
      `
        select ${RUN_SELECT_COLUMNS}
        from execution_runs
        where workflow_id = $1
          and node_id = $2
          and status = 'completed'
        order by completed_at desc nulls last, created_at desc
        limit 1
      `,
      [workflowId, nodeId],
    );

    return result.rows[0] ? toRunRecord(result.rows[0]) : null;
  }

  async getTaskById(taskId: string): Promise<ExecutionTaskRecord | null> {
    const result = await this.query<ExecutionTaskDbRow>(
      `
        select ${TASK_SELECT_COLUMNS}
        from execution_tasks
        where id = $1
        limit 1
      `,
      [taskId],
    );

    return result.rows[0] ? toTaskRecord(result.rows[0]) : null;
  }

  async listTasks(filters: {
    runId?: string;
    userId?: string;
    status?: ExecutionStatus;
    page: number;
    pageSize: number;
  }): Promise<{
    items: ExecutionTaskRecord[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const addFilter = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (filters.runId) {
      addFilter("run_id = ?", filters.runId);
    }
    if (filters.userId) {
      addFilter("user_id = ?", filters.userId);
    }
    if (filters.status) {
      addFilter("status = ?", filters.status);
    }

    const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const countResult = await this.query<{ total: string | number }>(
      `
        select count(*) as total
        from execution_tasks
        ${whereClause}
      `,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    const offset = (filters.page - 1) * filters.pageSize;
    const result = await this.query<ExecutionTaskDbRow>(
      `
        select ${TASK_SELECT_COLUMNS}
        from execution_tasks
        ${whereClause}
        order by created_at desc, group_order desc nulls last
        limit $${values.length + 1}
        offset $${values.length + 2}
      `,
      [...values, filters.pageSize, offset],
    );

    return {
      items: result.rows.map(toTaskRecord),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  async getTaskEvents(taskId: string): Promise<ExecutionTaskEventRecord[]> {
    const result = await this.query<TaskEventDbRow>(
      `
        select ${EVENT_SELECT_COLUMNS}
        from task_events
        where task_id = $1
        order by created_at asc, id asc
      `,
      [taskId],
    );

    return result.rows.map(toTaskEventRecord);
  }

  async listQueuedTasks(limit: number): Promise<ExecutionTaskRecord[]> {
    const result = await this.query<ExecutionTaskDbRow>(
      `
        select ${TASK_SELECT_COLUMNS}
        from execution_tasks
        where status = 'queued'
          or (
            status = 'processing'
            and lease_until is not null
            and lease_until < now()
          )
        order by created_at asc, group_order asc nulls last
        limit $1
      `,
      [limit],
    );

    return result.rows.map(toTaskRecord);
  }

  async getQueuedTaskStats(): Promise<QueuedTaskStats> {
    const result = await this.query<{ provider_key: string | null; total: string | number }>(
      `
        select coalesce(nullif(provider, ''), task_type, 'default') as provider_key,
          count(*) as total
        from execution_tasks
        where status = 'queued'
          or (
            status = 'processing'
            and lease_until is not null
            and lease_until < now()
          )
        group by provider_key
      `,
    );
    const byProvider: Record<string, number> = {};
    let total = 0;

    for (const row of result.rows) {
      const count = Number(row.total);
      total += count;
      byProvider[row.provider_key ?? "default"] = count;
    }

    return {
      total,
      byProvider,
    };
  }

  async claimQueuedTasks(
    limit: number,
    options: { workerId?: string; leaseMs?: number } = {},
  ): Promise<QueueClaimResult[]> {
    const queuedTasks = await this.listQueuedTasks(limit);
    const claimed: QueueClaimResult[] = [];

    for (const task of queuedTasks) {
      const result = await this.claimQueuedTaskById(task.id, options);
      if (result) {
        claimed.push(result);
      }
    }

    return claimed;
  }

  async claimQueuedTaskById(
    taskId: string,
    options: { workerId?: string; leaseMs?: number } = {},
  ): Promise<QueueClaimResult | null> {
    return this.withTransaction(async (client) => {
      const selected = await client.query<ExecutionTaskDbRow>(
        `
          select ${TASK_SELECT_COLUMNS}
          from execution_tasks
          where id = $1
            and (
              status = 'queued'
              or (
                status = 'processing'
                and lease_until is not null
                and lease_until < now()
              )
            )
          for update skip locked
          limit 1
        `,
        [taskId],
      );
      const task = selected.rows[0] ? toTaskRecord(selected.rows[0]) : null;

      if (!task) {
        return null;
      }

      const claimedAt = new Date().toISOString();
      const leaseMs = normalizeLeaseMs(options.leaseMs);
      const workerId = normalizeWorkerId(options.workerId);
      const nextAttemptNo = Math.max(task.currentAttemptNo + 1, 1);
      const baseClaimed = applyQueuedTaskClaim(task, claimedAt);
      const claimed = {
        ...baseClaimed,
        task: {
          ...baseClaimed.task,
          currentAttemptNo: nextAttemptNo,
          claimedBy: workerId,
          claimedAt,
          leaseUntil: calculateLeaseUntil(claimedAt, leaseMs),
          heartbeatAt: claimedAt,
          attemptStartedAt: claimedAt,
          startedAt: task.startedAt ?? claimedAt,
        },
      };
      claimed.event.attemptNo = nextAttemptNo;
      claimed.event.payload = {
        ...(claimed.event.payload ?? {}),
        workerId,
        leaseUntil: claimed.task.leaseUntil,
      };
      await this.upsertTaskRecord(client, claimed.task);
      await this.upsertTaskAttemptRecord(client, {
        task: claimed.task,
        attemptNo: nextAttemptNo,
        status: "processing",
        currentStep: null,
        progress: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: claimedAt,
        completedAt: null,
      });
      await this.insertTaskEventRecord(client, claimed.event, claimed.task.workflowId);
      const run = await this.getExecutionRunWithExecutor(client, claimed.task.runId);

      if (run && run.status === "queued") {
        await this.upsertRunRecord(client, {
          ...run,
          status: "processing",
          startedAt: claimedAt,
        });
      }

      return {
        runId: task.runId,
        task: claimed.task,
      };
    });
  }

  async markTaskCompleted(taskId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      const task = await this.getTaskByIdWithExecutor(client, taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      const completedAt = new Date().toISOString();
      const updatedTask: ExecutionTaskRecord = {
        ...task,
        status: "completed",
        currentStep: "final",
        claimedBy: null,
        claimedAt: null,
        leaseUntil: null,
        heartbeatAt: null,
        completedAt,
      };
      const event = createTaskEvent(updatedTask, {
        eventType: "task_completed",
        status: "completed",
        phase: "completed",
        stepType: "final",
        progress: 100,
        message: TASK_COMPLETED_MESSAGE,
        payload: buildTaskPayload(updatedTask),
        createdAt: completedAt,
      });

      await this.upsertTaskRecord(client, updatedTask);
      await this.upsertTaskAttemptRecord(client, {
        task: updatedTask,
        attemptNo: updatedTask.currentAttemptNo,
        status: "completed",
        currentStep: "final",
        progress: 100,
        errorCode: null,
        errorMessage: null,
        startedAt: updatedTask.attemptStartedAt ?? updatedTask.startedAt ?? completedAt,
        completedAt,
      });
      await this.insertTaskEventRecord(client, event, updatedTask.workflowId);
      await this.recomputeRunStatus(client, updatedTask.runId, completedAt);
    });
  }

  async updateTaskAttempt(input: {
    taskId: string;
    attemptNo: number;
    retryCount: number;
    currentStep: ExecutionStepType | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
  }): Promise<void> {
    const task = await this.getTaskById(input.taskId);

    if (!task) {
      throw new Error("TASK_NOT_FOUND");
    }

    await this.withTransaction(async (client) => {
      const updatedTask = {
        ...task,
        currentAttemptNo: input.attemptNo,
        retryCount: input.retryCount,
        currentStep: input.currentStep,
        lastErrorCode: input.lastErrorCode,
        lastErrorMessage: input.lastErrorMessage,
      };

      await this.upsertTaskRecord(client, updatedTask);
      await this.upsertTaskAttemptRecord(client, {
        task: updatedTask,
        attemptNo: input.attemptNo,
        status: "processing",
        currentStep: input.currentStep,
        progress: 0,
        errorCode: input.lastErrorCode,
        errorMessage: input.lastErrorMessage,
        startedAt: updatedTask.attemptStartedAt ?? new Date().toISOString(),
        completedAt: null,
      });
    });
  }

  async updateTaskResultFile(
    taskId: string,
    resultFileId: string,
    options?: {
      role?: TaskFileRole;
      sourceHandle?: string | null;
      orderIndex?: number | null;
    },
  ): Promise<void> {
    const task = await this.getTaskById(taskId);

    if (!task) {
      throw new Error("TASK_NOT_FOUND");
    }

    const updatedTask = {
      ...task,
      resultFileId,
      currentStep: "final" as const,
    };
    const link = this.createTaskFileLink(updatedTask, {
      taskId,
      fileId: resultFileId,
      role: options?.role ?? "output",
      sourceHandle: options?.sourceHandle ?? "resultFileId",
      orderIndex: options?.orderIndex ?? null,
    });

    await this.withTransaction(async (client) => {
      await this.upsertTaskRecord(client, updatedTask);
      await this.insertTaskFileLinkRecord(client, link);
    });
  }

  async linkTaskFile(input: LinkTaskFileInput): Promise<ExecutionTaskFileLinkRecord> {
    const task = await this.getTaskById(input.taskId);

    if (!task) {
      throw new Error("TASK_NOT_FOUND");
    }

    const link = this.createTaskFileLink(task, input);
    await this.insertTaskFileLinkRecord(this, link);
    return link;
  }

  async getTaskFileLinks(taskId: string): Promise<ExecutionTaskFileLinkRecord[]> {
    const result = await this.query<TaskFileLinkDbRow>(
      `
        select ${TASK_FILE_LINK_SELECT_COLUMNS}
        from task_file_links
        where task_id = $1
        order by created_at asc, order_index asc nulls last
      `,
      [taskId],
    );

    return result.rows.map(toTaskFileLinkRecord);
  }

  async appendTaskEvent(input: AppendTaskEventInput): Promise<void> {
    const task = await this.getTaskById(input.taskId);

    if (!task) {
      throw new Error("TASK_NOT_FOUND");
    }

    const updatedTask = {
      ...task,
      currentStep: input.stepType,
    };
    const event = createTaskEvent(updatedTask, {
      eventType: input.eventType,
      status: input.status,
      phase: input.phase,
      stepType: input.stepType,
      progress: input.progress,
      message: input.message,
      payload: input.payload ?? null,
      createdAt: new Date().toISOString(),
      attemptNo: input.attemptNo ?? task.currentAttemptNo,
    });

    await this.withTransaction(async (client) => {
      await this.upsertTaskRecord(client, updatedTask);
      await this.insertTaskEventRecord(client, event, updatedTask.workflowId);
    });
  }

  async markTaskFailed(
    taskId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      const task = await this.getTaskByIdWithExecutor(client, taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      const failedAt = new Date().toISOString();
      const updatedTask = {
        ...task,
        status: "failed" as const,
        claimedBy: null,
        claimedAt: null,
        leaseUntil: null,
        heartbeatAt: null,
        completedAt: failedAt,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
      };
      const payload = buildTaskPayload(updatedTask) ?? {};
      payload.errorCode = errorCode;
      const event = createTaskEvent(updatedTask, {
        eventType: "task_failed",
        status: "failed",
        phase: "failed",
        stepType: updatedTask.currentStep,
        progress: 100,
        message: errorMessage,
        payload,
        createdAt: failedAt,
      });

      await this.upsertTaskRecord(client, updatedTask);
      await this.upsertTaskAttemptRecord(client, {
        task: updatedTask,
        attemptNo: updatedTask.currentAttemptNo,
        status: "failed",
        currentStep: updatedTask.currentStep,
        progress: 100,
        errorCode,
        errorMessage,
        startedAt: updatedTask.attemptStartedAt ?? updatedTask.startedAt ?? failedAt,
        completedAt: failedAt,
      });
      await this.insertTaskEventRecord(client, event, updatedTask.workflowId);
      await this.recomputeRunStatus(client, updatedTask.runId, failedAt);
    });
  }

  async requeueTask(input: RequeueTaskInput): Promise<void> {
    await this.withTransaction(async (client) => {
      const task = await this.getTaskByIdWithExecutor(client, input.taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      await this.upsertTaskRecord(client, {
        ...task,
        status: "queued",
        currentStep: null,
        claimedBy: null,
        claimedAt: null,
        leaseUntil: null,
        heartbeatAt: null,
        attemptStartedAt: null,
        startedAt: null,
        completedAt: null,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage,
      });
      await this.recomputeRunStatus(client, task.runId, null);
    });
  }

  async heartbeatTaskLease(input: {
    taskId: string;
    workerId: string;
    leaseMs: number;
  }): Promise<boolean> {
    const now = new Date().toISOString();
    const leaseUntil = calculateLeaseUntil(now, normalizeLeaseMs(input.leaseMs));
    const result = await this.query(
      `
        update execution_tasks
        set
          heartbeat_at = $3,
          lease_until = $4
        where id = $1
          and status = 'processing'
          and claimed_by = $2
        returning id
      `,
      [input.taskId, normalizeWorkerId(input.workerId), now, leaseUntil],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async recoverExpiredProcessingTasks(input: {
    workerId: string;
    limit: number;
  }): Promise<number> {
    return this.withTransaction(async (client) => {
      const result = await client.query<ExecutionTaskDbRow>(
        `
          select ${TASK_SELECT_COLUMNS}
          from execution_tasks
          where status = 'processing'
            and lease_until is not null
            and lease_until < now()
          order by lease_until asc
          for update skip locked
          limit $1
        `,
        [Math.max(1, Math.trunc(input.limit))],
      );
      const recoveredAt = new Date().toISOString();
      let recoveredCount = 0;

      for (const row of result.rows) {
        const task = toTaskRecord(row);
        const recoveredTask: ExecutionTaskRecord = {
          ...task,
          status: "queued",
          currentStep: null,
          claimedBy: null,
          claimedAt: null,
          leaseUntil: null,
          heartbeatAt: null,
          attemptStartedAt: null,
          startedAt: null,
          completedAt: null,
          lastErrorCode: "TASK_LEASE_EXPIRED",
          lastErrorMessage: "Task lease expired before completion; task was requeued.",
        };
        const event = createTaskEvent(recoveredTask, {
          eventType: "task_progress",
          status: "queued",
          phase: "queued",
          stepType: null,
          progress: 0,
          message: "Task lease expired; task requeued for recovery.",
          payload: {
            recoveredBy: normalizeWorkerId(input.workerId),
            previousWorkerId: task.claimedBy,
            previousLeaseUntil: task.leaseUntil,
          },
          createdAt: recoveredAt,
          attemptNo: task.currentAttemptNo || null,
        });

        await this.upsertTaskRecord(client, recoveredTask);
        await this.upsertTaskAttemptRecord(client, {
          task,
          attemptNo: task.currentAttemptNo,
          status: "failed",
          currentStep: task.currentStep,
          progress: 0,
          errorCode: "TASK_LEASE_EXPIRED",
          errorMessage: "Task lease expired before completion.",
          startedAt: task.attemptStartedAt ?? task.startedAt ?? recoveredAt,
          completedAt: recoveredAt,
        });
        await this.insertTaskEventRecord(client, event, task.workflowId);
        await this.recomputeRunStatus(client, task.runId, null);
        recoveredCount += 1;
      }

      return recoveredCount;
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

  private async nextSequenceValue(
    executor: QueryExecutor,
    sequenceName: "execution_run_no_seq" | "execution_task_no_seq",
  ): Promise<number> {
    const result = await executor.query<{ value: string | number }>(
      `select nextval('${sequenceName}'::regclass) as value`,
    );
    return Number(result.rows[0]?.value ?? 0);
  }

  private async nextSequenceValues(
    executor: QueryExecutor,
    sequenceName: "execution_run_no_seq" | "execution_task_no_seq",
    count: number,
  ): Promise<number[]> {
    if (count <= 0) {
      return [];
    }

    const result = await executor.query<{ value: string | number }>(
      `
        select nextval('${sequenceName}'::regclass) as value
        from generate_series(1, $1)
      `,
      [count],
    );
    return result.rows.map((row) => Number(row.value));
  }

  private createTaskFileLink(
    task: ExecutionTaskRecord,
    input: LinkTaskFileInput,
  ): ExecutionTaskFileLinkRecord {
    if (input.taskId !== task.id || !TASK_FILE_LINK_ROLES.has(input.role)) {
      throw new Error("TASK_FILE_LINK_INVALID");
    }

    const orderIndex = typeof input.orderIndex === "number"
      ? Math.trunc(input.orderIndex)
      : null;
    const sourceHandle = normalizeOptionalString(input.sourceHandle);
    const groupId = normalizeOptionalString(input.groupId) ?? task.groupId;
    const workflowId = normalizeOptionalString(input.workflowId) ?? task.workflowId;
    const identity = [
      input.taskId,
      input.fileId,
      input.role,
      sourceHandle ?? "",
      orderIndex ?? "",
    ].join(":");

    return {
      id: deterministicUuid(`task_file_link:${identity}`),
      taskId: input.taskId,
      fileId: input.fileId,
      workflowId,
      role: input.role,
      orderIndex,
      sourceHandle,
      groupId,
      createdAt: new Date().toISOString(),
    };
  }

  private async getExecutionRunWithExecutor(
    executor: QueryExecutor,
    runId: string,
  ): Promise<ExecutionRunRecord | null> {
    const result = await executor.query<ExecutionRunDbRow>(
      `
        select ${RUN_SELECT_COLUMNS}
        from execution_runs
        where id = $1
        limit 1
      `,
      [runId],
    );

    return result.rows[0] ? toRunRecord(result.rows[0]) : null;
  }

  private async getTaskByIdWithExecutor(
    executor: QueryExecutor,
    taskId: string,
  ): Promise<ExecutionTaskRecord | null> {
    const result = await executor.query<ExecutionTaskDbRow>(
      `
        select ${TASK_SELECT_COLUMNS}
        from execution_tasks
        where id = $1
        limit 1
      `,
      [taskId],
    );

    return result.rows[0] ? toTaskRecord(result.rows[0]) : null;
  }

  private async recomputeRunStatus(
    executor: QueryExecutor,
    runId: string,
    finishedAt: string | null,
  ): Promise<void> {
    const run = await this.getExecutionRunWithExecutor(executor, runId);
    if (!run) {
      return;
    }

    const tasks = await executor.query<ExecutionTaskDbRow>(
      `
        select ${TASK_SELECT_COLUMNS}
        from execution_tasks
        where run_id = $1
      `,
      [runId],
    );
    const records = tasks.rows.map(toTaskRecord);
    const completedTaskCount = records.filter((task) => task.status === "completed").length;
    const failedTaskCount = records.filter((task) => task.status === "failed").length;
    const allFinished = records.every((task) =>
      task.status === "completed" || task.status === "failed");
    const hasProcessing = records.some((task) => task.status === "processing");
    const hasQueued = records.some((task) => task.status === "queued");
    const nextStatus = allFinished
      ? (failedTaskCount > 0 ? "failed" : "completed")
      : hasProcessing
        ? "processing"
        : hasQueued
          ? "queued"
          : run.status;

    await this.upsertRunRecord(executor, {
      ...run,
      status: nextStatus,
      completedTaskCount,
      failedTaskCount,
      startedAt: nextStatus === "queued" ? null : run.startedAt,
      completedAt: allFinished ? finishedAt ?? run.completedAt : null,
    });
  }

  private async upsertRunRecord(
    executor: QueryExecutor,
    run: ExecutionRunRecord,
  ): Promise<void> {
    await executor.query(
      `
        insert into execution_runs (
          id,
          run_no,
          user_id,
          workflow_id,
          project_id,
          node_type,
          task_type,
          execution_mode,
          node_id,
          node_title,
          provider,
          status,
          total_task_count,
          completed_task_count,
          failed_task_count,
          request_payload,
          result_summary,
          created_at,
          started_at,
          completed_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19, $20
        )
        on conflict (id) do update set
          run_no = excluded.run_no,
          user_id = excluded.user_id,
          workflow_id = excluded.workflow_id,
          project_id = excluded.project_id,
          node_type = excluded.node_type,
          task_type = excluded.task_type,
          execution_mode = excluded.execution_mode,
          node_id = excluded.node_id,
          node_title = excluded.node_title,
          provider = excluded.provider,
          status = excluded.status,
          total_task_count = excluded.total_task_count,
          completed_task_count = excluded.completed_task_count,
          failed_task_count = excluded.failed_task_count,
          request_payload = excluded.request_payload,
          result_summary = excluded.result_summary,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at
      `,
      [
        run.id,
        run.runNo,
        run.userId,
        run.workflowId,
        run.projectId,
        run.nodeType,
        run.taskType,
        run.executionMode,
        run.nodeId,
        run.nodeTitle,
        run.provider,
        run.status,
        run.totalTaskCount,
        run.completedTaskCount,
        run.failedTaskCount,
        JSON.stringify(run.requestPayload),
        run.resultSummary ? JSON.stringify(run.resultSummary) : null,
        run.createdAt,
        run.startedAt,
        run.completedAt,
      ],
    );
  }

  private async upsertTaskRecord(
    executor: QueryExecutor,
    task: ExecutionTaskRecord,
  ): Promise<void> {
    await executor.query(
      `
        insert into execution_tasks (
          id,
          task_no,
          run_id,
          user_id,
          workflow_id,
          project_id,
          node_type,
          node_id,
          node_title,
          task_type,
          group_id,
          group_order,
          provider,
          model,
          input,
          status,
          current_step,
          current_attempt_no,
          retry_count,
          max_retries,
          last_error_code,
          last_error_message,
          result_file_id,
          claimed_by,
          claimed_at,
          lease_until,
          heartbeat_at,
          attempt_started_at,
          created_at,
          started_at,
          completed_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31
        )
        on conflict (id) do update set
          task_no = excluded.task_no,
          run_id = excluded.run_id,
          user_id = excluded.user_id,
          workflow_id = excluded.workflow_id,
          project_id = excluded.project_id,
          node_type = excluded.node_type,
          node_id = excluded.node_id,
          node_title = excluded.node_title,
          task_type = excluded.task_type,
          group_id = excluded.group_id,
          group_order = excluded.group_order,
          provider = excluded.provider,
          model = excluded.model,
          input = excluded.input,
          status = excluded.status,
          current_step = excluded.current_step,
          current_attempt_no = excluded.current_attempt_no,
          retry_count = excluded.retry_count,
          max_retries = excluded.max_retries,
          last_error_code = excluded.last_error_code,
          last_error_message = excluded.last_error_message,
          result_file_id = excluded.result_file_id,
          claimed_by = excluded.claimed_by,
          claimed_at = excluded.claimed_at,
          lease_until = excluded.lease_until,
          heartbeat_at = excluded.heartbeat_at,
          attempt_started_at = excluded.attempt_started_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at
      `,
      [
        task.id,
        task.taskNo,
        task.runId,
        task.userId,
        task.workflowId,
        task.projectId,
        task.nodeType,
        task.nodeId,
        task.nodeTitle,
        task.taskType,
        task.groupId,
        task.groupOrder,
        task.provider,
        task.model,
        task.input ? JSON.stringify(task.input) : null,
        task.status,
        task.currentStep,
        task.currentAttemptNo,
        task.retryCount,
        task.maxRetries,
        task.lastErrorCode,
        task.lastErrorMessage,
        task.resultFileId,
        task.claimedBy,
        task.claimedAt,
        task.leaseUntil,
        task.heartbeatAt,
        task.attemptStartedAt,
        task.createdAt,
        task.startedAt,
        task.completedAt,
      ],
    );
  }

  private async upsertTaskAttemptRecord(
    executor: QueryExecutor,
    input: {
      task: ExecutionTaskRecord;
      attemptNo: number;
      status: ExecutionStatus;
      currentStep: ExecutionStepType | null;
      progress: number;
      errorCode: string | null;
      errorMessage: string | null;
      startedAt: string;
      completedAt: string | null;
    },
  ): Promise<void> {
    if (input.attemptNo < 1) {
      return;
    }

    await executor.query(
      `
        insert into task_attempts (
          task_id,
          attempt_no,
          status,
          current_step,
          progress,
          error_code,
          error_message,
          started_at,
          completed_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (task_id, attempt_no) do update set
          status = excluded.status,
          current_step = excluded.current_step,
          progress = excluded.progress,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          completed_at = excluded.completed_at
      `,
      [
        input.task.id,
        input.attemptNo,
        input.status,
        input.currentStep,
        input.progress,
        input.errorCode,
        input.errorMessage,
        input.startedAt,
        input.completedAt,
      ],
    );
  }

  private async insertTaskEventRecord(
    executor: QueryExecutor,
    event: ExecutionTaskEventRecord,
    workflowId?: string | null,
  ): Promise<void> {
    const createdAt = await this.resolveTaskEventCreatedAt(
      executor,
      event.taskId,
      event.createdAt,
    );

    await executor.query(
      `
        insert into task_events (
          id,
          run_id,
          task_id,
          workflow_id,
          attempt_no,
          event_type,
          status,
          phase,
          step_type,
          progress,
          message,
          payload,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
        on conflict (id) do nothing
      `,
      [
        event.id,
        event.runId,
        event.taskId,
        workflowId ?? null,
        event.attemptNo,
        event.eventType,
        event.status,
        event.phase,
        event.stepType,
        event.progress,
        event.message,
        event.payload ? JSON.stringify(event.payload) : null,
        createdAt,
      ],
    );
  }

  private async resolveTaskEventCreatedAt(
    executor: QueryExecutor,
    taskId: string,
    candidateCreatedAt: string,
  ): Promise<string> {
    const result = await executor.query<LatestTaskEventCreatedAtRow>(
      `
        select created_at
        from task_events
        where task_id = $1
        order by created_at desc, id desc
        limit 1
      `,
      [taskId],
    );
    const previousCreatedAt = toIsoString(result.rows[0]?.created_at ?? null);

    if (!previousCreatedAt) {
      return candidateCreatedAt;
    }

    const previousMs = Date.parse(previousCreatedAt);
    const candidateMs = Date.parse(candidateCreatedAt);

    if (!Number.isFinite(previousMs) || !Number.isFinite(candidateMs)) {
      return candidateCreatedAt;
    }

    return candidateMs > previousMs
      ? candidateCreatedAt
      : new Date(previousMs + 1).toISOString();
  }

  private async insertTaskFileLinkRecord(
    executor: QueryExecutor,
    link: ExecutionTaskFileLinkRecord,
  ): Promise<void> {
    await executor.query(
      `
        insert into task_file_links (
          id,
          task_id,
          file_id,
          workflow_id,
          role,
          order_index,
          source_handle,
          group_id,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (id) do update set
          workflow_id = excluded.workflow_id,
          role = excluded.role,
          order_index = excluded.order_index,
          source_handle = excluded.source_handle,
          group_id = excluded.group_id
      `,
      [
        link.id,
        link.taskId,
        link.fileId,
        link.workflowId,
        link.role,
        link.orderIndex,
        link.sourceHandle,
        link.groupId,
        link.createdAt,
      ],
    );
  }
}
