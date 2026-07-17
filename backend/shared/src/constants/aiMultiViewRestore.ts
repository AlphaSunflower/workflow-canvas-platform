export const AI_MULTI_VIEW_RESTORE_NODE_TYPE = "aiMultiViewRestore" as const;
export const AI_MULTI_VIEW_RESTORE_TASK_TYPE = "multi-view-restore" as const;
export const AI_MULTI_VIEW_RESTORE_EXECUTION_MODE = "legacy-grouped-task" as const;

export const AI_MULTI_VIEW_RESTORE_PROVIDER = "runninghub" as const;
export const AI_MULTI_VIEW_RESTORE_WORKFLOW_ID = "2014516111097729025" as const;
export const AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY =
  "multi-view-restore-v1" as const;

export const AI_MULTI_VIEW_RESTORE_RENDER_INPUT_NODE_ID = "124" as const;
export const AI_MULTI_VIEW_RESTORE_RENDER_INPUT_FIELD_NAME = "image" as const;
export const AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_NODE_ID = "102" as const;
export const AI_MULTI_VIEW_RESTORE_REFERENCE_INPUT_FIELD_NAME = "image" as const;
export const AI_MULTI_VIEW_RESTORE_OUTPUT_NODE_ID = "127" as const;
export const AI_MULTI_VIEW_RESTORE_OUTPUT_FILE_TYPE = "image" as const;

export interface AIMultiViewRestoreExecutionGroupInput {
  groupId: string;
  renderFileId: string;
  referenceFileId: string;
}
