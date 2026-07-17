import type {
  ExecutionPhase,
  ExecutionStatus,
  ExecutionStepType,
  TaskEventType,
} from "../execution.ts";
import type { FileAssetResponse } from "./files.ts";

export interface ExecutionTaskEventPayload {
  eventId: string;
  eventType: TaskEventType;
  runId: string;
  taskId: string;
  attemptNo: number | null;
  status: ExecutionStatus;
  phase: ExecutionPhase;
  stepType: ExecutionStepType | null;
  progress: number;
  message: string | null;
  payload: Record<string, unknown> | null;
  timestamp: string;
}

export interface RealtimeTaskEventMessage {
  type: "task_event";
  payload: ExecutionTaskEventPayload;
}

export interface ExecutionTaskQueryItem {
  sequence?: number;
  taskId: string;
  taskNo: string;
  runId: string;
  runNo: string | null;
  workflowId: string | null;
  projectId: string | null;
  nodeId?: string | null;
  nodeTitle?: string | null;
  nodeType: string;
  taskType: string;
  groupId: string | null;
  groupOrder: number | null;
  provider: string | null;
  model: string | null;
  status: ExecutionStatus;
  currentStep: ExecutionStepType | null;
  currentAttemptNo: number;
  retryCount: number;
  maxRetries: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  resultFileId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs?: number | null;
  input?: Record<string, unknown> | null;
  inputFileId: string | null;
  sourceFileId: string | null;
  maskFileId: string | null;
  maskMode: string | null;
  renderFileId: string | null;
  referenceFileId: string | null;
  workflowTemplateKey: string | null;
  providerTaskId: string | null;
  providerClientId: string | null;
  prompt: string | null;
  referenceFileIds: string[] | null;
  stylePreset: string | null;
  imageSize: string | null;
  aspectRatio: string | null;
  quality: string | null;
  providerRoute: string | null;
  providerModel: string | null;
  resolvedSize: string | null;
  whiteModelFileId: string | null;
  styleReferenceFileId: string | null;
  inputFile: FileAssetResponse | null;
  sourceFile: FileAssetResponse | null;
  maskFile: FileAssetResponse | null;
  renderFile: FileAssetResponse | null;
  referenceFile: FileAssetResponse | null;
  whiteModelFile: FileAssetResponse | null;
  styleReferenceFile: FileAssetResponse | null;
  resultFile: FileAssetResponse | null;
}

export interface ExecutionRunDetailResponseData {
  runId: string;
  runNo: string;
  userId: string | null;
  workflowId: string | null;
  projectId: string | null;
  nodeType: string;
  taskType: string;
  executionMode: string;
  nodeId: string | null;
  nodeTitle: string | null;
  provider: string | null;
  status: ExecutionStatus;
  totalTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  tasks: ExecutionTaskQueryItem[];
}

export interface WorkflowExecutionReconcileRunResponseData extends ExecutionRunDetailResponseData {}

export interface TaskListQuery {
  runId?: string;
  userId?: string;
  status?: ExecutionStatus;
  nodeId?: string;
  nodeType?: string;
  taskType?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "sequence" | "createdAt" | "startedAt" | "completedAt";
  sortOrder?: "asc" | "desc";
}

export interface TaskListResponseData {
  items: ExecutionTaskQueryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TaskDetailResponseData extends ExecutionTaskQueryItem {
  recentEvents: ExecutionTaskEventPayload[];
}

export interface TaskEventsResponseData {
  messageType: "task_event";
  items: ExecutionTaskEventPayload[];
  total: number;
}
