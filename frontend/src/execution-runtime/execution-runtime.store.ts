import {
  diffExecutionRuntimeGroupState,
  diffExecutionRuntimeNodeState,
  diffExecutionRuntimeRunState,
  diffExecutionRuntimeTaskState,
} from './execution-runtime.diff';
import type {
  ExecutionRuntimeDiffResult,
  ExecutionRuntimeGroupState,
  ExecutionRuntimeNodeState,
  ExecutionRuntimePatch,
  ExecutionRuntimeRunState,
  ExecutionRuntimeTaskState,
} from './execution-runtime.types';

type Listener = () => void;

type ExecutionRuntimeSubscriptionScope = 'run' | 'node' | 'group' | 'task';

interface ExecutionRuntimeStoreMaps {
  runsById: Map<string, ExecutionRuntimeRunState>;
  nodesByKey: Map<string, ExecutionRuntimeNodeState>;
  groupsByKey: Map<string, ExecutionRuntimeGroupState>;
  tasksById: Map<string, ExecutionRuntimeTaskState>;
}

interface ExecutionRuntimeStoreListeners {
  all: Set<Listener>;
  runs: Map<string, Set<Listener>>;
  nodes: Map<string, Set<Listener>>;
  groups: Map<string, Set<Listener>>;
  tasks: Map<string, Set<Listener>>;
}

const EMPTY_GROUP_STATES: ExecutionRuntimeGroupState[] = [];

export interface ExecutionRuntimeStoreApplyResult {
  changed: boolean;
  runChanged: boolean;
  nodeChanged: boolean;
  groupChanged: boolean;
  taskChanged: boolean;
}

export interface ExecutionRuntimeStoreSnapshot {
  runsById: ReadonlyMap<string, ExecutionRuntimeRunState>;
  nodesByKey: ReadonlyMap<string, ExecutionRuntimeNodeState>;
  groupsByKey: ReadonlyMap<string, ExecutionRuntimeGroupState>;
  tasksById: ReadonlyMap<string, ExecutionRuntimeTaskState>;
}

export interface ExecutionRuntimeStoreResetOptions {
  workflowId?: string | null;
}

export interface ExecutionRuntimeStorePatchOptions {
  workflowId?: string | null;
  nodeId?: string | null;
}

function toWorkflowKey(workflowId?: string | null): string {
  return workflowId ?? '__global__';
}

function toNodeKey(nodeId: string, workflowId?: string | null): string {
  return `${toWorkflowKey(workflowId)}::${nodeId}`;
}

function toGroupKey(nodeId: string, groupId: string, workflowId?: string | null): string {
  return `${toNodeKey(nodeId, workflowId)}::${groupId}`;
}

function cloneRunState(state: ExecutionRuntimeRunState): ExecutionRuntimeRunState {
  return {
    ...state,
    tasks: state.tasks.map((task) => ({ ...task })),
  };
}

function cloneNodeState(state: ExecutionRuntimeNodeState): ExecutionRuntimeNodeState {
  return {
    ...state,
  };
}

function cloneGroupState(state: ExecutionRuntimeGroupState): ExecutionRuntimeGroupState {
  return {
    ...state,
  };
}

function cloneTaskState(state: ExecutionRuntimeTaskState): ExecutionRuntimeTaskState {
  return {
    ...state,
  };
}

function pickHighestPriorityStatus(
  items: Array<{ status?: string | null }>,
  fallback: ExecutionRuntimeNodeState['status'] = null,
): ExecutionRuntimeNodeState['status'] {
  if (items.some((item) => item.status === 'processing')) {
    return 'processing';
  }

  if (items.some((item) => item.status === 'queued')) {
    return 'queued';
  }

  if (items.some((item) => item.status === 'failed')) {
    return 'failed';
  }

  if (items.some((item) => item.status === 'cancelled')) {
    return 'cancelled';
  }

  if (items.length > 0 && items.every((item) => item.status === 'completed')) {
    return 'completed';
  }

  return fallback;
}

