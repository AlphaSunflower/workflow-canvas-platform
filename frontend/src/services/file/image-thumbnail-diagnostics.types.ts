export type ImageThumbnailFailureCode =
  | 'worker-unavailable'
  | 'worker-timeout'
  | 'worker-crashed'
  | 'worker-message-failure'
  | 'bitmap-unsupported'
  | 'offscreen-unsupported'
  | 'decode-failed'
  | 'canvas-context-failed'
  | 'blob-convert-failed'
  | 'unknown';

export type ImageThumbnailFailureStage =
  | 'pipeline-gate'
  | 'queue-wait'
  | 'worker-execute'
  | 'result-apply';

export interface ImageThumbnailFailureEnvironment {
  hasWorker?: boolean;
  hasCreateImageBitmap?: boolean;
  hasOffscreenCanvas?: boolean;
}

export interface ImageThumbnailFailureDetail {
  failureCode: ImageThumbnailFailureCode;
  failureStage: ImageThumbnailFailureStage;
  retryable: boolean;
  message?: string;
  durationMs?: number;
  queueWaitMs?: number;
  executeMs?: number;
  timeoutMs?: number;
  environment?: ImageThumbnailFailureEnvironment;
}
