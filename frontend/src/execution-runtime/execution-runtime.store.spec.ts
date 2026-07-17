import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExecutionRuntimeStore,
  getExecutionRuntimeGroupKey,
  getExecutionRuntimeNodeKey,
} from './execution-runtime.store';
import type {
  ExecutionRuntimeRunState,
  ExecutionRuntimeTaskState,
} from './execution-runtime.types';

function createTask(
  overrides: Partial<ExecutionRuntimeTaskState> = {},
): ExecutionRuntimeTaskState {
  const taskId = overrides.taskId ?? 'task-1';
  const runId = overrides.runId ?? 'run-1';
  const runNo = overrides.runNo ?? 'RUN-1';
  const groupId = overrides.groupId ?? 'group-1';

  return {
    taskId,
    taskNo: overrides.taskNo ?? `TASK-${taskId}`,
    runId,
    runNo,
    nodeId: overrides.nodeId ?? 'node-1',
    nodeType: overrides.nodeType ?? 'aiModelRenderTransfer',
    groupId,
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
  const tasks = overrides.tasks ?? [createTask({
    runId,
    runNo,
    nodeId: overrides.nodeId ?? 'node-1',
    nodeType: overrides.nodeType ?? 'aiModelRenderTransfer',
  })];

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

test('ExecutionRuntimeStore 只通知命中的 node/group 订阅者', () => {
  const store = createExecutionRuntimeStore();
  const run1 = createRun({
    workflowId: 'workflow-1',
    runId: 'run-1',
    nodeId: 'node-1',
    tasks: [
      createTask({
        taskId: 'task-1',
        runId: 'run-1',
        runNo: 'RUN-1',
        nodeId: 'node-1',
        groupId: 'group-1',
      }),
    ],
  });
  const run2 = createRun({
    workflowId: 'workflow-2',
    runId: 'run-2',
    runNo: 'RUN-2',
    nodeId: 'node-2',
    tasks: [
      createTask({
        taskId: 'task-2',
        runId: 'run-2',
        runNo: 'RUN-2',
        nodeId: 'node-2',
        groupId: 'group-2',
      }),
    ],
  });

  store.applyRunSnapshot(run1);
  store.applyRunSnapshot(run2);

  let node1Hits = 0;
  let group1Hits = 0;
  let node2Hits = 0;
  let group2Hits = 0;

  store.subscribeNode('node-1', 'workflow-1', () => {
    node1Hits += 1;
  });
  store.subscribeGroup('node-1', 'group-1', 'workflow-1', () => {
    group1Hits += 1;
  });
  store.subscribeNode('node-2', 'workflow-2', () => {
    node2Hits += 1;
  });
  store.subscribeGroup('node-2', 'group-2', 'workflow-2', () => {
    group2Hits += 1;
  });

  const changed = store.applyPatches([
    {
      kind: 'group',
      nodeId: 'node-1',
      groupId: 'group-1',
      next: {
        status: 'processing',
        progress: 48,
        message: '处理中',
      },
    },
  ], {
    workflowId: 'workflow-1',
    nodeId: 'node-1',
  });

  assert.equal(changed, true);
  assert.equal(node1Hits, 1);
  assert.equal(group1Hits, 1);
  assert.equal(node2Hits, 0);
  assert.equal(group2Hits, 0);
  assert.equal(
    store.getGroup('node-1', 'group-1', 'workflow-1')?.status,
    'processing',
  );
});

test('ExecutionRuntimeStore 相同 patch 不重复通知订阅者', () => {
  const store = createExecutionRuntimeStore();
  const run = createRun({
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    tasks: [
      createTask({
        taskId: 'task-1',
        runId: 'run-1',
        runNo: 'RUN-1',
        nodeId: 'node-1',
        groupId: 'group-1',
        status: 'processing',
        progress: 32,
        message: '处理中',
      }),
    ],
    status: 'processing',
    progress: 32,
    message: '处理中',
  });

  store.applyRunSnapshot(run);

  let groupHits = 0;
  let nodeHits = 0;
  store.subscribeGroup('node-1', 'group-1', 'workflow-1', () => {
    groupHits += 1;
  });
  store.subscribeNode('node-1', 'workflow-1', () => {
    nodeHits += 1;
  });

  const firstChanged = store.applyPatches([
    {
      kind: 'group',
      nodeId: 'node-1',
      groupId: 'group-1',
      next: {
        status: 'processing',
        progress: 60,
        message: '处理中',
      },
    },
  ], {
    workflowId: 'workflow-1',
    nodeId: 'node-1',
  });

  const secondChanged = store.applyPatches([
    {
      kind: 'group',
      nodeId: 'node-1',
      groupId: 'group-1',
      next: {
        status: 'processing',
        progress: 60,
        message: '处理中',
      },
    },
  ], {
    workflowId: 'workflow-1',
    nodeId: 'node-1',
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(groupHits, 1);
  assert.equal(nodeHits, 1);
});

test('ExecutionRuntimeStore reset(workflowId) 只清理对应画布运行态', () => {
  const store = createExecutionRuntimeStore();
  const workflow1Run = createRun({
    workflowId: 'workflow-1',
    runId: 'run-1',
    nodeId: 'node-1',
    tasks: [
      createTask({
        taskId: 'task-1',
        runId: 'run-1',
        runNo: 'RUN-1',
        nodeId: 'node-1',
        groupId: 'group-1',
      }),
    ],
  });
  const workflow2Run = createRun({
    workflowId: 'workflow-2',
    runId: 'run-2',
    runNo: 'RUN-2',
    nodeId: 'node-2',
    tasks: [
      createTask({
        taskId: 'task-2',
        runId: 'run-2',
        runNo: 'RUN-2',
        nodeId: 'node-2',
        groupId: 'group-2',
      }),
    ],
  });

  store.applyRunSnapshot(workflow1Run);
  store.applyRunSnapshot(workflow2Run);

  store.reset({ workflowId: 'workflow-1' });

  assert.equal(store.getRun('run-1'), null);
  assert.equal(store.getTask('task-1'), null);
  assert.equal(
    store.getNode('node-1', 'workflow-1'),
    null,
  );
  assert.equal(
    store.getGroup('node-1', 'group-1', 'workflow-1'),
    null,
  );

  assert.ok(store.getRun('run-2'));
  assert.ok(store.getTask('task-2'));
  assert.ok(store.getNode('node-2', 'workflow-2'));
  assert.ok(store.getGroup('node-2', 'group-2', 'workflow-2'));

  assert.equal(
    getExecutionRuntimeNodeKey('node-2', 'workflow-2'),
    'workflow-2::node-2',
  );
  assert.equal(
    getExecutionRuntimeGroupKey('node-2', 'group-2', 'workflow-2'),
    'workflow-2::node-2::group-2',
  );
});

test('ExecutionRuntimeStore subscribeAll notifies on active-to-terminal transitions', () => {
  const store = createExecutionRuntimeStore();
  const run = createRun({
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    status: 'processing',
    progress: 30,
    isTerminal: false,
    tasks: [
      createTask({
        taskId: 'task-1',
        runId: 'run-1',
        runNo: 'RUN-1',
        nodeId: 'node-1',
        groupId: 'group-1',
        status: 'processing',
        progress: 30,
        isTerminal: false,
      }),
    ],
  });

  let hits = 0;
  store.subscribeAll(() => {
    hits += 1;
  });

  const initialResult = store.applyRunSnapshot(run);
  const completedChanged = store.applyPatches([
    {
      kind: 'task',
      runId: 'run-1',
      taskId: 'task-1',
      next: {
        status: 'completed',
        progress: 100,
        isTerminal: true,
      },
    },
  ], {
    workflowId: 'workflow-1',
    nodeId: 'node-1',
  });

  assert.equal(initialResult.changed, true);
  assert.equal(completedChanged, true);
  assert.equal(hits >= 2, true);
  assert.equal(store.getTask('task-1')?.status, 'completed');
});
