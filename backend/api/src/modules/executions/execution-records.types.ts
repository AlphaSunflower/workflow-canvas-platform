import type { CreateExecutionRequest } from "@newworkflow/backend-shared/api";
import type {
  ExecutionPhase,
  ExecutionStatus,
  ExecutionStepType,
  NodeTaskType,
  TaskEventType,
} from "@newworkflow/backend-shared/execution";
import { EXECUTION_STATUSES } from "@newworkflow/backend-shared";

export interface ExecutionTaskRecord {
  id: string;
  taskNo: string;
  runId: string;
  userId: string | null;
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
  status: (typeof EXECUTION_STATUSES)[number];
  currentStep: ExecutionStepType | null;
  currentAttemptNo: number;
  retryCount: number;
  maxRetries: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  resultFileId: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  leaseUntil: string | null;
  heartbeatAt: string | null;
  attemptStartedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  whiteModelFileId: string | null;
  styleReferenceFileId: string | null;
}

export interface ExecutionRunRecord {
  id: string;
  runNo: string;
  userId: string | null;
  workflowId: string | null;
  projectId: string | null;
  nodeType: string;
  taskType: NodeTaskType;
  executionMode: string;
  nodeId: string | null;
  nodeTitle: string | null;
  provider: string | null;
  status: (typeof EXECUTION_STATUSES)[number];
  totalTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  requestPayload: CreateExecutionRequest;
  resultSummary: null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ExecutionTaskEventRecord {
  id: string;
  runId: string;
  taskId: string;
  attemptNo: number | null;
  eventType: TaskEventType;
  status: ExecutionStatus;
  phase: ExecutionPhase;
  stepType: ExecutionStepType | null;
  progress: number;
  message: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}
