import type { ExecutionError } from "@newworkflow/backend-shared";

export interface RunningHubFileUploadInput {
  fileName: string;
  mimeType: string;
  fileBuffer: Buffer;
  timeoutMs?: number;
  snapshotLabel?: string;
}

export interface RunningHubWorkflowNodeInfoItem {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
}

export interface RunningHubCreateTaskInput {
  workflowId: string;
  nodeInfoList: RunningHubWorkflowNodeInfoItem[];
  timeoutMs?: number;
  snapshotLabel?: string;
}

export interface RunningHubQueryTaskInput {
  taskId: string;
  timeoutMs?: number;
  snapshotLabel?: string;
}

export interface RunningHubUploadedFileResult {
  fileName: string;
  rawResponse: unknown;
  responseText: string;
  snapshotPath: string;
}

export interface RunningHubPromptTipsSummary {
  result?: boolean | null;
  error?: string | null;
  outputsToExecute?: string[];
  nodeErrors?: Record<string, unknown>;
  parseStatus?: "parsed" | "invalid_json";
  rawText?: string | null;
  raw?: unknown;
}

export interface RunningHubCreateTaskResult {
  taskId: string;
  taskStatus: string;
  clientId: string | null;
  promptTips: string | null;
  promptTipsSummary: RunningHubPromptTipsSummary | null;
  rawResponse: unknown;
  responseText: string;
  snapshotPath: string;
}

export interface RunningHubTaskStatusResult {
  taskId: string;
  taskStatus: string | null;
  clientId: string | null;
  progress: number | null;
  rawResponse: unknown;
  responseText: string;
  snapshotPath: string;
}

export interface RunningHubResultFileItem {
  fileUrl: string;
  fileType: string;
  nodeId: string | null;
  taskCostTime: number | null;
}

export interface RunningHubQueryTaskResult {
  taskId: string | null;
  taskStatus: string | null;
  clientId: string | null;
  promptTips: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  results: RunningHubResultFileItem[];
  rawResponse: unknown;
  responseText: string;
  snapshotPath: string;
}

export interface RunningHubErrorResult {
  error: ExecutionError;
  responseText?: string;
  snapshotPath?: string;
}
