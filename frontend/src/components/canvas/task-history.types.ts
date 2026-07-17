import type { FileInfo, WorkflowRelatedTaskRef } from '@/types';
import type {
  ExecutionRuntimeBackendFile,
  ExecutionRuntimeEvent,
  ExecutionRuntimeRunState,
  ExecutionRuntimeStatus,
  ExecutionRuntimeStep,
} from '@/execution-runtime/execution-runtime.types';

export type WorkflowTaskHistorySortBy = 'sequence' | 'createdAt' | 'startedAt' | 'completedAt';
export type WorkflowTaskHistorySortOrder = 'asc' | 'desc';

export interface WorkflowTaskHistoryListQuery {
  runId?: string;
  status?: ExecutionRuntimeStatus;
  nodeId?: string;
  nodeType?: string;
  taskType?: string;
  page?: number;
  pageSize?: number;
  sortBy?: WorkflowTaskHistorySortBy;
  sortOrder?: WorkflowTaskHistorySortOrder;
}

export interface WorkflowTaskHistoryEventsQuery {
  page?: number;
  pageSize?: number;
  sortOrder?: WorkflowTaskHistorySortOrder;
}

export interface WorkflowTaskHistoryBackendTaskItem {
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
  durationMs?: number | null;
  input?: Record<string, unknown> | null;
  inputFileId: string | null;
  sourceFileId: string | null;
  maskFileId?: string | null;
  maskMode?: string | null;
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
  whiteModelFileId: string | null;
  styleReferenceFileId: string | null;
  inputFile: ExecutionRuntimeBackendFile | null;
  sourceFile: ExecutionRuntimeBackendFile | null;
  maskFile?: ExecutionRuntimeBackendFile | null;
  renderFile: ExecutionRuntimeBackendFile | null;
  referenceFile: ExecutionRuntimeBackendFile | null;
  whiteModelFile: ExecutionRuntimeBackendFile | null;
  styleReferenceFile: ExecutionRuntimeBackendFile | null;
  resultFile: ExecutionRuntimeBackendFile | null;
}

export interface WorkflowTaskHistoryListResponse {
  items: WorkflowTaskHistoryBackendTaskItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WorkflowTaskHistoryDetailResponse extends WorkflowTaskHistoryBackendTaskItem {
  recentEvents: ExecutionRuntimeEvent[];
}

export interface WorkflowTaskHistoryEventsResponse {
  messageType: 'task_event';
  items: ExecutionRuntimeEvent[];
  total: number;
}

export interface TaskHistoryPreviewFile {
  fileId: string;
  fileInfo?: FileInfo;
  backendFile?: ExecutionRuntimeBackendFile | null;
  role:
    | 'input'
    | 'mask'
    | 'reference'
    | 'render'
    | 'style-reference'
    | 'white-model'
    | 'result'
    | 'artifact';
  label: string;
  order: number;
  isPrimary?: boolean;
}

export interface TaskHistoryDetailInputFileSummary {
  key: string;
  fileId: string;
  role: TaskHistoryPreviewFile['role'];
  label: string;
  fileName: string;
  fileType: FileInfo['fileType'] | 'unknown';
  mimeType: string | null;
  format: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface TaskHistoryListItem {
  taskId: string;
  taskNo: string;
  runId: string;
  runNo: string | null;
  workflowId: string | null;
  projectId: string | null;
  nodeId: string | null;
  nodeTitle: string | null;
  nodeType: string;
  taskType: string;
  groupId: string | null;
  groupOrder: number | null;
  status: ExecutionRuntimeStatus;
  currentStep: ExecutionRuntimeStep;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  provider?: string | null;
  model?: string | null;
  title?: string;
  subtitle?: string | null;
  message: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  latestEventAt?: number | null;
  isTerminal: boolean;
  isFailed: boolean;
  isCancelled: boolean;
  isSuccessful: boolean;
  artifactPreviewItems: TaskHistoryPreviewFile[];
  primaryArtifact: TaskHistoryPreviewFile | null;
  inputPreviewItems?: TaskHistoryPreviewFile[];
  recentEvents?: ExecutionRuntimeEvent[];
  relatedTaskRef?: WorkflowRelatedTaskRef;
  raw?: WorkflowTaskHistoryBackendTaskItem;
}

export interface TaskHistoryDetail extends TaskHistoryListItem {
  provider: string | null;
  model: string | null;
  title: string;
  subtitle: string | null;
  latestEventAt: number | null;
  inputPreviewItems: TaskHistoryPreviewFile[];
  recentEvents: ExecutionRuntimeEvent[];
  raw: WorkflowTaskHistoryBackendTaskItem;
  events: ExecutionRuntimeEvent[];
  eventCount: number;
  runDetail?: ExecutionRuntimeRunState;
  inputFileSummaries?: TaskHistoryDetailInputFileSummary[];
}
