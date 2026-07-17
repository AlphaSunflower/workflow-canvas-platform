import test from 'node:test';
import assert from 'node:assert/strict';
import { performanceTracker } from '@/utils/performance/PerformanceTracker';
import { backendExecutionService } from '@/services/backendExecutionService';
import { createExecutionPollingManager } from './execution-polling-manager';
import { createExecutionRuntimeStore } from './execution-runtime.store';
import type {
  ExecutionRuntimeRunState,
  ExecutionRuntimeTaskState,
} from './execution-runtime.types';

performanceTracker.destroy();

function createTask(
  overrides: Partial<ExecutionRuntimeTaskState> = {},
): ExecutionRuntimeTaskState {
  return {
    taskId: overrides.taskId ?? 'task-1',
    taskNo: overrides.taskNo ?? 'TASK-1',
    runId: overrides.runId ?? 'run-1',
    runNo: overrides.runNo ?? 'RUN-1',
    nodeId: overrides.nodeId ?? 'node-1',
    nodeType: overrides.nodeType ?? 'aiModelRenderTransfer',
    groupId: overrides.groupId ?? 'group-1',
    groupOrder: overrides.groupOrder ?? 0,
    status: overrides.status ?? 'queued',
    currentStep: overrides.currentStep ?? null,
    currentAttemptNo: overrides.currentAttemptNo ?? 0,
    retryCount: overrides.retryCount ?? 0,
    maxRetries: overrides.maxRetries ?? 2,
    maxAttempts: overrides.maxAttempts ?? 3,
    progress: overrides.progress ?? 0,
    message: overrides.message ?? '排队中',
    output: overrides.output,
    error: overrides.error ?? null,
    errorCode: overrides.errorCode ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    resultFileId: overrides.resultFileId ?? null,
    resultFile: overrides.resultFile,
    resultFileInfo: overrides.resultFileInfo,
    resultCommitStatus: overrides.resultCommitStatus ?? 'idle',
    resultCommittedAt: overrides.resultCommittedAt ?? null,
    resultCommitError: overrides.resultCommitError ?? null,
    canCommitOutput: overrides.canCommitOutput ?? false,
    isTerminal: overrides.isTerminal ?? false,
    isOutputCommitted: overrides.isOutputCommitted ?? false,
  };
}

function createRun(
  overrides: Partial<ExecutionRuntimeRunState> = {},
): ExecutionRuntimeRunState {
  const runId = overrides.runId ?? 'run-1';
  const runNo = overrides.runNo ?? 'RUN-1';
  const tasks = overrides.tasks ?? [
    createTask({
      runId,
      runNo,
      nodeId: overrides.nodeId ?? 'node-1',
    }),
  ];

  return {
    runId,
    runNo,
    workflowId: overrides.workflowId ?? 'workflow-1',
    nodeId: overrides.nodeId ?? 'node-1',
    nodeType: overrides.nodeType ?? 'aiModelRenderTransfer',
    status: overrides.status ?? 'queued',
    totalTaskCount: overrides.totalTaskCount ?? tasks.length,
    completedTaskCount: overrides.completedTaskCount ?? tasks.filter((task) => task.status === 'completed').length,
    failedTaskCount: overrides.failedTaskCount ?? tasks.filter((task) => task.status === 'failed').length,
    progress: overrides.progress ?? 0,
    message: overrides.message ?? '排队中',
    createdAt: overrides.createdAt ?? 1,
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    isTerminal: overrides.isTerminal ?? false,
    hasCommittableOutput: overrides.hasCommittableOutput ?? tasks.some((task) => task.canCommitOutput),
    allOutputsCommitted: overrides.allOutputsCommitted ?? false,
    tasks,
  };
}

test('ExecutionPollingManager 同一 runId 不会重复启动轮询任务', async () => {
  const store = createExecutionRuntimeStore();
  const manager = createExecutionPollingManager({
    store,
    defaultIntervalMs: 1,
  });

  const originalGetExecutionRun = backendExecutionService.getExecutionRun;
  let requestCount = 0;

  backendExecutionService.getExecutionRun = async () => {
    requestCount += 1;
    return createRun({
      status: 'completed',
      progress: 100,
      message: '完成',
      isTerminal: true,
      tasks: [
        createTask({
          taskId: 'task-1',
          status: 'completed',
          progress: 100,
          message: '完成',
          isTerminal: true,
        }),
      ],
    });
  };

  try {
    const handle1 = manager.start({
      runId: 'run-1',
      workflowId: 'workflow-1',
      nodeId: 'node-1',
    });
    const handle2 = manager.start({
      runId: 'run-1',
      workflowId: 'workflow-1',
      nodeId: 'node-1',
    });

    assert.strictEqual(handle1, handle2);
    assert.equal(manager.hasTask('run-1'), true);

    const result = await handle1.promise;

    assert.equal(requestCount, 1);
    assert.equal(result.status, 'completed');
    assert.equal(manager.hasTask('run-1'), false);
  } finally {
    backendExecutionService.getExecutionRun = originalGetExecutionRun;
  }
});

