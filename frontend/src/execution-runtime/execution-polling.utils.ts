import {
  diffExecutionRuntimeRunState,
  diffExecutionRuntimeTaskState,
  isTerminalExecutionStatus,
} from './execution-runtime.diff';
import type { ExecutionPollingSnapshotContext } from './execution-polling.types';
import type {
  ExecutionRuntimePatch,
  ExecutionRuntimeRunState,
} from './execution-runtime.types';

function withSnapshotContext(
  snapshot: ExecutionRuntimeRunState,
  context: ExecutionPollingSnapshotContext,
): ExecutionRuntimeRunState {
  return {
    ...snapshot,
    workflowId: context.workflowId ?? snapshot.workflowId ?? null,
    nodeId: context.nodeId ?? snapshot.nodeId ?? null,
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      nodeId: context.nodeId ?? task.nodeId ?? snapshot.nodeId ?? null,
    })),
  };
}

function preserveCommittedTaskState(
  previousTask: ExecutionRuntimeRunState['tasks'][number] | undefined,
  nextTask: ExecutionRuntimeRunState['tasks'][number],
): ExecutionRuntimeRunState['tasks'][number] {
  if (previousTask?.resultCommitStatus !== 'committed') {
    return nextTask;
  }

  return {
    ...nextTask,
    resultCommitStatus: 'committed',
    resultCommittedAt: previousTask.resultCommittedAt ?? nextTask.resultCommittedAt ?? null,
    resultCommitError: previousTask.resultCommitError ?? null,
    isOutputCommitted: true,
  };
}

export function normalizeExecutionRunSnapshot(
  snapshot: ExecutionRuntimeRunState,
  context: ExecutionPollingSnapshotContext = {},
  previousSnapshot?: ExecutionRuntimeRunState | null,
): ExecutionRuntimeRunState {
  const contextualized = withSnapshotContext(snapshot, context);

  if (!previousSnapshot) {
    return contextualized;
  }

  const previousTaskMap = new Map(previousSnapshot.tasks.map((task) => [task.taskId, task] as const));
  const tasks = contextualized.tasks.map((task) => preserveCommittedTaskState(previousTaskMap.get(task.taskId), task));
  const readyTasks = tasks.filter((task) => task.canCommitOutput);
  const committedReadyTaskCount = readyTasks.filter((task) => task.isOutputCommitted || task.resultCommitStatus === 'committed').length;

  return {
    ...contextualized,
    tasks,
    allOutputsCommitted: readyTasks.length > 0
      ? committedReadyTaskCount === readyTasks.length
      : contextualized.allOutputsCommitted,
  };
}

export function isExecutionRunSnapshotTerminal(snapshot: ExecutionRuntimeRunState): boolean {
  return isTerminalExecutionStatus(snapshot.status);
}

export function buildExecutionRuntimePatchesFromSnapshot(
  previousSnapshot: ExecutionRuntimeRunState | null | undefined,
  snapshot: ExecutionRuntimeRunState,
  context: ExecutionPollingSnapshotContext = {},
): ExecutionRuntimePatch[] {
  const nextRun = normalizeExecutionRunSnapshot(snapshot, context, previousSnapshot);
  const patches: ExecutionRuntimePatch[] = [];

  const runDiff = diffExecutionRuntimeRunState(previousSnapshot, nextRun, {
    runtimeKey: nextRun.runId,
  });
  patches.push(...runDiff.patches);

  if (!nextRun.nodeId) {
    return patches;
  }

  nextRun.tasks.forEach((task) => {
    const previousTask = previousSnapshot?.tasks.find((item) => item.taskId === task.taskId);
    const taskDiff = diffExecutionRuntimeTaskState(previousTask, task, {
      runtimeKey: task.taskId,
    });
    patches.push(...taskDiff.patches);
  });

  return patches;
}

export function mergeAbortSignals(...signals: Array<AbortSignal | null | undefined>): AbortSignal {
  const controller = new AbortController();

  const onAbort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  signals.forEach((signal) => {
    if (!signal) {
      return;
    }

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });

  return controller.signal;
}

export async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timerId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const cleanup = (): void => {
      window.clearTimeout(timerId);
      signal?.removeEventListener('abort', onAbort);
    };

    if (signal?.aborted) {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