function deriveNodeStateFromRun(run: ExecutionRuntimeRunState): ExecutionRuntimeNodeState | null {
  if (!run.nodeId) {
    return null;
  }

  const firstTask = run.tasks[0];
  const failedTask = run.tasks.find((task) => task.status === 'failed');
  const committableTasks = run.tasks.filter((task) => task.canCommitOutput);
  const allOutputsCommitted = committableTasks.length > 0
    && committableTasks.every((task) => task.isOutputCommitted);

  return {
    workflowId: run.workflowId ?? null,
    nodeId: run.nodeId,
    nodeType: run.nodeType ?? firstTask?.nodeType ?? null,
    runId: run.runId,
    runNo: run.runNo,
    taskRecordId: null,
    aiTaskId: run.runId,
    taskNo: firstTask?.taskNo,
    batchId: run.runNo,
    status: run.status,
    progress: run.progress,
    message: run.message,
    output: undefined,
    currentStep: failedTask?.currentStep ?? firstTask?.currentStep,
    currentAttemptNo: failedTask?.currentAttemptNo ?? Math.max(0, ...run.tasks.map((task) => task.currentAttemptNo)),
    retryCount: Math.max(0, ...run.tasks.map((task) => task.retryCount)),
    maxRetries: Math.max(0, ...run.tasks.map((task) => task.maxRetries)),
    maxAttempts: Math.max(0, ...run.tasks.map((task) => task.maxAttempts)),
    lastErrorCode: failedTask?.errorCode ?? failedTask?.lastErrorCode ?? null,
    resultFileId: run.tasks.length === 1 ? run.tasks[0]?.resultFileId ?? null : null,
    resultFile: run.tasks.length === 1 ? (run.tasks[0]?.resultFileInfo ?? run.tasks[0]?.resultFile) : undefined,
    error: failedTask?.error ?? undefined,
    totalTaskCount: run.totalTaskCount,
    completedTaskCount: run.completedTaskCount,
    failedTaskCount: run.failedTaskCount,
    resultCommitStatus: allOutputsCommitted
      ? 'committed'
      : run.hasCommittableOutput
        ? 'ready'
        : 'idle',
    resultCommittedAt: null,
    canCommitOutput: run.hasCommittableOutput,
    isTerminal: run.isTerminal,
    isOutputCommitted: run.allOutputsCommitted,
  };
}

function deriveGroupStateFromTask(
  task: ExecutionRuntimeTaskState,
  run: ExecutionRuntimeRunState,
): ExecutionRuntimeGroupState {
  return {
    workflowId: run.workflowId ?? null,
    runId: run.runId,
    runNo: run.runNo,
    nodeId: run.nodeId ?? task.nodeId ?? undefined,
    nodeType: run.nodeType ?? task.nodeType ?? undefined,
    groupId: task.groupId,
    groupOrder: task.groupOrder,
    taskRecordId: null,
    aiTaskId: task.taskId,
    taskNo: task.taskNo,
    batchId: run.runNo,
    status: task.status,
    progress: task.progress,
    message: task.message,
    output: task.output,
    currentStep: task.currentStep,
    currentAttemptNo: task.currentAttemptNo,
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    maxAttempts: task.maxAttempts,
    lastErrorCode: task.errorCode ?? task.lastErrorCode ?? null,
    resultFileId: task.resultFileId,
    resultFile: task.resultFileInfo ?? task.resultFile,
    error: task.error ?? undefined,
    resultCommitStatus: task.resultCommitStatus,
    resultCommittedAt: task.resultCommittedAt ?? null,
    canCommitOutput: task.canCommitOutput,
    isTerminal: task.isTerminal,
    isOutputCommitted: task.isOutputCommitted,
  };
}