test('ExecutionPollingManager 终态自动停止并写入 store', async () => {
  const store = createExecutionRuntimeStore();
  const manager = createExecutionPollingManager({
    store,
    defaultIntervalMs: 1,
  });

  const originalGetExecutionRun = backendExecutionService.getExecutionRun;
  let stopReason: 'manual' | 'aborted' | 'completed' | 'failed' | null = null;

  backendExecutionService.getExecutionRun = async () => createRun({
    status: 'completed',
    progress: 100,
    message: '执行完成',
    isTerminal: true,
    tasks: [
      createTask({
        taskId: 'task-1',
        status: 'completed',
        progress: 100,
        message: '执行完成',
        resultFileId: 'result-1',
        canCommitOutput: true,
        isTerminal: true,
      }),
    ],
  });

  try {
    const handle = manager.start({
      runId: 'run-1',
      workflowId: 'workflow-1',
      nodeId: 'node-1',
      onStopped: (reason) => {
        stopReason = reason;
      },
    });

    const snapshot = await handle.promise;

    assert.equal(snapshot.status, 'completed');
    assert.equal(stopReason, 'completed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(store.getTask('task-1')?.status, 'completed');
  } finally {
    backendExecutionService.getExecutionRun = originalGetExecutionRun;
  }
});

test('ExecutionPollingManager stop 会触发 abort 并结束轮询', async () => {
  const store = createExecutionRuntimeStore();
  const manager = createExecutionPollingManager({
    store,
    defaultIntervalMs: 20,
  });

  const originalGetExecutionRun = backendExecutionService.getExecutionRun;
  let requestCount = 0;
  let stopReason: 'manual' | 'aborted' | 'completed' | 'failed' | null = null;

  backendExecutionService.getExecutionRun = async (_runId, signal) => {
    requestCount += 1;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 5);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });

    return createRun({
      status: 'processing',
      progress: 50,
      message: '处理中',
      tasks: [
        createTask({
          status: 'processing',
          progress: 50,
          message: '处理中',
        }),
      ],
    });
  };

  try {
    const handle = manager.start({
      runId: 'run-1',
      workflowId: 'workflow-1',
      nodeId: 'node-1',
      onStopped: (reason) => {
        stopReason = reason;
      },
    });

    manager.stop('run-1');

    await assert.rejects(handle.promise, (error) => {
      return error instanceof DOMException && error.name === 'AbortError';
    });

    assert.equal(requestCount, 1);
    assert.equal(stopReason, 'aborted');
    assert.equal(handle.state.status, 'cancelled');
  } finally {
    backendExecutionService.getExecutionRun = originalGetExecutionRun;
  }
});

test('ExecutionPollingManager 优先使用适配器自定义 patch 映射', async () => {
  const store = createExecutionRuntimeStore();
  const manager = createExecutionPollingManager({
    store,
    defaultIntervalMs: 1,
  });

  const originalGetExecutionRun = backendExecutionService.getExecutionRun;
  let customPatchCalls = 0;

  backendExecutionService.getExecutionRun = async () => createRun({
    status: 'completed',
    progress: 100,
    message: '后端原始文案',
    isTerminal: true,
    tasks: [
      createTask({
        taskId: 'task-1',
        status: 'completed',
        progress: 100,
        message: '后端原始文案',
        isTerminal: true,
      }),
    ],
  });

  try {
    const handle = manager.start({
      runId: 'run-1',
      workflowId: 'workflow-1',
      nodeId: 'node-1',
      mapSnapshotToPatches: (snapshot) => {
        customPatchCalls += 1;
        return [
          {
            kind: 'run',
            runId: snapshot.runId,
            next: {
              message: '适配器映射文案',
            },
          },
          {
            kind: 'task',
            runId: snapshot.runId,
            taskId: snapshot.tasks[0]?.taskId ?? 'task-1',
            next: {
              message: '适配器任务文案',
            },
          },
        ];
      },
    });

    await handle.promise;

    assert.equal(customPatchCalls, 1);
    assert.equal(store.getRun('run-1')?.message, '后端原始文案');
    assert.equal(store.getTask('task-1')?.message, '后端原始文案');
  } finally {
    backendExecutionService.getExecutionRun = originalGetExecutionRun;
  }
});
