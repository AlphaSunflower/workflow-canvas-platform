import type { ExecutionCreateCommand } from "./executions.contracts.ts";
import {
  buildCreateExecutionStoreInput,
  collectExecutionInputFileIds,
} from "./execution-node.registry.ts";
import type { CreateExecutionStoreInput } from "./executions.repository.ts";

export interface ExecutionStoreContext {
  userId: string;
  workflowId: string;
  projectId: string;
}

export class ExecutionStoreInputBuilder {
  collectFileIds(input: ExecutionCreateCommand): string[] {
    return [...new Set(collectExecutionInputFileIds(input))];
  }

  build(
    input: ExecutionCreateCommand,
    context?: ExecutionStoreContext,
  ): CreateExecutionStoreInput {
    const storeInput = buildCreateExecutionStoreInput(
      context
        ? {
            ...input,
            userId: context.userId,
            workflowId: context.workflowId,
          }
        : input,
    );

    if (!context) {
      return storeInput;
    }

    storeInput.run.workflowId = context.workflowId;
    storeInput.run.projectId = context.projectId;
    storeInput.run.nodeId = storeInput.run.nodeId ?? input.nodeId ?? null;
    storeInput.run.nodeTitle = storeInput.run.nodeTitle ?? input.nodeTitle ?? null;

    storeInput.tasks = storeInput.tasks.map((task) => ({
      ...task,
      workflowId: context.workflowId,
      projectId: context.projectId,
      nodeId: task.nodeId ?? input.nodeId ?? null,
      nodeTitle: task.nodeTitle ?? input.nodeTitle ?? null,
    }));

    return storeInput;
  }
}
