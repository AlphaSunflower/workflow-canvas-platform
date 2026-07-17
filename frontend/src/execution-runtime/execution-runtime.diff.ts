import type { FileInfo } from '@/types';
import {
  EXECUTION_RUNTIME_LAYOUT_AFFECTING_FIELDS,
  EXECUTION_RUNTIME_TERMINAL_GROUP_STATUSES,
  EXECUTION_RUNTIME_TERMINAL_STATUSES,
  EXECUTION_RUNTIME_VISUAL_ONLY_FIELDS,
} from './execution-runtime.constants';
import type {
  ExecutionRuntimeDiffResult,
  ExecutionRuntimeGroupPatch,
  ExecutionRuntimeGroupState,
  ExecutionRuntimeNodePatch,
  ExecutionRuntimeNodeState,
  ExecutionRuntimeRunPatch,
  ExecutionRuntimeRunState,
  ExecutionRuntimeSubscriptionHint,
  ExecutionRuntimeTaskPatch,
  ExecutionRuntimeTaskState,
} from './execution-runtime.types';

function sameFileInfo(left?: FileInfo, right?: FileInfo): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.id === right.id
    && left.hash === right.hash
    && left.timestamp.updated === right.timestamp.updated;
}

function isSameValue(left: unknown, right: unknown, key: string): boolean {
  if (key === 'resultFile') {
    return sameFileInfo(left as FileInfo | undefined, right as FileInfo | undefined);
  }

  return Object.is(left, right);
}

function buildChangedFields<TState extends object>(
  previous: Partial<TState> | null | undefined,
  next: Partial<TState>,
): Partial<TState> {
  const changed: Partial<TState> = {};

  Object.entries(next as Record<string, unknown>).forEach(([key, value]) => {
    const previousValue = previous?.[key as keyof TState];
    if (!isSameValue(previousValue, value, key)) {
      changed[key as keyof TState] = value as TState[keyof TState];
    }
  });

  return changed;
}

function hasChangedFields(changed: Record<string, unknown>): boolean {
  return Object.keys(changed).length > 0;
}

function hasAnyField(changed: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.some((field) => field in changed);
}

function hasLayoutAffectedChange(changed: Record<string, unknown>): boolean {
  return hasAnyField(changed, EXECUTION_RUNTIME_LAYOUT_AFFECTING_FIELDS);
}

function hasVisualOnlyChange(changed: Record<string, unknown>): boolean {
  return hasAnyField(changed, EXECUTION_RUNTIME_VISUAL_ONLY_FIELDS);
}

export function isTerminalExecutionStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && EXECUTION_RUNTIME_TERMINAL_STATUSES.includes(status as typeof EXECUTION_RUNTIME_TERMINAL_STATUSES[number]);
}

export function isTerminalExecutionGroupStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && EXECUTION_RUNTIME_TERMINAL_GROUP_STATUSES.includes(status as typeof EXECUTION_RUNTIME_TERMINAL_GROUP_STATUSES[number]);
}

export function canCommitExecutionOutput(resultFileId: string | null | undefined, status: string | null | undefined): boolean {
  return Boolean(resultFileId) && status === 'completed';
}

export function isExecutionOutputCommitted(status: string | null | undefined): boolean {
  return status === 'committed';
}

export function buildExecutionRuntimeSubscriptionHint(changed: Record<string, unknown>): ExecutionRuntimeSubscriptionHint {
  const layoutAffected = hasLayoutAffectedChange(changed);
  const visualOnlyChanged = hasVisualOnlyChange(changed);

  return {
    layoutAffected,
    visualOnlyChanged,
    shouldNotify: layoutAffected || visualOnlyChanged || hasChangedFields(changed),
  };
}

