import type { WorkflowRelatedTaskRef } from '@/types';
import { isEphemeralResourceUrl } from '@/services/protected-resource';
import type {
  TaskHistoryDetail,
  TaskHistoryListItem,
  TaskHistoryPreviewFile,
} from './task-history.types';

type Listener = () => void;

export interface CanvasTaskHistorySnapshot {
  workflowId: string | null;
  relatedTasks: WorkflowRelatedTaskRef[];
  items: TaskHistoryListItem[];
  itemsByTaskId: ReadonlyMap<string, TaskHistoryListItem>;
  detailsByTaskId: ReadonlyMap<string, TaskHistoryDetail>;
  loading: boolean;
  initialized: boolean;
  lastHydratedAt: number | null;
}

interface TaskHistoryStoreEntry {
  workflowId: string;
  relatedTasks: WorkflowRelatedTaskRef[];
  items: TaskHistoryListItem[];
  itemsByTaskId: Map<string, TaskHistoryListItem>;
  detailsByTaskId: Map<string, TaskHistoryDetail>;
  loading: boolean;
  initialized: boolean;
  lastHydratedAt: number | null;
  snapshot: CanvasTaskHistorySnapshot;
}

export interface UpsertTaskHistorySkeletonInput {
  workflowId: string;
  relatedTasks: WorkflowRelatedTaskRef[];
}

export interface UpsertTaskHistoryItemsInput {
  workflowId: string;
  items: TaskHistoryListItem[];
}

export interface UpsertTaskHistoryDetailInput {
  workflowId: string;
  detail: TaskHistoryDetail;
}

export interface PatchTaskHistoryItemInput {
  workflowId: string;
  taskId: string;
  updater: (item: TaskHistoryListItem) => TaskHistoryListItem;
}

const EMPTY_ITEMS: TaskHistoryListItem[] = [];
const EMPTY_ITEM_MAP = new Map<string, TaskHistoryListItem>();
const EMPTY_DETAIL_MAP = new Map<string, TaskHistoryDetail>();
const EMPTY_SNAPSHOT: CanvasTaskHistorySnapshot = {
  workflowId: null,
  relatedTasks: [],
  items: EMPTY_ITEMS,
  itemsByTaskId: EMPTY_ITEM_MAP,
  detailsByTaskId: EMPTY_DETAIL_MAP,
  loading: false,
  initialized: false,
  lastHydratedAt: null,
};

const listeners = new Set<Listener>();
const entries = new Map<string, TaskHistoryStoreEntry>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function sortItems(items: Iterable<TaskHistoryListItem>): TaskHistoryListItem[] {
  return Array.from(items).sort((left, right) => {
    if (right.createdAt !== left.createdAt) {
      return right.createdAt - left.createdAt;
    }

    return right.taskId.localeCompare(left.taskId);
  });
}

function areRelatedTasksEqual(left: WorkflowRelatedTaskRef[], right: WorkflowRelatedTaskRef[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => {
    const target = right[index];
    return target
      && item.taskId === target.taskId
      && item.taskNo === target.taskNo
      && item.runId === target.runId
      && item.runNo === target.runNo
      && item.taskType === target.taskType
      && item.nodeId === target.nodeId
      && item.nodeDisplayId === target.nodeDisplayId
      && item.nodeType === target.nodeType
      && item.groupId === target.groupId
      && item.groupLabel === target.groupLabel
      && item.groupOrder === target.groupOrder
      && item.outputHandle === target.outputHandle
      && item.createdAt === target.createdAt;
  });
}

function areItemsEqual(left: TaskHistoryListItem[], right: TaskHistoryListItem[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item === right[index]);
}

function buildSnapshot(entry: TaskHistoryStoreEntry): CanvasTaskHistorySnapshot {
  return {
    workflowId: entry.workflowId,
    relatedTasks: entry.relatedTasks,
    items: entry.items,
    itemsByTaskId: entry.itemsByTaskId,
    detailsByTaskId: entry.detailsByTaskId,
    loading: entry.loading,
    initialized: entry.initialized,
    lastHydratedAt: entry.lastHydratedAt,
  };
}

function refreshEntrySnapshot(entry: TaskHistoryStoreEntry): void {
  entry.snapshot = buildSnapshot(entry);
}

