import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
import type {
  AppendTaskEventInput,
  CreateExecutionStoreInput,
  ExecutionTaskFileLinkRecord,
  LinkTaskFileInput,
  QueueClaimResult,
  QueuedTaskStats,
  RequeueTaskInput,
} from "./executions.repository.types.ts";
import {
  buildTaskInputFileLinks,
  buildTaskPayload,
  compareTaskOrder,
  deterministicUuid,
  formatSequence,
  normalizeOptionalString,
} from "./executions.repository.helpers.ts";
import { WorkflowTaskHistoryRepository } from "../workflows/workflow-task-history.repository.ts";

export type {
  ExecutionRunRecord,
  ExecutionTaskEventRecord,
  ExecutionTaskRecord,
} from "./execution-records.types.ts";

interface QueueClaimMutationResult extends QueueClaimResult {
  event: ExecutionTaskEventRecord;
}

interface ExecutionStore {
  runSequence: number;
  taskSequence: number;
  runs: ExecutionRunRecord[];
  tasks: ExecutionTaskRecord[];
  events: ExecutionTaskEventRecord[];
  taskFileLinks: ExecutionTaskFileLinkRecord[];
}

export interface ExecutionsRepositoryOptions {
  databaseConfig?: DatabaseConfig;
  pool?: DatabasePool;
  mirrorToDatabase?: boolean;
}

const TASK_CREATED_MESSAGE = "任务已创建，等待调度。";
const TASK_STARTED_MESSAGE = "任务已被 Worker 拉起执行。";
const TASK_COMPLETED_MESSAGE = "任务执行完成。";
const TASK_FILE_LINK_ROLES = new Set<TaskFileRole>([
  "input",
  "reference",
  "intermediate",
  "output",
]);

type QueryExecutor = Pick<TransactionClient, "query">;

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

function applyQueuedTaskClaim(
  store: ExecutionStore,
  task: ExecutionTaskRecord,
  claimedAt: string,
): QueueClaimMutationResult {
  task.status = "processing";
  task.currentStep = null;
  task.currentAttemptNo = 1;
  task.startedAt = claimedAt;

  const run = store.runs.find((item) => item.id === task.runId);

  if (run && run.status === "queued") {
    run.status = "processing";
    run.startedAt = claimedAt;
  }

  const event = createTaskEvent(task, {
    eventType: "task_started",
    status: "processing",
    phase: "processing",
    stepType: null,
    progress: 0,
    message: TASK_STARTED_MESSAGE,
    payload: buildTaskPayload(task),
    createdAt: claimedAt,
  });

  if (!task.workflowId) {
    store.events.push(event);
  }

  return {
    runId: task.runId,
    task: { ...task },
    event,
  };
}

export class JsonExecutionsRepository {
  private readonly dataDir: string;
  private readonly storePath: string;
  private readonly lockPath: string;
  private readonly workflowTaskHistoryRepository: WorkflowTaskHistoryRepository;
  private readonly databaseConfig: DatabaseConfig | null;
  private readonly pool: DatabasePool | null;
  private readonly mirrorToDatabase: boolean;
  private readonly lockRetryDelayMs = 25;
  private readonly lockTimeoutMs = 5_000;
  private readonly staleLockThresholdMs = 30_000;
  private readonly unlockRetryCount = 3;

  constructor(rootDir: string, options: ExecutionsRepositoryOptions = {}) {
    this.dataDir = path.join(rootDir, "data");
    this.storePath = path.join(this.dataDir, "executions-store.json");
    this.lockPath = path.join(this.dataDir, "executions-store.lock");
    this.workflowTaskHistoryRepository = new WorkflowTaskHistoryRepository(rootDir);
    this.databaseConfig = options.databaseConfig ?? null;
    this.pool = options.pool ?? null;
    this.mirrorToDatabase = options.mirrorToDatabase === true;
  }

  async ensureInitialized(): Promise<void> {
    await this.withStoreLock(async () => {
      await this.ensureInitializedUnsafe();
    });
  }

