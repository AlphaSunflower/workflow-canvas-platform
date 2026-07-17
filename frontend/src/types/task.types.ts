import type { ExecutionTaskRef } from './execution-task-ref.types';

export type TaskScope = 'node' | 'group';
export type TaskNo = `TASK-${string}`;

export interface TaskFileRef {
  fileId: string;
  fileName?: string;
  mimeType?: string;
}

export type NodeTaskRef = Omit<ExecutionTaskRef, 'node'>;
