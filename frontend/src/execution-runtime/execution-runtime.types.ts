import type { FileInfo, UUID } from '@/types';
import type { AITaskOutput } from '@/types/ai.types';
import type { NodeType, TaskStatus } from '@/types/base.types';
import type {
  EXECUTION_RUNTIME_EVENT_TYPES,
  EXECUTION_RUNTIME_GROUP_STATUSES,
  EXECUTION_RUNTIME_PHASES,
  EXECUTION_RUNTIME_RESULT_COMMIT_STATUSES,
  EXECUTION_RUNTIME_STATUSES,
  EXECUTION_RUNTIME_STEP_TYPES,
} from './execution-runtime.constants';

export type ExecutionRuntimeStatus = typeof EXECUTION_RUNTIME_STATUSES[number];
export type ExecutionRuntimeGroupStatus = typeof EXECUTION_RUNTIME_GROUP_STATUSES[number];
export type ExecutionRuntimePhase = typeof EXECUTION_RUNTIME_PHASES[number];
export type ExecutionRuntimeStep = typeof EXECUTION_RUNTIME_STEP_TYPES[number] | null;
export type ExecutionRuntimeEventType = typeof EXECUTION_RUNTIME_EVENT_TYPES[number];
export type ExecutionRuntimeResultCommitStatus = typeof EXECUTION_RUNTIME_RESULT_COMMIT_STATUSES[number];

export interface ExecutionRuntimeCreateTaskSummary {
  taskId: string;
  taskNo: string;
  groupId: string;
  groupOrder: number;
  status: ExecutionRuntimeStatus;
}

export interface ExecutionRuntimeSummary {
  runId: string;
  runNo: string;
  status: ExecutionRuntimeStatus;
  tasks: ExecutionRuntimeCreateTaskSummary[];
}

export interface ExecutionRuntimeTaskState {
  taskId: string;
  taskNo: string;
  runId: string;
  runNo: string;
  nodeId?: string | null;
  nodeType?: NodeType | string | null;
  groupId: string;
  groupOrder: number;
  status: ExecutionRuntimeStatus;
  currentStep: ExecutionRuntimeStep;
  currentAttemptNo: number;
  retryCount: number;
  maxRetries: number;
  maxAttempts: number;
  progress: number;
  message: string | null;
  output?: AITaskOutput;
  error: string | null;
  errorCode: string | null;
  lastErrorCode: string | null;
  resultFileId: string | null;
  resultFile?: FileInfo;
  resultFileInfo?: FileInfo;
  resultCommitStatus?: ExecutionRuntimeResultCommitStatus;
  resultCommittedAt?: number | null;
  resultCommitError?: string | null;
  canCommitOutput?: boolean;
  isTerminal?: boolean;
  isOutputCommitted?: boolean;
}

export interface ExecutionRuntimeRunState {
  runId: string;
  runNo: string;
  workflowId?: string | null;
  nodeId?: string | null;
  nodeType?: NodeType | string | null;
  status: ExecutionRuntimeStatus;
  totalTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  progress: number;
  message: string | null;
  createdAt?: number | null;
  startedAt?: number | null;
  completedAt?: number | null;
  isTerminal: boolean;
  hasCommittableOutput: boolean;
  allOutputsCommitted: boolean;
  tasks: ExecutionRuntimeTaskState[];
}

export interface ExecutionRuntimeGroupState {
  workflowId?: string | null;
  runId?: string;
  runNo?: string;
  nodeId?: string;
  nodeType?: NodeType | string;
  groupId: string;
  groupOrder?: number;
  taskRecordId: string | null;
  aiTaskId: string | null;
  taskNo?: string;
  batchId?: string;
  status: ExecutionRuntimeGroupStatus | null;
  progress: number;
  message: string | null;
  output?: AITaskOutput;
  currentStep?: ExecutionRuntimeStep;
  currentAttemptNo?: number;
  retryCount?: number;
  maxRetries?: number;
  maxAttempts?: number;
  lastErrorCode?: string | null;
  resultFileId?: string | null;
  resultFile?: FileInfo;
  error?: string;
  resultCommitStatus?: ExecutionRuntimeResultCommitStatus;
  resultCommittedAt?: number | null;
  canCommitOutput?: boolean;
  isTerminal?: boolean;
  isOutputCommitted?: boolean;
}