  async createExecution(
    input: CreateExecutionStoreInput,
  ): Promise<CreateExecutionResponseData> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      store.runSequence += 1;
      const runId = randomUUID();
      const createdAt = new Date().toISOString();
      const runNo = formatSequence("RUN", store.runSequence);

      const taskResponses: CreateExecutionTaskResponse[] = [];
      const taskRecords: ExecutionTaskRecord[] = input.tasks.map((taskInput) => {
        store.taskSequence += 1;
        const taskId = randomUUID();
        const taskNo = formatSequence("TASK", store.taskSequence);

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

      const eventRecords: ExecutionTaskEventRecord[] = taskRecords.map((task) =>
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

      store.runs.push(runRecord);
      store.tasks.push(...taskRecords);
      const inputFileLinks = taskRecords.flatMap((task) =>
        buildTaskInputFileLinks(task, createdAt)
      );
      store.taskFileLinks.push(...inputFileLinks);
      store.events.push(...eventRecords.filter((event) => {
        const task = taskRecords.find((item) => item.id === event.taskId);
        return !task?.workflowId;
      }));
      await this.writeStoreUnsafe(store);
      await this.mirrorExecutionCreatedToDatabase(
        runRecord,
        taskRecords,
        eventRecords,
        inputFileLinks,
      );
      await this.workflowTaskHistoryRepository.recordExecutionCreated(
        runRecord,
        taskRecords,
        eventRecords,
      );

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
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return store.runs.find((run) => run.id === runId) ?? null;
    });
  }

  async getExecutionRunById(runId: string): Promise<ExecutionRunRecord | null> {
    return this.getExecutionRun(runId);
  }

