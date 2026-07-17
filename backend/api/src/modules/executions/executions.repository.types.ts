import type {
  CreateExecutionRequest,
  CreateExecutionResponseData,
} from "@newworkflow/backend-shared/api";
import type {
  ExecutionPhase,
  ExecutionStatus,
  ExecutionStepType,
  NodeTaskType,
  TaskEventType,
} from "@newworkflow/backend-shared/execution";
import type { TaskFileRole } from "@newworkflow/backend-shared";
import type {
  ExecutionRunRecord,
  ExecutionTaskEventRecord,
  ExecutionTaskRecord,
} from "./execution-records.types.ts";

export interface QueueClaimResult {
  runId: string;
  task: ExecutionTaskRecord;
}

export interface QueueClaimOptions {
  workerId?: string;
  leaseMs?: number;
}

export interface CreateExecutionStoreRunInput {
  userId: string | null;
  workflowId: string | null;
  projectId: string | null;
  nodeType: string;
  taskType: NodeTaskType;
  executionMode: string;
  nodeId: string | null;
  nodeTitle: string | null;
  provider: string | null;
  requestPayload: CreateExecutionRequest;
}

export interface CreateExecutionStoreTaskInput {
  workflowId: string | null;
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
  whiteModelFileId?: string | null;
  styleReferenceFileId?: string | null;
}

export interface CreateExecutionStoreInput {
  run: CreateExecutionStoreRunInput;
  tasks: CreateExecutionStoreTaskInput[];
}

export interface AppendTaskEventInput {
  taskId: string;
  eventType: TaskEventType;
  status: ExecutionStatus;
  phase: ExecutionPhase;
  stepType: ExecutionStepType | null;
  progress: number;
  message: string | null;
  payload?: Record<string, unknown> | null;
  attemptNo?: number | null;
}

export interface RequeueTaskInput {
  taskId: string;
  errorCode: string;
  errorMessage: string;
}

export interface QueuedTaskStats {
  total: number;
  byProvider: Record<string, number>;
}

export interface LinkTaskFileInput {
  taskId: string;
  fileId: string;
  role: TaskFileRole;
  orderIndex?: number | null;
  sourceHandle?: string | null;
  groupId?: string | null;
  workflowId?: string | null;
}

export interface ExecutionTaskFileLinkRecord {
  id: string;
  taskId: string;
  fileId: string;
  workflowId: string | null;
  role: TaskFileRole;
  orderIndex: number | null;
  sourceHandle: string | null;
  groupId: string | null;
  createdAt: string;
}

export interface ExecutionsRepository {
  ensureInitialized(): Promise<void>;
  createExecution(input: CreateExecutionStoreInput): Promise<CreateExecutionResponseData>;
  getExecutionRun(runId: string): Promise<ExecutionRunRecord | null>;
  getExecutionRunById(runId: string): Promise<ExecutionRunRecord | null>;
  getTasksByRunId(runId: string): Promise<ExecutionTaskRecord[]>;
  findLatestCompletedRunForWorkflowNode(
    workflowId: string,
    nodeId: string,
  ): Promise<ExecutionRunRecord | null>;
  getTaskById(taskId: string): Promise<ExecutionTaskRecord | null>;
  listTasks(filters: {
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
  }>;
  getTaskEvents(taskId: string): Promise<ExecutionTaskEventRecord[]>;
  listQueuedTasks(limit: number): Promise<ExecutionTaskRecord[]>;
  getQueuedTaskStats(): Promise<QueuedTaskStats>;
  claimQueuedTasks(limit: number, options?: QueueClaimOptions): Promise<QueueClaimResult[]>;
  claimQueuedTaskById(taskId: string, options?: QueueClaimOptions): Promise<QueueClaimResult | null>;
  markTaskCompleted(taskId: string): Promise<void>;
  updateTaskAttempt(input: {
    taskId: string;
    attemptNo: number;
    retryCount: number;
    currentStep: ExecutionStepType | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
  }): Promise<void>;
  updateTaskResultFile(
    taskId: string,
    resultFileId: string,
    options?: {
      role?: TaskFileRole;
      sourceHandle?: string | null;
      orderIndex?: number | null;
    },
  ): Promise<void>;
  linkTaskFile(input: LinkTaskFileInput): Promise<ExecutionTaskFileLinkRecord>;
  getTaskFileLinks(taskId: string): Promise<ExecutionTaskFileLinkRecord[]>;
  appendTaskEvent(input: AppendTaskEventInput): Promise<void>;
  markTaskFailed(
    taskId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
  requeueTask(input: RequeueTaskInput): Promise<void>;
  heartbeatTaskLease?(input: {
    taskId: string;
    workerId: string;
    leaseMs: number;
  }): Promise<boolean>;
  recoverExpiredProcessingTasks?(input: {
    workerId: string;
    limit: number;
  }): Promise<number>;
}