export interface ExecutionRuntimeNodeState {
  workflowId?: string | null;
  nodeId?: string;
  nodeType?: NodeType | string | null;
  runId?: string;
  runNo?: string;
  taskRecordId: string | null;
  aiTaskId: string | null;
  taskNo?: string;
  batchId?: string;
  status: ExecutionRuntimeStatus | null;
  progress: number;
  message: string | null;
  output?: AITaskOutput;
  currentStep?: ExecutionRuntimeStep;
  currentAttemptNo?: number;
  retryCount?: number;
  maxRetries?: number;
  maxAttempts?: number;
  lastErrorCode?: string | null;
  resultFileId?: string | null;
  resultFile?: FileInfo;
  error?: string;
  totalTaskCount?: number;
  completedTaskCount?: number;
  failedTaskCount?: number;
  resultCommitStatus?: ExecutionRuntimeResultCommitStatus;
  resultCommittedAt?: number | null;
  canCommitOutput?: boolean;
  isTerminal?: boolean;
  isOutputCommitted?: boolean;
}

export interface ExecutionRuntimeEvent {
  eventId: string;
  eventType: ExecutionRuntimeEventType;
  runId: string;
  taskId: string;
  attemptNo: number | null;
  status: ExecutionRuntimeStatus;
  phase: ExecutionRuntimePhase;
  stepType: ExecutionRuntimeStep;
  progress: number;
  message: string | null;
  payload: Record<string, unknown> | null;
  timestamp: string;
}

export interface ExecutionRuntimeTaskEventEnvelope {
  messageType: 'task_event';
  items: ExecutionRuntimeEvent[];
  total: number;
}

export interface ExecutionRuntimePatchMeta {
  version: number;
  runtimeKey: string;
  scope: 'run' | 'node' | 'group';
  revision: number;
  statusChanged: boolean;
  progressChanged: boolean;
  layoutAffected: boolean;
  terminalChanged: boolean;
  commitStateChanged: boolean;
}

export interface ExecutionRuntimeRunPatch {
  kind: 'run';
  runId: string;
  next: Partial<ExecutionRuntimeRunState>;
}

export interface ExecutionRuntimeNodePatch {
  kind: 'node';
  nodeId: string;
  next: Partial<ExecutionRuntimeNodeState>;
}

export interface ExecutionRuntimeGroupPatch {
  kind: 'group';
  nodeId: string;
  groupId: string;
  next: Partial<ExecutionRuntimeGroupState>;
}

export interface ExecutionRuntimeTaskPatch {
  kind: 'task';
  runId: string;
  taskId: string;
  next: Partial<ExecutionRuntimeTaskState>;
}

export type ExecutionRuntimePatch =
  | ExecutionRuntimeRunPatch
  | ExecutionRuntimeNodePatch
  | ExecutionRuntimeGroupPatch
  | ExecutionRuntimeTaskPatch;

export interface ExecutionRuntimeDiffResult {
  changed: boolean;
  patches: ExecutionRuntimePatch[];
  meta: ExecutionRuntimePatchMeta;
}

export interface ExecutionRuntimeBackendFile {
  fileId: string;
  originalName: string;
  displayName: string;
  mimeType: string;
  fileType: 'image' | 'video' | 'ply' | 'unknown';
  sourceType: 'input' | 'intermediate' | 'output';
  sha256: string | null;
  size: number | null;
  extension: string | null;
  width: number | null;
  height: number | null;
  duration?: number | null;
  status: 'pending_upload' | 'ready';
  createdAt: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
}

export interface ExecutionRuntimeBackendTaskItem {
  taskId: string;
  taskNo: string;
  runId: string;
  projectId: string | null;
  groupId: string;
  groupOrder: number;
  provider: string | null;
  model: string | null;
  status: ExecutionRuntimeStatus;
  currentStep: ExecutionRuntimeStep;
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
  inputFileId: string | null;
  sourceFileId: string | null;
  maskFileId: string | null;
  maskMode: string | null;
  workflowId: string | null;
  workflowTemplateKey: string | null;
  providerTaskId: string | null;
  providerClientId: string | null;
  prompt: string | null;
  referenceFileIds: string[] | null;
  stylePreset: string | null;
  imageSize: string | null;
  aspectRatio: string | null;
  whiteModelFileId: string | null;
  styleReferenceFileId: string | null;
  inputFile: ExecutionRuntimeBackendFile | null;
  sourceFile: ExecutionRuntimeBackendFile | null;
  maskFile: ExecutionRuntimeBackendFile | null;
  whiteModelFile: ExecutionRuntimeBackendFile | null;
  styleReferenceFile: ExecutionRuntimeBackendFile | null;
  resultFile: ExecutionRuntimeBackendFile | null;
}

export interface ExecutionRuntimeBackendRunDetail {
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
  status: ExecutionRuntimeStatus;
  totalTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  tasks: ExecutionRuntimeBackendTaskItem[];
}

export interface ExecutionRuntimeSubscriptionHint {
  layoutAffected: boolean;
  visualOnlyChanged: boolean;
  shouldNotify: boolean;
}

export type ExecutionRuntimeId = UUID | string;
export type ExecutionRuntimeTaskStatus = TaskStatus;