function createEmptyEntry(workflowId: string): TaskHistoryStoreEntry {
  const itemsByTaskId = new Map<string, TaskHistoryListItem>();
  const detailsByTaskId = new Map<string, TaskHistoryDetail>();
  const entry: TaskHistoryStoreEntry = {
    workflowId,
    relatedTasks: [],
    items: [],
    itemsByTaskId,
    detailsByTaskId,
    loading: false,
    initialized: false,
    lastHydratedAt: null,
    snapshot: {
      workflowId,
      relatedTasks: [],
      items: [],
      itemsByTaskId,
      detailsByTaskId,
      loading: false,
      initialized: false,
      lastHydratedAt: null,
    },
  };

  return entry;
}

function getOrCreateEntry(workflowId: string): TaskHistoryStoreEntry {
  const existing = entries.get(workflowId);
  if (existing) {
    return existing;
  }

  const created = createEmptyEntry(workflowId);
  entries.set(workflowId, created);
  return created;
}

export function createTaskHistorySummaryItem(item: TaskHistoryListItem | TaskHistoryDetail): TaskHistoryListItem {
  return {
    taskId: item.taskId,
    taskNo: item.taskNo,
    runId: item.runId,
    runNo: item.runNo,
    workflowId: item.workflowId,
    projectId: item.projectId,
    nodeId: item.nodeId,
    nodeTitle: item.nodeTitle ?? null,
    nodeType: item.nodeType,
    taskType: item.taskType,
    groupId: item.groupId,
    groupOrder: item.groupOrder,
    status: item.status,
    currentStep: item.currentStep,
    createdAt: item.createdAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    durationMs: item.durationMs,
    provider: item.provider ?? null,
    model: item.model ?? null,
    title: item.title,
    subtitle: item.subtitle ?? null,
    message: item.message,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
    latestEventAt: item.latestEventAt ?? null,
    isTerminal: item.isTerminal,
    isFailed: item.isFailed,
    isCancelled: item.isCancelled,
    isSuccessful: item.isSuccessful,
    inputPreviewItems: item.inputPreviewItems,
    artifactPreviewItems: item.artifactPreviewItems,
    primaryArtifact: item.primaryArtifact,
    relatedTaskRef: item.relatedTaskRef,
  };
}

function buildSkeletonItem(task: WorkflowRelatedTaskRef): TaskHistoryListItem {
  const createdAt = typeof task.createdAt === 'number' ? task.createdAt : 0;

  return {
    taskId: task.taskId,
    taskNo: task.taskNo ?? task.taskId,
    runId: task.runId ?? '',
    runNo: task.runNo ?? null,
    workflowId: null,
    projectId: null,
    nodeId: task.nodeId,
    nodeTitle: null,
    nodeType: task.nodeType,
    taskType: task.taskType ?? 'unknown',
    groupId: task.groupId ?? null,
    groupOrder: task.groupOrder ?? null,
    status: 'queued',
    currentStep: null,
    createdAt,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    provider: null,
    model: null,
    title: task.nodeDisplayId ?? task.nodeType,
    subtitle: task.groupLabel ?? null,
    message: null,
    errorCode: null,
    errorMessage: null,
    latestEventAt: null,
    isTerminal: false,
    isFailed: false,
    isCancelled: false,
    isSuccessful: false,
    artifactPreviewItems: [],
    primaryArtifact: null,
    relatedTaskRef: task,
  };
}

function arePreviewItemEqual(
  left: TaskHistoryPreviewFile | null | undefined,
  right: TaskHistoryPreviewFile | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  return left.fileId === right.fileId
    && left.fileInfo?.id === right.fileInfo?.id
    && left.fileInfo?.path === right.fileInfo?.path
    && left.fileInfo?.thumbnailPath === right.fileInfo?.thumbnailPath
    && left.fileInfo?.previewPath === right.fileInfo?.previewPath
    && left.fileInfo?.name === right.fileInfo?.name
    && left.fileInfo?.fileType === right.fileInfo?.fileType
    && left.backendFile?.fileId === right.backendFile?.fileId
    && left.backendFile?.downloadUrl === right.backendFile?.downloadUrl
    && left.backendFile?.thumbnailUrl === right.backendFile?.thumbnailUrl
    && left.backendFile?.previewUrl === right.backendFile?.previewUrl
    && left.backendFile?.displayName === right.backendFile?.displayName
    && left.backendFile?.fileType === right.backendFile?.fileType
    && left.role === right.role
    && left.label === right.label
    && left.order === right.order
    && left.isPrimary === right.isPrimary;
}