export function diffExecutionRuntimeRunState(
  previous: ExecutionRuntimeRunState | null | undefined,
  next: ExecutionRuntimeRunState,
  options: { runtimeKey: string; revision?: number } = { runtimeKey: 'unknown' },
): ExecutionRuntimeDiffResult {
  const changed = buildChangedFields(previous, next);
  const changedAny = hasChangedFields(changed);
  const patches: ExecutionRuntimeRunPatch[] = changedAny
    ? [{ kind: 'run', runId: next.runId, next: changed }]
    : [];

  return {
    changed: changedAny,
    patches,
    meta: {
      version: 1,
      runtimeKey: options.runtimeKey,
      scope: 'run',
      revision: options.revision ?? 0,
      statusChanged: 'status' in changed,
      progressChanged: 'progress' in changed,
      layoutAffected: hasLayoutAffectedChange(changed),
      terminalChanged: 'isTerminal' in changed,
      commitStateChanged: 'allOutputsCommitted' in changed || 'hasCommittableOutput' in changed,
    },
  };
}

export function diffExecutionRuntimeNodeState(
  previous: ExecutionRuntimeNodeState | null | undefined,
  next: ExecutionRuntimeNodeState,
  options: { runtimeKey: string; revision?: number } = { runtimeKey: 'unknown' },
): ExecutionRuntimeDiffResult {
  const changed = buildChangedFields(previous, next);
  const changedAny = hasChangedFields(changed);
  const patches: ExecutionRuntimeNodePatch[] = changedAny
    ? [{ kind: 'node', nodeId: next.nodeId ?? 'unknown', next: changed }]
    : [];

  return {
    changed: changedAny,
    patches,
    meta: {
      version: 1,
      runtimeKey: options.runtimeKey,
      scope: 'node',
      revision: options.revision ?? 0,
      statusChanged: 'status' in changed,
      progressChanged: 'progress' in changed,
      layoutAffected: hasLayoutAffectedChange(changed),
      terminalChanged: 'isTerminal' in changed,
      commitStateChanged: 'resultCommitStatus' in changed || 'resultCommittedAt' in changed || 'canCommitOutput' in changed || 'isOutputCommitted' in changed,
    },
  };
}

export function diffExecutionRuntimeGroupState(
  previous: ExecutionRuntimeGroupState | null | undefined,
  next: ExecutionRuntimeGroupState,
  options: { runtimeKey: string; revision?: number } = { runtimeKey: 'unknown' },
): ExecutionRuntimeDiffResult {
  const changed = buildChangedFields(previous, next);
  const changedAny = hasChangedFields(changed);
  const patches: ExecutionRuntimeGroupPatch[] = changedAny
    ? [{ kind: 'group', nodeId: next.nodeId ?? 'unknown', groupId: next.groupId, next: changed }]
    : [];

  return {
    changed: changedAny,
    patches,
    meta: {
      version: 1,
      runtimeKey: options.runtimeKey,
      scope: 'group',
      revision: options.revision ?? 0,
      statusChanged: 'status' in changed,
      progressChanged: 'progress' in changed,
      layoutAffected: hasLayoutAffectedChange(changed),
      terminalChanged: 'isTerminal' in changed,
      commitStateChanged: 'resultCommitStatus' in changed || 'resultCommittedAt' in changed || 'canCommitOutput' in changed || 'isOutputCommitted' in changed,
    },
  };
}

export function diffExecutionRuntimeTaskState(
  previous: ExecutionRuntimeTaskState | null | undefined,
  next: ExecutionRuntimeTaskState,
  options: { runtimeKey: string; revision?: number } = { runtimeKey: 'unknown' },
): ExecutionRuntimeDiffResult {
  const changed = buildChangedFields(previous, next);
  const changedAny = hasChangedFields(changed);
  const patches: ExecutionRuntimeTaskPatch[] = changedAny
    ? [{ kind: 'task', runId: next.runId, taskId: next.taskId, next: changed }]
    : [];

  return {
    changed: changedAny,
    patches,
    meta: {
      version: 1,
      runtimeKey: options.runtimeKey,
      scope: 'group',
      revision: options.revision ?? 0,
      statusChanged: 'status' in changed,
      progressChanged: 'progress' in changed,
      layoutAffected: hasLayoutAffectedChange(changed),
      terminalChanged: 'isTerminal' in changed,
      commitStateChanged: 'resultCommitStatus' in changed || 'resultCommittedAt' in changed || 'canCommitOutput' in changed || 'isOutputCommitted' in changed,
    },
  };
}