function deriveRunStateWithTask(
  run: ExecutionRuntimeRunState,
  task: ExecutionRuntimeTaskState,
): ExecutionRuntimeRunState {
  const taskMap = new Map(run.tasks.map((item) => [item.taskId, item] as const));
  taskMap.set(task.taskId, task);
  const tasks = Array.from(taskMap.values()).sort((left, right) => left.groupOrder - right.groupOrder);

  const completedTaskCount = tasks.filter((item) => item.status === 'completed').length;
  const failedTaskCount = tasks.filter((item) => item.status === 'failed').length;
  const progress = tasks.length === 0
    ? 0
    : Math.round(tasks.reduce((sum, item) => sum + item.progress, 0) / tasks.length);
  const hasCommittableOutput = tasks.some((item) => item.canCommitOutput);
  const allOutputsCommitted = hasCommittableOutput
    && tasks.filter((item) => item.canCommitOutput).every((item) => item.isOutputCommitted);
  const status = (() : ExecutionRuntimeRunState['status'] => {
    const derived = pickHighestPriorityStatus(tasks, run.status);
    if (derived === null) {
      return run.status;
    }

    return derived;
  })();

  return {
    ...run,
    status,
    totalTaskCount: Math.max(run.totalTaskCount, tasks.length),
    completedTaskCount,
    failedTaskCount,
    progress,
    isTerminal: tasks.length > 0 && tasks.every((item) => item.isTerminal),
    hasCommittableOutput,
    allOutputsCommitted,
    tasks,
  };
}

function shouldRemoveStateByWorkflow(
  stateWorkflowId: string | null | undefined,
  workflowId: string | null | undefined,
): boolean {
  return toWorkflowKey(stateWorkflowId) === toWorkflowKey(workflowId);
}

export class ExecutionRuntimeStore {
  private readonly maps: ExecutionRuntimeStoreMaps = {
    runsById: new Map(),
    nodesByKey: new Map(),
    groupsByKey: new Map(),
    tasksById: new Map(),
  };

  private readonly nodeGroupListCache = new Map<string, ExecutionRuntimeGroupState[]>();

  private readonly listeners: ExecutionRuntimeStoreListeners = {
    all: new Set(),
    runs: new Map(),
    nodes: new Map(),
    groups: new Map(),
    tasks: new Map(),
  };

  getSnapshot(): ExecutionRuntimeStoreSnapshot {
    return {
      runsById: this.maps.runsById,
      nodesByKey: this.maps.nodesByKey,
      groupsByKey: this.maps.groupsByKey,
      tasksById: this.maps.tasksById,
    };
  }

  getRun(runId: string): ExecutionRuntimeRunState | null {
    return this.maps.runsById.get(runId) ?? null;
  }

  getTask(taskId: string): ExecutionRuntimeTaskState | null {
    return this.maps.tasksById.get(taskId) ?? null;
  }

  getNode(nodeId: string, workflowId?: string | null): ExecutionRuntimeNodeState | null {
    return this.maps.nodesByKey.get(toNodeKey(nodeId, workflowId)) ?? null;
  }

  getGroup(nodeId: string, groupId: string, workflowId?: string | null): ExecutionRuntimeGroupState | null {
    return this.maps.groupsByKey.get(toGroupKey(nodeId, groupId, workflowId)) ?? null;
  }

  getNodeGroups(nodeId: string, workflowId?: string | null): ExecutionRuntimeGroupState[] {
    const nodeKey = toNodeKey(nodeId, workflowId);
    const cached = this.nodeGroupListCache.get(nodeKey);
    if (cached) {
      return cached;
    }

    const prefix = `${nodeKey}::`;
    const groups = Array.from(this.maps.groupsByKey.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value)
      .sort((left, right) => {
        const leftOrder = left.groupOrder ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.groupOrder ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder;
      });

    const nextValue = groups.length > 0 ? groups : EMPTY_GROUP_STATES;
    this.nodeGroupListCache.set(nodeKey, nextValue);
    return nextValue;
  }

  setNodeState(nextNode: ExecutionRuntimeNodeState): boolean {
    return this.upsertNode(nextNode);
  }

  removeNodeState(nodeId: string, workflowId?: string | null): void {
    const key = toNodeKey(nodeId, workflowId);
    if (!this.maps.nodesByKey.delete(key)) {
      return;
    }

    this.emit('node', key);
  }

  setGroupState(nextGroup: ExecutionRuntimeGroupState): boolean {
    return this.upsertGroup(nextGroup);
  }

