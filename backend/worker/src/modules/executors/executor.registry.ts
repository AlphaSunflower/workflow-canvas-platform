import type {
  QueueTaskExecutor,
  QueueTaskExecutorInput,
} from "./queue-task-executor.types.ts";

export class QueueTaskExecutorRegistry implements QueueTaskExecutor {
  private readonly executorsByNodeType: Map<string, QueueTaskExecutor>;

  constructor(executors: QueueTaskExecutor[]) {
    this.executorsByNodeType = new Map(
      executors
        .flatMap((executor) => {
          const nodeTypes = (executor as { nodeTypes?: unknown }).nodeTypes;
          if (Array.isArray(nodeTypes)) {
            return nodeTypes
              .filter((nodeType): nodeType is string => typeof nodeType === "string")
              .map((nodeType) => [nodeType, executor] as const);
          }

          const nodeType = (executor as { nodeType?: unknown }).nodeType;
          return typeof nodeType === "string" ? [[nodeType, executor] as const] : [];
        })
        .filter(
          (entry): entry is readonly [string, QueueTaskExecutor] => entry !== null,
        ),
    );
  }

  async execute(input: QueueTaskExecutorInput): Promise<unknown> {
    const executor = this.executorsByNodeType.get(input.task.nodeType);

    if (!executor) {
      throw new Error(`UNSUPPORTED_NODE_TYPE:${input.task.nodeType}`);
    }

    return executor.execute(input);
  }
}
