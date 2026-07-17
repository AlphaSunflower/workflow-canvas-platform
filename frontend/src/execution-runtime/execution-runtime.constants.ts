export const EXECUTION_RUNTIME_PHASES = [
  'queued',
  'processing',
  'retrying',
  'completed',
  'failed',
  'cancelled',
] as const;

export const EXECUTION_RUNTIME_STATUSES = [
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;

export const EXECUTION_RUNTIME_GROUP_STATUSES = [
  ...EXECUTION_RUNTIME_STATUSES,
  'skipped',
] as const;

export const EXECUTION_RUNTIME_STEP_TYPES = [
  'lineart',
  'depth',
  'final',
] as const;

export const EXECUTION_RUNTIME_EVENT_TYPES = [
  'task_queued',
  'task_started',
  'task_progress',
  'task_retry_scheduled',
  'task_retry_started',
  'task_retry_progress',
  'task_artifact_received',
  'task_completed',
  'task_failed',
  'task_cancelled',
  'step_lineart_started',
  'step_lineart_completed',
  'step_depth_started',
  'step_depth_completed',
  'step_final_started',
  'step_final_completed',
  'step_cache_hit',
  'step_cache_miss',
] as const;

export const EXECUTION_RUNTIME_LAYOUT_AFFECTING_FIELDS = [
  'resultFileId',
  'resultCommittedAt',
  'resultCommitStatus',
  'resultOutputCount',
] as const;

export const EXECUTION_RUNTIME_VISUAL_ONLY_FIELDS = [
  'status',
  'progress',
  'message',
  'currentStep',
  'currentAttemptNo',
  'retryCount',
  'lastErrorCode',
  'error',
] as const;

export const EXECUTION_RUNTIME_RESULT_COMMIT_STATUSES = [
  'idle',
  'ready',
  'committing',
  'committed',
  'failed',
] as const;

export const EXECUTION_RUNTIME_TERMINAL_STATUSES = [
  'completed',
  'failed',
  'cancelled',
] as const;

export const EXECUTION_RUNTIME_TERMINAL_GROUP_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'skipped',
] as const;