  removeGroupState(nodeId: string, groupId: string, workflowId?: string | null): void {
    const key = toGroupKey(nodeId, groupId, workflowId);
    if (!this.maps.groupsByKey.delete(key)) {
      return;
    }

    this.invalidateNodeGroupList(nodeId, workflowId);
    this.emit('group', key);
    this.emit('node', toNodeKey(nodeId, workflowId));
  }

  clearNodeGroups(nodeId: string, workflowId?: string | null): void {
    const prefix = `${toNodeKey(nodeId, workflowId)}::`;
    const groupKeys = Array.from(this.maps.groupsByKey.keys())
      .filter((key) => key.startsWith(prefix));

    if (groupKeys.length === 0) {
      return;
    }

    groupKeys.forEach((key) => {
      this.maps.groupsByKey.delete(key);
      this.emit('group', key);
    });

    this.invalidateNodeGroupList(nodeId, workflowId);
    this.emit('node', toNodeKey(nodeId, workflowId));
  }

  setRun(nextRun: ExecutionRuntimeRunState): boolean {
    const previousRun = this.getRun(nextRun.runId);
    const diff = diffExecutionRuntimeRunState(previousRun, nextRun, {
      runtimeKey: nextRun.runId,
    });

    if (!diff.changed) {
      return false;
    }

    const storedRun = cloneRunState(nextRun);
    this.maps.runsById.set(storedRun.runId, storedRun);
    this.emit('run', storedRun.runId);

    const nextNode = deriveNodeStateFromRun(storedRun);
    if (nextNode?.nodeId) {
      this.upsertNode(nextNode);
    }

    const previousTaskIds = new Set(previousRun?.tasks.map((task) => task.taskId) ?? []);
    storedRun.tasks.forEach((task) => {
      previousTaskIds.delete(task.taskId);
      this.upsertTask(task, storedRun);
    });

    previousTaskIds.forEach((taskId) => {
      this.removeTask(taskId, storedRun);
    });

    return true;
  }

  applyRunSnapshot(nextRun: ExecutionRuntimeRunState): ExecutionRuntimeStoreApplyResult {
    const previousRun = this.getRun(nextRun.runId);
    const previousNode = nextRun.nodeId ? this.getNode(nextRun.nodeId, nextRun.workflowId) : null;
    const previousTasks = new Map((previousRun?.tasks ?? []).map((task) => [task.taskId, task] as const));
    const previousGroups = nextRun.nodeId
      ? new Map(this.getNodeGroups(nextRun.nodeId, nextRun.workflowId).map((group) => [group.groupId, group] as const))
      : new Map<string, ExecutionRuntimeGroupState>();

    const runChanged = this.setRun(nextRun);
    const currentRun = this.getRun(nextRun.runId);
    const currentNode = nextRun.nodeId ? this.getNode(nextRun.nodeId, nextRun.workflowId) : null;
    const currentTasks = new Map((currentRun?.tasks ?? []).map((task) => [task.taskId, task] as const));
    const currentGroups = nextRun.nodeId
      ? new Map(this.getNodeGroups(nextRun.nodeId, nextRun.workflowId).map((group) => [group.groupId, group] as const))
      : new Map<string, ExecutionRuntimeGroupState>();

    const nodeChanged = previousNode !== currentNode;
    const taskChanged = ((): boolean => {
      if (previousTasks.size !== currentTasks.size) {
        return true;
      }

      return Array.from(currentTasks.entries()).some(([taskId, task]) => previousTasks.get(taskId) !== task);
    })();
    const groupChanged = ((): boolean => {
      if (previousGroups.size !== currentGroups.size) {
        return true;
      }

      return Array.from(currentGroups.entries()).some(([groupId, group]) => previousGroups.get(groupId) !== group);
    })();

    return {
      changed: runChanged || nodeChanged || groupChanged || taskChanged,
      runChanged,
      nodeChanged,
      groupChanged,
      taskChanged,
    };
  }

