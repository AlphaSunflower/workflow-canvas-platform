import type { ExecutionRuntimeNodeOutputAdapter } from './node-execution-adapter.types';
import type {
  ExecutionRuntimeNodeExecutionOutput,
  ExecutionRuntimeGroupedNodeExecutionTarget,
  ExecutionRuntimeNodeExecutionRunContext,
} from './node-execution.types';
import type { ExecutionRuntimeRunState } from './execution-runtime.types';

export function createGroupedExecutionOutputAdapter<TRequest = unknown>(): ExecutionRuntimeNodeOutputAdapter<
  TRequest,
  ExecutionRuntimeGroupedNodeExecutionTarget
> {
  return {
    outputCommitMode: 'incremental',
    extractExecutionOutputs: (
      snapshot: ExecutionRuntimeRunState,
      context: ExecutionRuntimeNodeExecutionRunContext<TRequest, ExecutionRuntimeGroupedNodeExecutionTarget>,
    ): ExecutionRuntimeNodeExecutionOutput[] => {
      const targetByGroupId = new Map(
        context.payload.targets.map((target) => [target.groupId, target] as const),
      );

      return snapshot.tasks
        .filter((task) => task.status === 'completed' && task.resultFileId)
        .map((task) => {
          const target = targetByGroupId.get(task.groupId);
          if (!target || !target.outputHandle) {
            return null;
          }

          return {
            nodeId: context.payload.nodeId,
            runId: snapshot.runId,
            taskId: task.taskId,
            resultFileId: task.resultFileId as string,
            groupId: task.groupId,
            groupOrder: target.groupOrder,
            sourceHandle: target.outputHandle,
            resultFile: task.resultFileInfo ?? task.resultFile,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
    },
  };
}
