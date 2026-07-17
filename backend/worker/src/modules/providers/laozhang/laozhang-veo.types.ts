import type {
  AIVideoGenSupportedAspectRatio,
  AIVideoGenSupportedModel,
  AIVideoGenSupportedResolution,
  AIVideoGenSupportedSize,
  ExecutionError,
} from "@newworkflow/backend-shared";

export type LaozhangVeoVideoStatus =
  | "queued"
  | "in_progress"
  | "processing"
  | "completed"
  | "failed"
  | string;

export interface LaozhangVeoImageReferenceInput {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface LaozhangVeoCreateVideoInput {
  prompt: string;
  model: AIVideoGenSupportedModel;
  duration?: number;
  aspectRatio?: AIVideoGenSupportedAspectRatio;
  resolution?: AIVideoGenSupportedResolution;
  size?: AIVideoGenSupportedSize;
  metadata?: string;
  inputReferences?: LaozhangVeoImageReferenceInput[];
  timeoutMs?: number;
  snapshotLabel?: string;
}

export interface LaozhangVeoQueryVideoInput {
  videoId: string;
  timeoutMs?: number;
  snapshotLabel?: string;
}

export interface LaozhangVeoDownloadVideoInput {
  url: string;
  timeoutMs?: number;
  snapshotLabel?: string;
}

export interface LaozhangVeoCreateVideoResult {
  id: string;
  object: string | null;
  created: number | null;
  createdAt: number | null;
  status: LaozhangVeoVideoStatus;
  progress: number | null;
  model: string | null;
  rawResponse: unknown;
  responseText: string;
  snapshotPath: string;
}

export interface LaozhangVeoTaskStatusResult {
  id: string;
  object: string | null;
  created: number | null;
  createdAt: number | null;
  completedAt: number | null;
  status: LaozhangVeoVideoStatus;
  progress: number | null;
  model: string | null;
  prompt: string | null;
  videoUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  rawResponse: unknown;
  responseText: string;
  snapshotPath: string;
}

export interface LaozhangVeoContentResult {
  id: string;
  object: string | null;
  created: number | null;
  createdAt: number | null;
  completedAt: number | null;
  status: LaozhangVeoVideoStatus;
  progress: number | null;
  model: string | null;
  prompt: string | null;
  url: string | null;
  videoUrl: string | null;
  duration: number | null;
  resolution: string | null;
  rawResponse: unknown;
  responseText: string;
  snapshotPath: string;
  video?: LaozhangVeoDownloadedVideoResult;
}

export interface LaozhangVeoDownloadedVideoResult {
  buffer: Buffer;
  mimeType: string;
  size: number;
  snapshotPath: string;
}

export interface LaozhangVeoErrorResult {
  error: ExecutionError;
  responseText?: string;
  snapshotPath?: string;
}