  applyPatches(patches: ExecutionRuntimePatch[], options: ExecutionRuntimeStorePatchOptions = {}): boolean {
    let changed = false;

    patches.forEach((patch) => {
      switch (patch.kind) {
        case 'run': {
          const previous = this.getRun(patch.runId);
          if (!previous) {
            return;
          }

          const next = {
            ...previous,
            ...patch.next,
            tasks: patch.next.tasks
              ? patch.next.tasks.map((task) => ({ ...task }))
              : previous.tasks.map((task) => ({ ...task })),
          } satisfies ExecutionRuntimeRunState;
          changed = this.setRun(next) || changed;
          return;
        }

        case 'task': {
          const previous = this.getTask(patch.taskId);
          const run = this.getRun(patch.runId);
          if (!previous || !run) {
            return;
          }

          const next = {
            ...previous,
            ...patch.next,
          } satisfies ExecutionRuntimeTaskState;
          changed = this.upsertTask(next, run) || changed;
          return;
        }

        case 'node': {
          const previous = this.getNode(patch.nodeId, options.workflowId);
          if (!previous) {
            return;
          }

          const next = {
            ...previous,
            ...patch.next,
            workflowId: patch.next.workflowId ?? previous.workflowId ?? options.workflowId ?? null,
            nodeId: patch.next.nodeId ?? previous.nodeId ?? patch.nodeId,
          } satisfies ExecutionRuntimeNodeState;
          changed = this.upsertNode(next) || changed;
          return;
        }

        case 'group': {
          const workflowId = patch.next.workflowId ?? options.workflowId ?? null;
          const previous = this.getGroup(patch.nodeId, patch.groupId, workflowId);
          if (!previous) {
            return;
          }

          const next = {
            ...previous,
            ...patch.next,
            workflowId,
            nodeId: patch.next.nodeId ?? previous.nodeId ?? patch.nodeId,
            groupId: patch.next.groupId ?? previous.groupId ?? patch.groupId,
          } satisfies ExecutionRuntimeGroupState;
          changed = this.upsertGroup(next) || changed;
        }
      }
    });

    return changed;
  }

  reset(options: ExecutionRuntimeStoreResetOptions = {}): void {
    if (!options.workflowId) {
      const runIds = Array.from(this.maps.runsById.keys());
      const nodeKeys = Array.from(this.maps.nodesByKey.keys());
      const groupKeys = Array.from(this.maps.groupsByKey.keys());
      const taskIds = Array.from(this.maps.tasksById.keys());

      this.maps.runsById.clear();
      this.maps.nodesByKey.clear();
      this.maps.groupsByKey.clear();
      this.maps.tasksById.clear();
      this.nodeGroupListCache.clear();

      runIds.forEach((runId) => this.emit('run', runId));
      nodeKeys.forEach((key) => this.emit('node', key));
      groupKeys.forEach((key) => this.emit('group', key));
      taskIds.forEach((taskId) => this.emit('task', taskId));
      return;
    }

    const removedRunIds: string[] = [];
    const removedRunIdSet = new Set<string>();
    this.maps.runsById.forEach((run, runId) => {
      if (shouldRemoveStateByWorkflow(run.workflowId, options.workflowId)) {
        this.maps.runsById.delete(runId);
        removedRunIds.push(runId);
        removedRunIdSet.add(runId);
      }
    });

    const removedNodeKeys: string[] = [];
    this.maps.nodesByKey.forEach((node, key) => {
      if (shouldRemoveStateByWorkflow(node.workflowId, options.workflowId)) {
        this.maps.nodesByKey.delete(key);
        removedNodeKeys.push(key);
      }
    });

    const removedGroupKeys: string[] = [];
    this.maps.groupsByKey.forEach((group, key) => {
      if (shouldRemoveStateByWorkflow(group.workflowId, options.workflowId)) {
        this.maps.groupsByKey.delete(key);
        removedGroupKeys.push(key);
      }
    });

    const removedTaskIds: string[] = [];
    this.maps.tasksById.forEach((task, taskId) => {
      if (removedRunIdSet.has(task.runId)) {
        this.maps.tasksById.delete(taskId);
        removedTaskIds.push(taskId);
      }
    });

    this.nodeGroupListCache.clear();

    removedRunIds.forEach((runId) => this.emit('run', runId));
    removedNodeKeys.forEach((key) => this.emit('node', key));
    removedGroupKeys.forEach((key) => this.emit('group', key));
    removedTaskIds.forEach((taskId) => this.emit('task', taskId));
  }

