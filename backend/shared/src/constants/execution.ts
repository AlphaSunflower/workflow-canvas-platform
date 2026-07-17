export const NODE_TASK_TYPES = {
  whiteModelRenderTransfer: "model-render-transfer",
  aiImageGen: "image-gen",
  aiImageInpaint: "image-inpaint",
  aiImageHd: "image-hd",
  aiFloorplanColorize: "floorplan-colorize",
  aiMultiViewRestore: "multi-view-restore",
  aiImageToPly: "image-to-ply",
  aiVideoGen: "video-gen",
} as const;

export const EXECUTION_MODES = {
  legacyGroupedTask: "legacy-grouped-task",
} as const;

export const EXECUTION_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export const TASK_ATTEMPT_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export const EXECUTION_STEP_TYPES = [
  "lineart",
  "depth",
  "final",
] as const;

export const EXECUTION_PHASES = [
  "queued",
  "processing",
  "retrying",
  "completed",
  "failed",
  "cancelled",
] as const;

export const TASK_EVENT_TYPES = [
  "task_queued",
  "task_started",
  "task_progress",
  "task_retry_scheduled",
  "task_retry_started",
  "task_retry_progress",
  "task_artifact_received",
  "task_completed",
  "task_failed",
  "task_cancelled",
  "step_lineart_started",
  "step_lineart_completed",
  "step_depth_started",
  "step_depth_completed",
  "step_final_started",
  "step_final_completed",
  "step_cache_hit",
  "step_cache_miss",
] as const;

export const RETRY_LIMITS = {
  maxRetries: 2,
  maxAttempts: 3,
} as const;
