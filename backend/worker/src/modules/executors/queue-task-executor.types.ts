import type { ExecutionTaskRecord } from "../../../../api/src/modules/executions/executions.repository.ts";

export interface QueueTaskExecutorInput {
  runId: string;
  task: ExecutionTaskRecord;
}

export interface QueueTaskExecutor {
  execute(input: QueueTaskExecutorInput): Promise<unknown>;
}