function arePreviewItemsEqual(left: TaskHistoryPreviewFile[], right: TaskHistoryPreviewFile[]): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => arePreviewItemEqual(item, right[index]));
}

function hasPersistentPreviewSummary(item: TaskHistoryPreviewFile | null | undefined): boolean {
  if (!item) {
    return false;
  }

  return Boolean(
    item.backendFile?.thumbnailUrl
    || item.backendFile?.previewUrl
    || item.backendFile?.downloadUrl
    || (item.fileInfo?.thumbnailPath && !isEphemeralResourceUrl(item.fileInfo.thumbnailPath))
    || (item.fileInfo?.previewPath && !isEphemeralResourceUrl(item.fileInfo.previewPath))
    || (item.fileInfo?.path && !isEphemeralResourceUrl(item.fileInfo.path)),
  );
}

function choosePreferredPreviewItem(
  previous: TaskHistoryPreviewFile | null | undefined,
  next: TaskHistoryPreviewFile | null | undefined,
): TaskHistoryPreviewFile | null | undefined {
  if (!previous) {
    return next;
  }

  if (!next) {
    return previous;
  }

  const previousHasPersistent = hasPersistentPreviewSummary(previous);
  const nextHasPersistent = hasPersistentPreviewSummary(next);

  if (previousHasPersistent && !nextHasPersistent) {
    return previous;
  }

  if (!previousHasPersistent && nextHasPersistent) {
    return next;
  }

  return next;
}

function mergePreviewItems(
  previous: TaskHistoryPreviewFile[],
  next: TaskHistoryPreviewFile[],
): TaskHistoryPreviewFile[] {
  if (next.length === 0) {
    return previous;
  }

  const previousByKey = new Map<string, TaskHistoryPreviewFile>();
  previous.forEach((item) => {
    previousByKey.set(`${item.fileId}:${item.role}:${item.order}`, item);
  });

  return next.map((item) => {
    const previousItem = previousByKey.get(`${item.fileId}:${item.role}:${item.order}`);
    return choosePreferredPreviewItem(previousItem, item) ?? item;
  });
}

function areRelatedTaskRefsEqual(
  left: WorkflowRelatedTaskRef | undefined,
  right: WorkflowRelatedTaskRef | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  return left.taskId === right.taskId
    && left.taskNo === right.taskNo
    && left.runId === right.runId
    && left.runNo === right.runNo
    && left.taskType === right.taskType
    && left.nodeId === right.nodeId
    && left.nodeDisplayId === right.nodeDisplayId
    && left.nodeType === right.nodeType
    && left.groupId === right.groupId
    && left.groupLabel === right.groupLabel
    && left.groupOrder === right.groupOrder
    && left.outputHandle === right.outputHandle
    && left.createdAt === right.createdAt;
}

function areTaskHistoryItemsEqual(previous: TaskHistoryListItem, next: TaskHistoryListItem): boolean {
  return previous.taskId === next.taskId
    && previous.taskNo === next.taskNo
    && previous.runId === next.runId
    && previous.runNo === next.runNo
    && previous.workflowId === next.workflowId
    && previous.projectId === next.projectId
    && previous.nodeId === next.nodeId
    && previous.nodeTitle === next.nodeTitle
    && previous.nodeType === next.nodeType
    && previous.taskType === next.taskType
    && previous.groupId === next.groupId
    && previous.groupOrder === next.groupOrder
    && previous.status === next.status
    && previous.currentStep === next.currentStep
    && previous.createdAt === next.createdAt
    && previous.startedAt === next.startedAt
    && previous.completedAt === next.completedAt
    && previous.durationMs === next.durationMs
    && previous.provider === next.provider
    && previous.model === next.model
    && previous.title === next.title
    && previous.subtitle === next.subtitle
    && previous.message === next.message
    && previous.errorCode === next.errorCode
    && previous.errorMessage === next.errorMessage
    && previous.latestEventAt === next.latestEventAt
    && previous.isTerminal === next.isTerminal
    && previous.isFailed === next.isFailed
    && previous.isCancelled === next.isCancelled
    && previous.isSuccessful === next.isSuccessful
    && arePreviewItemsEqual(previous.inputPreviewItems ?? [], next.inputPreviewItems ?? [])
    && arePreviewItemsEqual(previous.artifactPreviewItems, next.artifactPreviewItems)
    && arePreviewItemEqual(previous.primaryArtifact, next.primaryArtifact)
    && areRelatedTaskRefsEqual(previous.relatedTaskRef, next.relatedTaskRef);
}

