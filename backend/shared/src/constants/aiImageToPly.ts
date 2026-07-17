export const AI_IMAGE_TO_PLY_NODE_TYPE = "aiImageToPly" as const;
export const AI_IMAGE_TO_PLY_TASK_TYPE = "image-to-ply" as const;
export const AI_IMAGE_TO_PLY_EXECUTION_MODE = "legacy-grouped-task" as const;

export const AI_IMAGE_TO_PLY_PROVIDER = "runninghub" as const;
export const AI_IMAGE_TO_PLY_WORKFLOW_ID = "2014519004714508290" as const;
export const AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY =
  "sharp-image-to-ply-v1" as const;

export const AI_IMAGE_TO_PLY_INPUT_NODE_ID = "1" as const;
export const AI_IMAGE_TO_PLY_INPUT_FIELD_NAME = "image" as const;
export const AI_IMAGE_TO_PLY_OUTPUT_FILE_TYPE = "ply" as const;

export interface AIImageToPlyExecutionGroupInput {
  groupId: string;
  sourceFileId: string;
}

export interface RunningHubCreateTaskResponseData {
  netWssUrl: string | null;
  taskId: string;
  clientId: string;
  taskStatus: string;
  promptTips: string;
}

export interface RunningHubQueryTaskResultItem {
  fileUrl: string;
  fileType: string;
  taskCostTime?: number;
  nodeId?: string;
}

export interface RunningHubQueryTaskResultData {
  taskId?: string;
  taskStatus?: string;
  outputs?: RunningHubQueryTaskResultItem[];
  files?: RunningHubQueryTaskResultItem[];
}
