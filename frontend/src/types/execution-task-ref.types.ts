import type { NodeType, TaskStatus, UUID } from './base.types';
import type { AITaskType } from './ai.types';
import type { TaskNo, TaskScope } from './task.types';

export interface ExecutionTaskNodeRef {
  nodeId: string;
  nodeDisplayId: string;
  nodeType: NodeType;
  nodeTitle?: string;
}

export interface ExecutionTaskRef {
  taskId: string;
  taskNo?: TaskNo | string;
  batchId?: string;
  runId?: string;
  runNo?: string;
  taskType?: AITaskType | string;
  projectId?: UUID;
  workflowId?: UUID;
  node: ExecutionTaskNodeRef;
  scope: TaskScope;
  groupId?: string;
  groupLabel?: string;
  groupOrder?: number;
  outputHandle?: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}