  subscribeRun(runId: string, listener: Listener): () => void {
    return this.subscribe('run', runId, listener);
  }

  subscribeNode(nodeId: string, workflowId: string | null | undefined, listener: Listener): () => void {
    return this.subscribe('node', toNodeKey(nodeId, workflowId), listener);
  }

  subscribeGroup(
    nodeId: string,
    groupId: string,
    workflowId: string | null | undefined,
    listener: Listener,
  ): () => void {
    return this.subscribe('group', toGroupKey(nodeId, groupId, workflowId), listener);
  }

  subscribeTask(taskId: string, listener: Listener): () => void {
    return this.subscribe('task', taskId, listener);
  }

  subscribeAll(listener: Listener): () => void {
    this.listeners.all.add(listener);

    return (): void => {
      this.listeners.all.delete(listener);
    };
  }

  private upsertNode(nextNode: ExecutionRuntimeNodeState): boolean {
    if (!nextNode.nodeId) {
      return false;
    }

    const key = toNodeKey(nextNode.nodeId, nextNode.workflowId);
    const previous = this.maps.nodesByKey.get(key);
    const diff = diffExecutionRuntimeNodeState(previous, nextNode, {
      runtimeKey: key,
    });

    if (!diff.changed) {
      return false;
    }

    this.maps.nodesByKey.set(key, cloneNodeState(nextNode));
    this.emit('node', key);
    return true;
  }

  private upsertGroup(nextGroup: ExecutionRuntimeGroupState): boolean {
    if (!nextGroup.nodeId) {
      return false;
    }

    const key = toGroupKey(nextGroup.nodeId, nextGroup.groupId, nextGroup.workflowId);
    const previous = this.maps.groupsByKey.get(key);
    const diff = diffExecutionRuntimeGroupState(previous, nextGroup, {
      runtimeKey: key,
    });

    if (!diff.changed) {
      return false;
    }

    this.maps.groupsByKey.set(key, cloneGroupState(nextGroup));
    this.invalidateNodeGroupList(nextGroup.nodeId, nextGroup.workflowId);
    this.emit('group', key);
    this.emit('node', toNodeKey(nextGroup.nodeId, nextGroup.workflowId));
    return true;
  }

  private upsertTask(nextTask: ExecutionRuntimeTaskState, run: ExecutionRuntimeRunState): boolean {
    const previous = this.maps.tasksById.get(nextTask.taskId);
    const diff = diffExecutionRuntimeTaskState(previous, nextTask, {
      runtimeKey: nextTask.taskId,
    });

    if (!diff.changed) {
      return false;
    }

    const storedTask = cloneTaskState(nextTask);
    this.maps.tasksById.set(storedTask.taskId, storedTask);
    this.emit('task', storedTask.taskId);

    const currentRun = this.getRun(run.runId) ?? run;
    const nextRun = deriveRunStateWithTask(currentRun, storedTask);
    const runDiff = diffExecutionRuntimeRunState(currentRun, nextRun, {
      runtimeKey: run.runId,
    });

    if (runDiff.changed) {
      this.maps.runsById.set(run.runId, cloneRunState(nextRun));
      this.emit('run', run.runId);
    }

    const targetRun = this.getRun(run.runId) ?? nextRun;
    const group = deriveGroupStateFromTask(storedTask, targetRun);
    this.upsertGroup(group);

    const node = deriveNodeStateFromRun(targetRun);
    if (node?.nodeId) {
      this.upsertNode(node);
    }

    return true;
  }

  private removeTask(taskId: string, run?: ExecutionRuntimeRunState): void {
    const previous = this.maps.tasksById.get(taskId);
    if (!previous) {
      return;
    }

    this.maps.tasksById.delete(taskId);
    this.emit('task', taskId);

    const currentRun = run ?? this.getRun(previous.runId);
    const runWorkflowId = currentRun?.workflowId ?? null;
    const runNodeId = currentRun?.nodeId ?? previous.nodeId ?? null;

    if (runNodeId) {
      const groupKey = toGroupKey(runNodeId, previous.groupId, runWorkflowId);
      if (this.maps.groupsByKey.delete(groupKey)) {
        this.invalidateNodeGroupList(runNodeId, runWorkflowId);
        this.emit('group', groupKey);
        this.emit('node', toNodeKey(runNodeId, runWorkflowId));
      }
    }
  }

