import type {
  QueueTaskExecutor,
  QueueTaskExecutorInput,
} from "./queue-task-executor.types.ts";

export class QueueTaskExecutorRegistry implements QueueTaskExecutor {
  private readonly executors: Map<string, QueueTaskExecutor>;

  constructor(executorList: QueueTaskExecutor[]) {
    this.executors = new Map();

    for (const executor of executorList) {
      const nodeTypes = (executor as { nodeTypes?: unknown }).nodeTypes;
      const taskTypes = (executor as { taskTypes?: unknown }).taskTypes;

      if (Array.isArray(nodeTypes)) {
        for (const nodeType of nodeTypes) {
          if (typeof nodeType !== "string") {
            continue;
          }

          if (Array.isArray(taskTypes)) {
            for (const taskType of taskTypes) {
              if (typeof taskType === "string") {
                this.executors.set(`${nodeType}:${taskType}`, executor);
              }
            }
          }

          this.executors.set(nodeType, executor);
        }
      } else {
        const nodeType = (executor as { nodeType?: unknown }).nodeType;
        if (typeof nodeType === "string") {
          this.executors.set(nodeType, executor);
        }
      }
    }
  }

  async execute(input: QueueTaskExecutorInput): Promise<unknown> {
    const taskType = (input.task as { taskType?: string }).taskType;
    const compositeKey = taskType
      ? `${input.task.nodeType}:${taskType}`
      : undefined;

    const executor = (compositeKey ? this.executors.get(compositeKey) : undefined)
      ?? this.executors.get(input.task.nodeType);

    if (!executor) {
      throw new Error(`UNSUPPORTED_NODE_TYPE:${input.task.nodeType}`);
    }

    return executor.execute(input);
  }
}
