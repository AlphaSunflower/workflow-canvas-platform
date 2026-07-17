import type { QueueTaskExecutorInput } from "../../worker/src/modules/executors/queue-task-executor.types.ts";
import { createExecutionTaskRecord } from "./execution-store.fixture.ts";

export function createQueueTaskExecutorInput(
  overrides: Partial<QueueTaskExecutorInput> & {
    task?: Partial<QueueTaskExecutorInput["task"]> & { id: string };
  } = {},
): QueueTaskExecutorInput {
  const task = overrides.task
    ? createExecutionTaskRecord(overrides.task)
    : createExecutionTaskRecord({ id: "task-1" });

  return {
    runId: overrides.runId ?? task.runId,
    task,
  };
}
