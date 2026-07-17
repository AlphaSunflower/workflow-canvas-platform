import type { AITaskExecutionContext } from './ai.types';
import type { UUID } from './base.types';
import type {
  ExecutionRuntimeGroupState,
  ExecutionRuntimeNodeState,
  ExecutionRuntimeRunState,
  ExecutionRuntimeStatus,
  ExecutionRuntimeTaskState,
} from '@/execution-runtime/execution-runtime.types';

declare module './ai.types' {
  interface AITaskExecutionContext {
    nodeDisplayId?: string;
    taskRecordId?: UUID;
    taskNo?: string;
    batchId?: string;
    runId?: string;
    runNo?: string;
  }
}

export type ExtendedAITaskExecutionContext = AITaskExecutionContext;
export type AIExecutionRuntimeStatus = ExecutionRuntimeStatus;
export type AIExecutionRuntimeRunState = ExecutionRuntimeRunState;
export type AIExecutionRuntimeTaskState = ExecutionRuntimeTaskState;
export type AIExecutionRuntimeNodeState = ExecutionRuntimeNodeState;
export type AIExecutionRuntimeGroupState = ExecutionRuntimeGroupState;