  async getTasksByRunId(runId: string): Promise<ExecutionTaskRecord[]> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return store.tasks
        .filter((task) => task.runId === runId)
        .sort(compareTaskOrder);
    });
  }

  async findLatestCompletedRunForWorkflowNode(
    workflowId: string,
    nodeId: string,
  ): Promise<ExecutionRunRecord | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const matchingRuns = store.runs
        .filter((run) => (
          run.workflowId === workflowId
          && run.nodeId === nodeId
          && run.status === 'completed'
        ))
        .sort((left, right) => {
          const leftCompletedAt = left.completedAt ?? left.createdAt;
          const rightCompletedAt = right.completedAt ?? right.createdAt;
          if (leftCompletedAt !== rightCompletedAt) {
            return leftCompletedAt < rightCompletedAt ? 1 : -1;
          }

          return left.createdAt < right.createdAt ? 1 : -1;
        });

      return matchingRuns[0] ?? null;
    });
  }

  async getTaskById(taskId: string): Promise<ExecutionTaskRecord | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return store.tasks.find((task) => task.id === taskId) ?? null;
    });
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
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      let items = [...store.tasks];

      if (filters.runId) {
        items = items.filter((task) => task.runId === filters.runId);
      }

      if (filters.userId) {
        items = items.filter((task) => task.userId === filters.userId);
      }

      if (filters.status) {
        items = items.filter((task) => task.status === filters.status);
      }

      items.sort((left, right) => compareTaskOrder(right, left));

      const total = items.length;
      const start = (filters.page - 1) * filters.pageSize;

      return {
        items: items.slice(start, start + filters.pageSize),
        total,
        page: filters.page,
        pageSize: filters.pageSize,
      };
    });
  }

  async getTaskEvents(taskId: string): Promise<ExecutionTaskEventRecord[]> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const task = store.tasks.find((item) => item.id === taskId) ?? null;

      if (!task) {
        return [];
      }

      if (task.workflowId) {
        const result = await this.workflowTaskHistoryRepository.getTaskEvents(
          task.workflowId,
          taskId,
          { sortOrder: "asc" },
        );
        return result.items;
      }

      return store.events
        .filter((event) => event.taskId === taskId)
        .sort((left, right) => {
          if (left.createdAt === right.createdAt) {
            return left.id.localeCompare(right.id);
          }

          return left.createdAt < right.createdAt ? -1 : 1;
        });
    });
  }

  async listQueuedTasks(limit: number): Promise<ExecutionTaskRecord[]> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return store.tasks
        .filter((task) => task.status === "queued")
        .sort(compareTaskOrder)
        .slice(0, limit)
        .map((task) => ({ ...task }));
    });
  }

  async getQueuedTaskStats(): Promise<QueuedTaskStats> {
    return this.withStoreLock(async () => {
      const queuedTasks = (await this.readStoreUnsafe()).tasks
        .filter((task) => task.status === "queued");
      const byProvider: Record<string, number> = {};

      for (const task of queuedTasks) {
        const providerKey =
          typeof task.provider === "string" && task.provider.trim().length > 0
            ? task.provider.trim()
            : task.taskType || "default";
        byProvider[providerKey] = (byProvider[providerKey] ?? 0) + 1;
      }

      return {
        total: queuedTasks.length,
        byProvider,
      };
    });
  }

  async claimQueuedTasks(limit: number): Promise<QueueClaimResult[]> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const queuedTasks = store.tasks
        .filter((task) => task.status === "queued")
        .sort(compareTaskOrder)
        .slice(0, limit);

      if (queuedTasks.length === 0) {
        return [];
      }

      const claimedAt = new Date().toISOString();
      const claimedResults: QueueClaimMutationResult[] = [];

      for (const queuedTask of queuedTasks) {
        const task = store.tasks.find((item) => item.id === queuedTask.id);

        if (!task || task.status !== "queued") {
          continue;
        }

        claimedResults.push(applyQueuedTaskClaim(store, task, claimedAt));
      }

      await this.writeStoreUnsafe(store);
      await this.mirrorClaimedTasksToDatabase(claimedResults, store.runs);
      await Promise.all(claimedResults.map((result) =>
        this.syncWorkflowHistoryTask(result.task, result.event)
      ));

      return claimedResults.map(({ event: _event, ...result }) => result);
    });
  }

  async claimQueuedTaskById(taskId: string): Promise<QueueClaimResult | null> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const task = store.tasks.find((item) => item.id === taskId);

      if (!task || task.status !== "queued") {
        return null;
      }

      const claimedAt = new Date().toISOString();
      const claimed = applyQueuedTaskClaim(store, task, claimedAt);
      await this.writeStoreUnsafe(store);
      const run = store.runs.find((item) => item.id === claimed.runId);
      await this.mirrorClaimedTasksToDatabase(claimed ? [claimed] : [], run ? [run] : []);
      await this.syncWorkflowHistoryTask(claimed.task, claimed.event);

      return {
        runId: claimed.runId,
        task: claimed.task,
      };
    });
  }

  async markTaskCompleted(taskId: string): Promise<void> {
    await this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const task = store.tasks.find((item) => item.id === taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      const completedAt = new Date().toISOString();
      task.status = "completed";
      task.currentStep = "final";
      task.completedAt = completedAt;

      const event = createTaskEvent(task, {
        eventType: "task_completed",
        status: "completed",
        phase: "completed",
        stepType: "final",
        progress: 100,
        message: TASK_COMPLETED_MESSAGE,
        payload: buildTaskPayload(task),
        createdAt: completedAt,
      });

      if (!task.workflowId) {
        store.events.push(event);
      }

      const run = store.runs.find((item) => item.id === task.runId);

      if (run) {
        run.completedTaskCount = store.tasks.filter(
          (item) => item.runId === run.id && item.status === "completed",
        ).length;
        run.failedTaskCount = store.tasks.filter(
          (item) => item.runId === run.id && item.status === "failed",
        ).length;

        const runTasks = store.tasks.filter((item) => item.runId === run.id);
        const allFinished = runTasks.every(
          (item) => item.status === "completed" || item.status === "failed",
        );

        if (allFinished) {
          run.status = run.failedTaskCount > 0 ? "failed" : "completed";
          run.completedAt = completedAt;
        }
      }

      await this.writeStoreUnsafe(store);
      await this.mirrorTaskUpdatedToDatabase({ ...task });
      await this.mirrorTaskEventToDatabase(event);
      if (run) {
        await this.mirrorRunUpdatedToDatabase({ ...run });
      }
      await this.syncWorkflowHistoryTask({ ...task }, event);
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
    await this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const task = store.tasks.find((item) => item.id === input.taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      task.currentAttemptNo = input.attemptNo;
      task.retryCount = input.retryCount;
      task.currentStep = input.currentStep;
      task.lastErrorCode = input.lastErrorCode;
      task.lastErrorMessage = input.lastErrorMessage;

      await this.writeStoreUnsafe(store);
      await this.mirrorTaskUpdatedToDatabase({ ...task });
      await this.syncWorkflowHistoryTask({ ...task });
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
    await this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const task = store.tasks.find((item) => item.id === taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      task.resultFileId = resultFileId;
      task.currentStep = "final";
      const link = this.upsertTaskFileLinkUnsafe(store, task, {
        taskId,
        fileId: resultFileId,
        role: options?.role ?? "output",
        sourceHandle: options?.sourceHandle ?? "resultFileId",
        orderIndex: options?.orderIndex ?? null,
      });
      await this.writeStoreUnsafe(store);
      await this.mirrorTaskUpdatedToDatabase({ ...task });
      if (link) {
        await this.mirrorTaskFileLinkToDatabase(link);
      }
      await this.syncWorkflowHistoryTask({ ...task });
    });
  }

  async linkTaskFile(input: LinkTaskFileInput): Promise<ExecutionTaskFileLinkRecord> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const task = store.tasks.find((item) => item.id === input.taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      const link = this.upsertTaskFileLinkUnsafe(store, task, input);
      if (!link) {
        throw new Error("TASK_FILE_LINK_INVALID");
      }
      await this.writeStoreUnsafe(store);

      await this.mirrorTaskFileLinkToDatabase(link);
      return link;
    });
  }

  async getTaskFileLinks(taskId: string): Promise<ExecutionTaskFileLinkRecord[]> {
    return this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      return store.taskFileLinks.filter((link) => link.taskId === taskId);
    });
  }

  async appendTaskEvent(input: AppendTaskEventInput): Promise<void> {
    await this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const task = store.tasks.find((item) => item.id === input.taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      task.currentStep = input.stepType;

      const event = createTaskEvent(task, {
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

      if (!task.workflowId) {
        store.events.push(event);
      }

      await this.writeStoreUnsafe(store);
      await this.mirrorTaskUpdatedToDatabase({ ...task });
      await this.mirrorTaskEventToDatabase(event);
      await this.syncWorkflowHistoryTask({ ...task }, event);
    });
  }

  async markTaskFailed(
    taskId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const task = store.tasks.find((item) => item.id === taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      const failedAt = new Date().toISOString();
      task.status = "failed";
      task.completedAt = failedAt;
      task.lastErrorCode = errorCode;
      task.lastErrorMessage = errorMessage;

      const payload = buildTaskPayload(task) ?? {};
      payload.errorCode = errorCode;

      const event = createTaskEvent(task, {
        eventType: "task_failed",
        status: "failed",
        phase: "failed",
        stepType: task.currentStep,
        progress: 100,
        message: errorMessage,
        payload,
        createdAt: failedAt,
      });

      if (!task.workflowId) {
        store.events.push(event);
      }

      const run = store.runs.find((item) => item.id === task.runId);

      if (run) {
        run.completedTaskCount = store.tasks.filter(
          (item) => item.runId === run.id && item.status === "completed",
        ).length;
        run.failedTaskCount = store.tasks.filter(
          (item) => item.runId === run.id && item.status === "failed",
        ).length;

        const runTasks = store.tasks.filter((item) => item.runId === run.id);
        const allFinished = runTasks.every(
          (item) => item.status === "completed" || item.status === "failed",
        );

        if (allFinished) {
          run.status = "failed";
          run.completedAt = failedAt;
        }
      }

      await this.writeStoreUnsafe(store);
      await this.mirrorTaskUpdatedToDatabase({ ...task });
      await this.mirrorTaskEventToDatabase(event);
      if (run) {
        await this.mirrorRunUpdatedToDatabase({ ...run });
      }
      await this.syncWorkflowHistoryTask({ ...task }, event);
    });
  }

  async requeueTask(input: RequeueTaskInput): Promise<void> {
    await this.withStoreLock(async () => {
      const store = await this.readStoreUnsafe();
      const task = store.tasks.find((item) => item.id === input.taskId);

      if (!task) {
        throw new Error("TASK_NOT_FOUND");
      }

      task.status = "queued";
      task.currentStep = null;
      task.startedAt = null;
      task.completedAt = null;
      task.lastErrorCode = input.errorCode;
      task.lastErrorMessage = input.errorMessage;

      const run = store.runs.find((item) => item.id === task.runId);

      if (run) {
        const runTasks = store.tasks.filter((item) => item.runId === run.id);
        const hasProcessing = runTasks.some((item) => item.status === "processing");
        const hasQueued = runTasks.some((item) => item.status === "queued");

        if (hasProcessing) {
          run.status = "processing";
        } else if (hasQueued) {
          run.status = "queued";
          run.startedAt = null;
          run.completedAt = null;
        }
      }

      await this.writeStoreUnsafe(store);
      await this.mirrorTaskUpdatedToDatabase({ ...task });
      await this.syncWorkflowHistoryTask({ ...task });
    });
  }

  private async syncWorkflowHistoryTask(
    task: ExecutionTaskRecord,
    event?: ExecutionTaskEventRecord,
  ): Promise<void> {
    if (!task.workflowId) {
      return;
    }

    await this.workflowTaskHistoryRepository.syncTask(task);

    if (event) {
      await this.workflowTaskHistoryRepository.appendTaskEvent(task, event);
    }
  }

  private upsertTaskFileLinkUnsafe(
    store: ExecutionStore,
    task: ExecutionTaskRecord,
    input: LinkTaskFileInput,
  ): ExecutionTaskFileLinkRecord | null {
    if (input.taskId !== task.id) {
      return null;
    }

    if (!TASK_FILE_LINK_ROLES.has(input.role)) {
      return null;
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
    const existing = store.taskFileLinks.find((link) =>
      link.taskId === input.taskId
      && link.fileId === input.fileId
      && link.role === input.role
      && link.sourceHandle === sourceHandle
      && link.orderIndex === orderIndex);

    if (existing) {
      existing.workflowId = workflowId;
      existing.groupId = groupId;
      return { ...existing };
    }

    const createdAt = new Date().toISOString();
    const link: ExecutionTaskFileLinkRecord = {
      id: deterministicUuid(`task_file_link:${identity}`),
      taskId: input.taskId,
      fileId: input.fileId,
      workflowId,
      role: input.role,
      orderIndex,
      sourceHandle,
      groupId,
      createdAt,
    };

    store.taskFileLinks.push(link);
    return { ...link };
  }

  private async mirrorExecutionCreatedToDatabase(
    run: ExecutionRunRecord,
    tasks: ExecutionTaskRecord[],
    events: ExecutionTaskEventRecord[],
    links: ExecutionTaskFileLinkRecord[],
  ): Promise<void> {
    if (!this.shouldMirrorToDatabase()) {
      return;
    }

    await this.withDatabaseTransaction(async (client) => {
      await this.upsertRunRecord(client, run);
      for (const task of tasks) {
        await this.upsertTaskRecord(client, task);
      }
      for (const event of events) {
        const task = tasks.find((item) => item.id === event.taskId);
        await this.insertTaskEventRecord(client, event, task?.workflowId ?? null);
      }
      for (const link of links) {
        await this.insertTaskFileLinkRecord(client, link);
      }
    });
  }

  private async mirrorClaimedTasksToDatabase(
    claimedResults: QueueClaimMutationResult[],
    runs: ExecutionRunRecord[],
  ): Promise<void> {
    if (!this.shouldMirrorToDatabase()) {
      return;
    }

    await this.withDatabaseTransaction(async (client) => {
      for (const result of claimedResults) {
        await this.upsertTaskRecord(client, result.task);
        await this.insertTaskEventRecord(client, result.event, result.task.workflowId);
      }

      const runIds = new Set(claimedResults.map((result) => result.runId));
      for (const run of runs) {
        if (runIds.has(run.id)) {
          await this.upsertRunRecord(client, run);
        }
      }
    });
  }

  private async mirrorRunUpdatedToDatabase(run: ExecutionRunRecord): Promise<void> {
    if (!this.shouldMirrorToDatabase()) {
      return;
    }

    await this.upsertRunRecord(this, run);
  }

  private async mirrorTaskUpdatedToDatabase(task: ExecutionTaskRecord): Promise<void> {
    if (!this.shouldMirrorToDatabase()) {
      return;
    }

    await this.upsertTaskRecord(this, task);
  }

  private async mirrorTaskEventToDatabase(event: ExecutionTaskEventRecord): Promise<void> {
    if (!this.shouldMirrorToDatabase()) {
      return;
    }

    await this.insertTaskEventRecord(this, event);
  }

  private async mirrorTaskFileLinkToDatabase(
    link: ExecutionTaskFileLinkRecord,
  ): Promise<void> {
    if (!this.shouldMirrorToDatabase()) {
      return;
    }

    await this.insertTaskFileLinkRecord(this, link);
  }

  private shouldMirrorToDatabase(): boolean {
    return this.mirrorToDatabase && (this.pool !== null || this.databaseConfig !== null);
  }

  private async withDatabaseTransaction<T>(
    callback: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (this.pool) {
      return withTransaction(this.pool, callback);
    }

    if (!this.databaseConfig) {
      throw new Error("DATABASE_CONFIG_REQUIRED");
    }

    return withTransaction(this.databaseConfig, callback);
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
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

  private async insertTaskEventRecord(
    executor: QueryExecutor,
    event: ExecutionTaskEventRecord,
    workflowId?: string | null,
  ): Promise<void> {
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
        workflowId ?? await this.resolveTaskWorkflowId(event.taskId),
        event.attemptNo,
        event.eventType,
        event.status,
        event.phase,
        event.stepType,
        event.progress,
        event.message,
        event.payload ? JSON.stringify(event.payload) : null,
        event.createdAt,
      ],
    );
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

  private async resolveTaskWorkflowId(
    taskId: string,
  ): Promise<string | null> {
    const store = await this.readStoreUnsafe();
    return store.tasks.find((task) => task.id === taskId)?.workflowId ?? null;
  }


  private async readStoreUnsafe(): Promise<ExecutionStore> {
    await this.ensureInitializedUnsafe();
    const raw = await fs.readFile(this.storePath, "utf8");
    return this.normalizeStore(JSON.parse(raw) as Partial<ExecutionStore>);
  }

  private async writeStoreUnsafe(store: ExecutionStore): Promise<void> {
    await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
  }

  private async ensureInitializedUnsafe(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });

    try {
      await fs.access(this.storePath);
    } catch {
      await this.writeStoreUnsafe({
        runSequence: 0,
        taskSequence: 0,
        runs: [],
        tasks: [],
        events: [],
        taskFileLinks: [],
      });
    }
  }

  private async withStoreLock<T>(action: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.dataDir, { recursive: true });
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
          throw new Error("EXECUTION_STORE_LOCK_TIMEOUT");
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

  private normalizeStore(store: Partial<ExecutionStore>): ExecutionStore {
    return {
      runSequence: store.runSequence ?? 0,
      taskSequence: store.taskSequence ?? 0,
      runs: store.runs ?? [],
      tasks: store.tasks ?? [],
      events: store.events ?? [],
      taskFileLinks: store.taskFileLinks ?? [],
    };
  }
}