function mergeListItem(
  previous: TaskHistoryListItem | undefined,
  next: TaskHistoryListItem,
): TaskHistoryListItem {
  if (!previous) {
    return next;
  }

  const mergedArtifactPreviewItems = next.artifactPreviewItems.length > 0
    ? mergePreviewItems(previous.artifactPreviewItems, next.artifactPreviewItems)
    : previous.artifactPreviewItems;
  const mergedPrimaryArtifact = choosePreferredPreviewItem(previous.primaryArtifact, next.primaryArtifact)
    ?? previous.primaryArtifact
    ?? next.primaryArtifact
    ?? null;

  const merged: TaskHistoryListItem = {
    ...previous,
    ...next,
    provider: next.provider ?? previous.provider ?? null,
    model: next.model ?? previous.model ?? null,
    title: next.title ?? previous.title,
    subtitle: next.subtitle ?? previous.subtitle ?? null,
    message: next.message ?? previous.message,
    errorCode: next.errorCode ?? previous.errorCode,
    errorMessage: next.errorMessage ?? previous.errorMessage,
    latestEventAt: next.latestEventAt ?? previous.latestEventAt ?? null,
    inputPreviewItems: next.inputPreviewItems && next.inputPreviewItems.length > 0
      ? mergePreviewItems(previous.inputPreviewItems ?? [], next.inputPreviewItems)
      : previous.inputPreviewItems,
    artifactPreviewItems: mergedArtifactPreviewItems,
    primaryArtifact: mergedPrimaryArtifact,
    relatedTaskRef: next.relatedTaskRef ?? previous.relatedTaskRef,
  };

  return areTaskHistoryItemsEqual(previous, merged) ? previous : merged;
}

function mergeSkeletonRelatedTaskRef(
  previous: TaskHistoryListItem | undefined,
  task: WorkflowRelatedTaskRef,
): TaskHistoryListItem {
  const skeleton = buildSkeletonItem(task);
  if (!previous) {
    return skeleton;
  }

  const merged: TaskHistoryListItem = {
    ...previous,
    taskNo: previous.taskNo || skeleton.taskNo,
    runId: previous.runId || skeleton.runId,
    runNo: previous.runNo ?? skeleton.runNo,
    groupId: previous.groupId ?? skeleton.groupId,
    groupOrder: previous.groupOrder ?? skeleton.groupOrder,
    title: previous.title ?? skeleton.title,
    subtitle: previous.subtitle ?? skeleton.subtitle,
    relatedTaskRef: task,
  };

  return areTaskHistoryItemsEqual(previous, merged) ? previous : merged;
}

function updateItems(entry: TaskHistoryStoreEntry): boolean {
  const nextItems = sortItems(entry.itemsByTaskId.values());
  if (areItemsEqual(entry.items, nextItems)) {
    return false;
  }

  entry.items = nextItems;
  return true;
}

function commit(entry: TaskHistoryStoreEntry): void {
  refreshEntrySnapshot(entry);
  emit();
}

function upsertSkeleton(input: UpsertTaskHistorySkeletonInput): void {
  const entry = getOrCreateEntry(input.workflowId);
  const nextRelatedTasks = [...input.relatedTasks].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  let changed = false;

  if (!areRelatedTasksEqual(entry.relatedTasks, nextRelatedTasks)) {
    entry.relatedTasks = nextRelatedTasks;
    changed = true;
  }

  entry.relatedTasks.forEach((task) => {
    const previous = entry.itemsByTaskId.get(task.taskId);
    const merged = mergeSkeletonRelatedTaskRef(previous, task);
    if (previous !== merged) {
      entry.itemsByTaskId.set(task.taskId, merged);
      changed = true;
    }
  });

  if (updateItems(entry)) {
    changed = true;
  }

  if (!entry.initialized) {
    entry.initialized = true;
    changed = true;
  }

  if (!changed) {
    return;
  }

  commit(entry);
}