  private invalidateNodeGroupList(nodeId: string, workflowId?: string | null): void {
    this.nodeGroupListCache.delete(toNodeKey(nodeId, workflowId));
  }

  private subscribe(scope: ExecutionRuntimeSubscriptionScope, key: string, listener: Listener): () => void {
    const bucketMap = this.getListenerBucket(scope);
    const listeners = bucketMap.get(key) ?? new Set<Listener>();
    listeners.add(listener);
    bucketMap.set(key, listeners);

    return (): void => {
      const current = bucketMap.get(key);
      if (!current) {
        return;
      }

      current.delete(listener);
      if (current.size === 0) {
        bucketMap.delete(key);
      }
    };
  }

  private emit(scope: ExecutionRuntimeSubscriptionScope, key: string): void {
    const listeners = this.getListenerBucket(scope).get(key);
    if (listeners && listeners.size > 0) {
      Array.from(listeners).forEach((listener) => listener());
    }

    if (this.listeners.all.size === 0) {
      return;
    }

    Array.from(this.listeners.all).forEach((listener) => listener());
  }

  private getListenerBucket(scope: ExecutionRuntimeSubscriptionScope): Map<string, Set<Listener>> {
    switch (scope) {
      case 'run':
        return this.listeners.runs;
      case 'node':
        return this.listeners.nodes;
      case 'group':
        return this.listeners.groups;
      case 'task':
        return this.listeners.tasks;
      default:
        return this.listeners.runs;
    }
  }
}

let globalExecutionRuntimeStore: ExecutionRuntimeStore | null = null;

export function createExecutionRuntimeStore(): ExecutionRuntimeStore {
  return new ExecutionRuntimeStore();
}

export function getExecutionRuntimeStore(): ExecutionRuntimeStore {
  if (!globalExecutionRuntimeStore) {
    globalExecutionRuntimeStore = createExecutionRuntimeStore();
  }

  return globalExecutionRuntimeStore;
}

export function setExecutionRuntimeStore(store: ExecutionRuntimeStore): void {
  globalExecutionRuntimeStore = store;
}

export const executionRuntimeStore = getExecutionRuntimeStore();

export function getExecutionRuntimeNodeKey(nodeId: string, workflowId?: string | null): string {
  return toNodeKey(nodeId, workflowId);
}

export function getExecutionRuntimeGroupKey(nodeId: string, groupId: string, workflowId?: string | null): string {
  return toGroupKey(nodeId, groupId, workflowId);
}

export function diffExecutionRuntimeStoreRun(
  previous: ExecutionRuntimeRunState | null | undefined,
  next: ExecutionRuntimeRunState,
): ExecutionRuntimeDiffResult {
  return diffExecutionRuntimeRunState(previous, next, {
    runtimeKey: next.runId,
  });
}

export function diffExecutionRuntimeStoreNode(
  previous: ExecutionRuntimeNodeState | null | undefined,
  next: ExecutionRuntimeNodeState,
): ExecutionRuntimeDiffResult {
  return diffExecutionRuntimeNodeState(previous, next, {
    runtimeKey: next.nodeId ?? 'unknown',
  });
}

export function diffExecutionRuntimeStoreGroup(
  previous: ExecutionRuntimeGroupState | null | undefined,
  next: ExecutionRuntimeGroupState,
): ExecutionRuntimeDiffResult {
  return diffExecutionRuntimeGroupState(previous, next, {
    runtimeKey: `${next.nodeId ?? 'unknown'}::${next.groupId}`,
  });
}

export function diffExecutionRuntimeStoreTask(
  previous: ExecutionRuntimeTaskState | null | undefined,
  next: ExecutionRuntimeTaskState,
): ExecutionRuntimeDiffResult {
  return diffExecutionRuntimeTaskState(previous, next, {
    runtimeKey: next.taskId,
  });
}
