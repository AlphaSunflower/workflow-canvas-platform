import type { TaskNo } from './task.types';
import type { AITaskType } from './ai.types';

export interface WorkflowRelatedTaskRef {
  taskId: string;
  taskNo?: TaskNo | string;
  batchId?: string;
  runId?: string;
  runNo?: string;
  taskType?: AITaskType | string;
  nodeId: string;
  nodeDisplayId: string;
  nodeType: string;
  groupId?: string;
  groupLabel?: string;
  groupOrder?: number;
  outputHandle?: string;
  createdAt?: number;
}