function replaceItems(input: UpsertTaskHistoryItemsInput): void {
  const entry = getOrCreateEntry(input.workflowId);
  let changed = false;
  const incomingTaskIdSet = new Set(input.items.map((item) => item.taskId));

  input.items.forEach((item) => {
    const previous = entry.itemsByTaskId.get(item.taskId);
    const merged = mergeListItem(previous, item);
    if (previous !== merged) {
      entry.itemsByTaskId.set(item.taskId, merged);
      changed = true;
    }
  });

  entry.itemsByTaskId.forEach((_item, taskId) => {
    if (incomingTaskIdSet.has(taskId)) {
      return;
    }

    if (entry.relatedTasks.some((relatedTask) => relatedTask.taskId === taskId)) {
      return;
    }

    entry.itemsByTaskId.delete(taskId);
    changed = true;
  });

  if (updateItems(entry)) {
    changed = true;
  }

  if (!entry.initialized) {
    entry.initialized = true;
    changed = true;
  }

  const nextHydratedAt = changed ? Date.now() : entry.lastHydratedAt;
  if (entry.lastHydratedAt !== nextHydratedAt) {
    entry.lastHydratedAt = nextHydratedAt;
    changed = true;
  }

  if (!changed) {
    return;
  }

  commit(entry);
}

function patchItem(input: PatchTaskHistoryItemInput): void {
  const entry = getOrCreateEntry(input.workflowId);
  const previous = entry.itemsByTaskId.get(input.taskId);
  if (!previous) {
    return;
  }

  const next = input.updater(previous);
  const merged = mergeListItem(previous, next);
  if (previous === merged) {
    return;
  }

  entry.itemsByTaskId.set(input.taskId, merged);
  updateItems(entry);
  commit(entry);
}

function upsertDetail(input: UpsertTaskHistoryDetailInput): void {
  const entry = getOrCreateEntry(input.workflowId);
  let changed = false;

  const summary = createTaskHistorySummaryItem(input.detail);
  const previous = entry.itemsByTaskId.get(input.detail.taskId);
  const merged = mergeListItem(previous, summary);
  if (previous !== merged) {
    entry.itemsByTaskId.set(input.detail.taskId, merged);
    changed = true;
  }

  if (entry.detailsByTaskId.get(input.detail.taskId) !== input.detail) {
    entry.detailsByTaskId.set(input.detail.taskId, input.detail);
    changed = true;
  }

  if (updateItems(entry)) {
    changed = true;
  }

  const nextHydratedAt = changed ? Date.now() : entry.lastHydratedAt;
  if (entry.lastHydratedAt !== nextHydratedAt) {
    entry.lastHydratedAt = nextHydratedAt;
    changed = true;
  }

  if (!changed) {
    return;
  }

  commit(entry);
}

function setLoading(workflowId: string, loading: boolean): void {
  const entry = getOrCreateEntry(workflowId);
  if (entry.loading === loading) {
    return;
  }

  entry.loading = loading;
  commit(entry);
}

function getSnapshot(workflowId?: string | null): CanvasTaskHistorySnapshot {
  if (!workflowId) {
    return EMPTY_SNAPSHOT;
  }

  return getOrCreateEntry(workflowId).snapshot;
}

function getTaskDetail(workflowId: string | null | undefined, taskId: string): TaskHistoryDetail | undefined {
  if (!workflowId) {
    return undefined;
  }

  return getOrCreateEntry(workflowId).detailsByTaskId.get(taskId);
}

function clear(workflowId?: string | null): void {
  if (!workflowId) {
    if (entries.size === 0) {
      return;
    }

    entries.clear();
    emit();
    return;
  }

  if (!entries.delete(workflowId)) {
    return;
  }

  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export const canvasTaskHistoryStore = {
  subscribe,
  getSnapshot,
  getTaskDetail,
  upsertSkeleton,
  replaceItems,
  patchItem,
  upsertDetail,
  setLoading,
  clear,
};
