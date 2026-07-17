import type { FileNodeData } from '@/types';
import type { EnsureBackendFilePurpose } from './backendFileService';
import {
  backendFileService,
  setBackendFileIdResolver,
} from './backendFileService';
import { fileManifestStore, fileResourceLeaseManager } from './file-resource';
import { hashWorkflowFile } from './workflow-upload-hash';
import type {
  WorkflowUploadEnsureOptions,
  WorkflowUploadEnqueueOptions,
  WorkflowUploadPriority,
  WorkflowUploadSchedulerConfig,
  WorkflowUploadSchedulerDependencies,
  WorkflowUploadTaskSnapshot,
} from './workflow-upload-scheduler.types';

interface QueueTask {
  key: string;
  node: FileNodeData;
  priority: WorkflowUploadPriority;
  status: WorkflowUploadTaskSnapshot['status'];
  progress: number;
  error: string | null;
  backendFileId: string | null;
  sha256: string | null;
  file?: File;
  filePromise?: Promise<File>;
  uploadLeaseId?: string;
  uploadLeasePurpose?: EnsureBackendFilePurpose;
  workflowId?: string | null;
  authScope?: string | null;
  execution?: QueueTaskExecution;
  updatedAt: number;
}

interface QueueTaskExecution {
  promise: Promise<string>;
  signal?: AbortSignal;
  purpose?: EnsureBackendFilePurpose;
  workflowId?: string | null;
  authScope?: string | null;
}

const DEFAULT_CONFIG: WorkflowUploadSchedulerConfig = {
  hashConcurrency: 2,
  uploadConcurrency: 2,
  taskWaitTimeoutMs: 30_000,
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

function createTimeoutError(message: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'TimeoutError');
  }

  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function waitForTaskSettlement(
  subscribe: (listener: () => void) => () => void,
  task: QueueTask,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      signal?.removeEventListener('abort', handleAbort);
    };

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const handleAbort = (): void => {
      settle(() => reject(new DOMException('The operation was aborted.', 'AbortError')));
    };

    unsubscribe = subscribe(() => {
      if (task.status === 'ready' || task.status === 'failed') {
        settle(resolve);
      }
    });

    timeoutId = setTimeout(() => {
      settle(() => reject(createTimeoutError(`Workflow upload task timed out while waiting for ${task.key}.`)));
    }, timeoutMs);

    signal?.addEventListener('abort', handleAbort, { once: true });

    if (task.status === 'ready' || task.status === 'failed') {
      settle(resolve);
    }
  });
}

function normalizeTaskKeyPart(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : '*';
}

function createTaskKey(
  node: Pick<FileNodeData, 'id' | 'fileId'>,
  workflowId?: string | null,
): string {
  return [
    normalizeTaskKeyPart(workflowId),
    node.id.value,
    node.fileId,
  ].map((part) => encodeURIComponent(part)).join('|');
}

function createNodeSnapshotKey(nodeId: string, workflowId?: string | null): string {
  return [
    normalizeTaskKeyPart(workflowId),
    nodeId,
  ].map((part) => encodeURIComponent(part)).join('|');
}

function createTaskSnapshot(task: QueueTask): WorkflowUploadTaskSnapshot {
  return {
    key: task.key,
    workflowId: task.workflowId ?? null,
    nodeId: task.node.id.value,
    localFileId: task.node.fileId,
    backendFileId: task.backendFileId,
    status: task.status,
    priority: task.priority,
    progress: task.progress,
    error: task.error,
    sha256: task.sha256,
    updatedAt: task.updatedAt,
  };
}

function createManifestKey(task: QueueTask): { workflowId?: string | null; nodeId: string; fileId: string } {
  return {
    workflowId: task.workflowId,
    nodeId: task.node.id.value,
    fileId: task.node.fileId,
  };
}

function createUploadLeaseKey(task: QueueTask): { workflowId?: string | null; nodeId: string; fileId: string; variant: 'original' } {
  return {
    workflowId: task.workflowId,
    nodeId: task.node.id.value,
    fileId: task.node.fileId,
    variant: 'original',
  };
}

function createTaskBindingScope(task: QueueTask): {
  workflowId?: string | null;
  authScope?: string | null;
} {
  return {
    workflowId: task.execution?.workflowId ?? task.workflowId,
    authScope: task.execution?.authScope ?? task.authScope,
  };
}

function isSameTaskScope(
  task: Pick<QueueTask, 'workflowId' | 'authScope'>,
  scope: { workflowId?: string | null; authScope?: string | null },
): boolean {
  return (task.workflowId ?? null) === (scope.workflowId ?? null)
    && (task.authScope ?? null) === (scope.authScope ?? null);
}

function syncTaskManifest(task: QueueTask): void {
  fileManifestStore.upsert({
    key: createManifestKey(task),
    backendFileId: task.backendFileId,
    status: task.status === 'waiting' || task.status === 'hashing' || task.status === 'registering'
      ? 'upload-pending'
      : task.status === 'uploading'
        ? 'uploading'
        : task.status === 'ready'
          ? 'backend-ready'
          : task.status === 'failed'
            ? 'missing'
            : undefined,
    hasLocalFile: Boolean(task.file),
    backendBinding: task.backendFileId
      ? {
        backendFileId: task.backendFileId,
        sha256: task.sha256 ?? '',
        size: task.file?.size ?? task.node.fileSize,
        updatedAt: task.updatedAt,
      }
      : undefined,
    lastError: task.error
      ? {
        message: task.error,
        source: 'workflow-upload-scheduler',
        at: task.updatedAt,
      }
      : null,
  });
}

function areTaskSnapshotsEqual(
  left: WorkflowUploadTaskSnapshot | undefined,
  right: WorkflowUploadTaskSnapshot | undefined
): boolean {
  if (!left || !right) {
    return false;
  }

  return left.key === right.key
    && left.nodeId === right.nodeId
    && left.localFileId === right.localFileId
    && left.backendFileId === right.backendFileId
    && left.status === right.status
    && left.priority === right.priority
    && left.progress === right.progress
    && left.error === right.error
    && left.sha256 === right.sha256
    && left.updatedAt === right.updatedAt;
}

const EMPTY_WORKFLOW_UPLOAD_TASK_SNAPSHOTS: WorkflowUploadTaskSnapshot[] = [];

class WorkflowUploadScheduler {
  private readonly config: WorkflowUploadSchedulerConfig;
  private readonly dependencies: WorkflowUploadSchedulerDependencies;
  private readonly tasks = new Map<string, QueueTask>();
  private readonly listeners = new Set<() => void>();
  private readonly nodeListeners = new Map<string, Set<() => void>>();
  private readonly hashQueue: QueueTask[] = [];
  private readonly uploadQueue: QueueTask[] = [];
  private snapshotCache: WorkflowUploadTaskSnapshot[] = [];
  private snapshotByNodeIdCache = new Map<string, WorkflowUploadTaskSnapshot[]>();
  private snapshotByWorkflowNodeIdCache = new Map<string, WorkflowUploadTaskSnapshot>();
  private snapshotByWorkflowIdCache = new Map<string | null, WorkflowUploadTaskSnapshot[]>();
  private changedNodeIds = new Set<string>();
  private activeHashCount = 0;
  private activeUploadCount = 0;

  constructor(
    dependencies: WorkflowUploadSchedulerDependencies,
    config: Partial<WorkflowUploadSchedulerConfig> = {},
  ) {
    this.dependencies = dependencies;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeNode(nodeId: string, listener: () => void): () => void;
  subscribeNode(nodeId: string, workflowId: string | null | undefined, listener: () => void): () => void;
  subscribeNode(
    nodeId: string,
    workflowIdOrListener: string | null | undefined | (() => void),
    maybeListener?: () => void,
  ): () => void {
    const workflowId = typeof workflowIdOrListener === 'function' ? undefined : workflowIdOrListener;
    const listener = typeof workflowIdOrListener === 'function' ? workflowIdOrListener : maybeListener;
    if (!listener) {
      return (): void => undefined;
    }

    const listenerKey = createNodeSnapshotKey(nodeId, workflowId);
    const bucket = this.nodeListeners.get(listenerKey) ?? new Set<() => void>();
    bucket.add(listener);
    this.nodeListeners.set(listenerKey, bucket);
    return () => {
      const current = this.nodeListeners.get(listenerKey);
      if (!current) {
        return;
      }

      current.delete(listener);
      if (current.size === 0) {
        this.nodeListeners.delete(listenerKey);
      }
    };
  }

  getSnapshot(nodeId?: string, workflowId?: string | null): WorkflowUploadTaskSnapshot[] {
    if (!nodeId) {
      if (workflowId !== undefined) {
        return this.snapshotByWorkflowIdCache.get(workflowId ?? null) ?? EMPTY_WORKFLOW_UPLOAD_TASK_SNAPSHOTS;
      }
      return this.snapshotCache;
    }

    if (workflowId !== undefined) {
      const snapshot = this.snapshotByWorkflowNodeIdCache.get(createNodeSnapshotKey(nodeId, workflowId));
      return snapshot ? [snapshot] : EMPTY_WORKFLOW_UPLOAD_TASK_SNAPSHOTS;
    }

    return this.snapshotByNodeIdCache.get(nodeId) ?? EMPTY_WORKFLOW_UPLOAD_TASK_SNAPSHOTS;
  }

  getNodeSnapshot(nodeId: string, workflowId?: string | null): WorkflowUploadTaskSnapshot | null {
    if (workflowId !== undefined) {
      return this.snapshotByWorkflowNodeIdCache.get(createNodeSnapshotKey(nodeId, workflowId)) ?? null;
    }

    return this.snapshotByNodeIdCache.get(nodeId)?.[0] ?? null;
  }

  enqueueNode(node: FileNodeData, options: WorkflowUploadEnqueueOptions = {}): void {
    const task = this.upsertTask(node, options.priority ?? 'normal', {
      workflowId: options.workflowId,
      authScope: options.authScope,
    });
    task.workflowId = options.workflowId;
    task.authScope = options.authScope;

    if (task.status === 'ready') {
      return;
    }

    if (task.status === 'uploading' || task.status === 'hashing' || task.status === 'registering') {
      return;
    }

    this.queueHashTask(task);
    this.pump();
  }

  async ensureReady(node: FileNodeData, options: WorkflowUploadEnsureOptions = {}): Promise<string> {
    const task = this.upsertTask(node, options.priority ?? 'high', {
      workflowId: options.workflowId,
      authScope: options.authScope,
    });
    task.workflowId = options.workflowId;
    task.authScope = options.authScope;
    if (task.status === 'ready' && task.backendFileId) {
      return task.backendFileId;
    }

    const shouldReplaceExecution = !task.execution
      || (
        options.signal
        && task.execution.signal !== options.signal
      );

    if (shouldReplaceExecution) {
      const trackedPromise = this.executeTask(task, options.signal).finally(() => {
        if (task.execution?.promise === trackedPromise) {
          task.execution = undefined;
        }
      });
      task.execution = {
        promise: trackedPromise,
        signal: options.signal,
        purpose: options.purpose,
        workflowId: options.workflowId,
        authScope: options.authScope,
      };
    } else if (options.priority === 'high') {
      this.bumpTaskPriority(task, 'high');
    }

    this.pump();
    if (!task.execution) {
      throw new Error('Workflow upload scheduler failed to create task execution state.');
    }
    return task.execution.promise;
  }

  private upsertTask(
    node: FileNodeData,
    priority: WorkflowUploadPriority,
    scope: { workflowId?: string | null; authScope?: string | null } = {},
  ): QueueTask {
    const key = createTaskKey(node, scope.workflowId);
    const existing = this.tasks.get(key);
    const cachedBinding = this.dependencies.getCachedBackendFileBinding(node, scope);
    const existingBackendFileId = node.backendFileId ?? cachedBinding?.backendFileId ?? null;

    if (existing) {
      const scopeChanged = !isSameTaskScope(existing, scope);
      existing.node = node;
      existing.workflowId = scope.workflowId;
      existing.authScope = scope.authScope;
      this.bumpTaskPriority(existing, priority);
      if (scopeChanged && !existingBackendFileId) {
        this.releaseTaskUploadLease(existing, { clearFile: true });
        existing.backendFileId = null;
        existing.sha256 = null;
        existing.status = 'waiting';
        existing.progress = 0;
        existing.error = null;
        existing.updatedAt = Date.now();
        this.markTaskChanged(existing);
        this.emit();
        return existing;
      }
      if (existing.status === 'ready' && existingBackendFileId && existing.backendFileId !== existingBackendFileId) {
        existing.backendFileId = existingBackendFileId;
        existing.sha256 = cachedBinding?.sha256 ?? existing.sha256;
        existing.updatedAt = Date.now();
        this.markTaskChanged(existing);
        this.emit();
      }
      return existing;
    }

    const task: QueueTask = {
      key,
      node,
      priority,
      status: existingBackendFileId ? 'ready' : 'waiting',
      progress: existingBackendFileId ? 100 : 0,
      error: null,
      backendFileId: existingBackendFileId,
      sha256: cachedBinding?.sha256 || null,
      updatedAt: Date.now(),
      workflowId: scope.workflowId,
      authScope: scope.authScope,
    };

    this.tasks.set(key, task);
    this.markTaskChanged(task);
    this.emit();
    return task;
  }

  private bumpTaskPriority(task: QueueTask, priority: WorkflowUploadPriority): void {
    if (task.priority === 'high' || priority === 'normal') {
      return;
    }

    task.priority = priority;
    task.updatedAt = Date.now();
    this.sortQueue(this.hashQueue);
    this.sortQueue(this.uploadQueue);
    this.markTaskChanged(task);
    this.emit();
  }

  private queueHashTask(task: QueueTask): void {
    if (!this.hashQueue.includes(task)) {
      this.hashQueue.push(task);
      this.sortQueue(this.hashQueue);
    }

    if (task.status === 'waiting' || task.status === 'failed') {
      task.status = 'waiting';
      task.progress = 0;
      task.error = null;
      task.updatedAt = Date.now();
      this.markTaskChanged(task);
      this.emit();
    }
  }

  private queueUploadTask(task: QueueTask): void {
    if (!this.uploadQueue.includes(task)) {
      this.uploadQueue.push(task);
      this.sortQueue(this.uploadQueue);
    }
  }

  private sortQueue(queue: QueueTask[]): void {
    queue.sort((left, right): number => {
      if (left.priority !== right.priority) {
        return left.priority === 'high' ? -1 : 1;
      }
      return left.updatedAt - right.updatedAt;
    });
  }

  private async executeTask(task: QueueTask, signal?: AbortSignal): Promise<string> {
    const existingFileId = await this.dependencies.resolveExistingBackendFileId(task.node, {
      signal,
      ...createTaskBindingScope(task),
    });
    if (existingFileId) {
      this.releaseTaskUploadLease(task);
      task.backendFileId = existingFileId;
      task.status = 'ready';
      task.progress = 100;
      task.error = null;
      task.updatedAt = Date.now();
      this.markTaskChanged(task);
      this.emit();
      return existingFileId;
    }

    if (task.status === 'waiting' || task.status === 'failed') {
      this.queueHashTask(task);
      this.pump();
    }

    while (task.status !== 'ready') {
      throwIfAborted(signal);

      if (task.status === 'failed') {
        throw new Error(task.error ?? 'Workflow upload failed.');
      }

      if (!task.execution) {
        throw new Error('Workflow upload scheduler lost task promise state.');
      }

      await waitForTaskSettlement(this.subscribe.bind(this), task, this.config.taskWaitTimeoutMs, signal);
    }

    if (!task.backendFileId) {
      throw new Error('Workflow upload scheduler marked task as ready without a backend file id.');
    }

    return task.backendFileId;
  }

  private pump(): void {
    while (this.activeHashCount < this.config.hashConcurrency) {
      const nextTask = this.hashQueue.shift();
      if (!nextTask) {
        break;
      }

      if (
        nextTask.status === 'ready'
        || nextTask.status === 'hashing'
        || nextTask.status === 'registering'
        || nextTask.status === 'uploading'
      ) {
        continue;
      }

      this.activeHashCount += 1;
      void this.runHashStage(nextTask).finally(() => {
        this.activeHashCount -= 1;
        this.pump();
      });
    }

    while (this.activeUploadCount < this.config.uploadConcurrency) {
      const nextTask = this.uploadQueue.shift();
      if (!nextTask) {
        break;
      }

      if (nextTask.status !== 'registering') {
        continue;
      }

      this.activeUploadCount += 1;
      void this.runRegisterStage(nextTask).finally(() => {
        this.activeUploadCount -= 1;
        this.pump();
      });
    }
  }

  private async runHashStage(task: QueueTask): Promise<void> {
    try {
      task.status = 'hashing';
      task.progress = Math.max(task.progress, 10);
      task.error = null;
      task.updatedAt = Date.now();
      this.markTaskChanged(task);
      this.emit();

      const file = await this.getTaskFile(task, task.execution?.signal);
      const sha256 = await this.dependencies.hashFile(file, task.execution?.signal);
      const cachedBackendFileId = this.dependencies.getCachedBackendFileIdBySha256(sha256);

      task.file = file;
      task.sha256 = sha256;
      task.updatedAt = Date.now();

      if (cachedBackendFileId) {
        task.backendFileId = cachedBackendFileId;
        task.status = 'ready';
        task.progress = 100;
        this.releaseTaskUploadLease(task);
        this.dependencies.cacheBackendFileBinding(task.node, {
          backendFileId: cachedBackendFileId,
          sha256,
          size: file.size,
          updatedAt: Date.now(),
        }, createTaskBindingScope(task));
        this.markTaskChanged(task);
        this.emit();
        return;
      }

      task.status = 'registering';
      task.progress = 45;
      this.queueUploadTask(task);
      this.markTaskChanged(task);
      this.emit();
    } catch (error) {
      this.releaseTaskUploadLease(task, {
        clearFile: true,
      });
      if (isAbortError(error)) {
        task.status = 'waiting';
        task.progress = 0;
        task.error = null;
      } else {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : 'Workflow file hash failed.';
      }
      task.updatedAt = Date.now();
      this.markTaskChanged(task);
      this.emit();
    }
  }

  private async runRegisterStage(task: QueueTask): Promise<void> {
    try {
      const file = await this.getTaskFile(task, task.execution?.signal);
      const sha256 = task.sha256 ?? await this.dependencies.hashFile(file, task.execution?.signal);
      const registerResult = await this.dependencies.registerBackendFile(task.node, file, sha256, task.execution?.signal);

      if (!registerResult.uploadRequired || !registerResult.uploadId) {
        const backendFileId = registerResult.fileId;
        task.backendFileId = backendFileId;
        task.status = 'ready';
        task.progress = 100;
        task.error = null;
        task.updatedAt = Date.now();
        this.releaseTaskUploadLease(task);
        this.dependencies.cacheBackendFileBinding(task.node, {
          backendFileId,
          sha256,
          size: file.size,
          updatedAt: task.updatedAt,
        }, createTaskBindingScope(task));
        this.dependencies.cacheBackendFileIdBySha256(sha256, backendFileId);
        this.markTaskChanged(task);
        this.emit();
        return;
      }

      task.status = 'uploading';
      task.progress = 70;
      task.updatedAt = Date.now();
      this.markTaskChanged(task);
      this.emit();

      const uploadResult = await this.dependencies.uploadBackendFile(registerResult.uploadId, file, task.execution?.signal);
      this.completeTask(task, uploadResult.fileId, sha256, file.size);
    } catch (error) {
      this.releaseTaskUploadLease(task, {
        clearFile: true,
      });
      task.status = isAbortError(error) ? 'waiting' : 'failed';
      task.progress = 0;
      task.error = isAbortError(error) ? null : (error instanceof Error ? error.message : 'Workflow file upload failed.');
      task.updatedAt = Date.now();
      this.markTaskChanged(task);
      this.emit();
    }
  }

  private completeTask(task: QueueTask, backendFileId: string, sha256: string, fileSize: number): void {
    task.backendFileId = backendFileId;
    task.status = 'ready';
    task.progress = 100;
    task.error = null;
    task.sha256 = sha256;
    task.updatedAt = Date.now();
    this.releaseTaskUploadLease(task);

    this.dependencies.cacheBackendFileBinding(task.node, {
      backendFileId,
      sha256,
      size: fileSize,
      updatedAt: task.updatedAt,
    }, createTaskBindingScope(task));
    this.dependencies.cacheBackendFileIdBySha256(sha256, backendFileId);
    this.markTaskChanged(task);
    this.emit();
  }

  private async getTaskFile(task: QueueTask, signal?: AbortSignal): Promise<File> {
    if (task.file) {
      return task.file;
    }

    const shouldReplaceFilePromise = !task.filePromise
      || (signal && task.execution?.signal === signal);

    if (shouldReplaceFilePromise) {
      this.acquireTaskUploadLease(task, task.execution?.purpose);
      task.filePromise = this.dependencies.getFileFromNode(task.node, {
        signal,
        workflowId: task.execution?.workflowId ?? task.workflowId,
        authScope: task.execution?.authScope ?? task.authScope,
      })
        .then((file) => {
          task.file = file;
          return file;
        })
        .finally(() => {
          task.filePromise = undefined;
        });
    }

    if (!task.filePromise) {
      throw new Error('Workflow upload scheduler failed to create file loading state.');
    }
    return task.filePromise;
  }

  private acquireTaskUploadLease(task: QueueTask, purpose: EnsureBackendFilePurpose = 'upload-input'): void {
    if (task.uploadLeaseId && task.uploadLeasePurpose === purpose) {
      return;
    }

    this.releaseTaskUploadLease(task);
    const lease = fileResourceLeaseManager.acquireLease(
      createUploadLeaseKey(task),
      purpose === 'prompt-reference' ? 'prompt-reference' : 'upload',
      `workflow-upload-scheduler:${purpose}:${task.key}`,
    );
    task.uploadLeaseId = lease.leaseId;
    task.uploadLeasePurpose = purpose;
  }

  private releaseTaskUploadLease(task: QueueTask, options: { clearFile?: boolean } = {}): void {
    if (task.uploadLeaseId) {
      fileResourceLeaseManager.releaseLease(task.uploadLeaseId);
      task.uploadLeaseId = undefined;
      task.uploadLeasePurpose = undefined;
    }

    if (options.clearFile) {
      task.file = undefined;
      task.filePromise = undefined;
    }
  }

  private emit(): void {
    const changedNodeKeys = Array.from(this.changedNodeIds);
    this.changedNodeIds.clear();
    this.refreshSnapshotCache();
    this.listeners.forEach((listener) => listener());
    changedNodeKeys.forEach((nodeKey) => {
      this.nodeListeners.get(nodeKey)?.forEach((listener) => listener());
    });
  }

  private refreshSnapshotCache(): void {
    const previousByWorkflowNodeId = this.snapshotByWorkflowNodeIdCache;
    const nextByNodeId = new Map<string, WorkflowUploadTaskSnapshot[]>();
    const nextByWorkflowNodeId = new Map<string, WorkflowUploadTaskSnapshot>();
    const nextByWorkflowId = new Map<string | null, WorkflowUploadTaskSnapshot[]>();
    const nextSnapshotCache = Array.from(this.tasks.values()).map((task) => {
      const nextSnapshot = createTaskSnapshot(task);
      const workflowNodeKey = createNodeSnapshotKey(nextSnapshot.nodeId, nextSnapshot.workflowId);
      const previousSnapshot = previousByWorkflowNodeId.get(workflowNodeKey);
      const stableSnapshot: WorkflowUploadTaskSnapshot = areTaskSnapshotsEqual(previousSnapshot, nextSnapshot)
        ? previousSnapshot ?? nextSnapshot
        : nextSnapshot;
      const nodeSnapshots = nextByNodeId.get(nextSnapshot.nodeId) ?? [];
      nodeSnapshots.push(stableSnapshot);
      nextByNodeId.set(nextSnapshot.nodeId, nodeSnapshots);
      const workflowSnapshots = nextByWorkflowId.get(nextSnapshot.workflowId) ?? [];
      workflowSnapshots.push(stableSnapshot);
      nextByWorkflowId.set(nextSnapshot.workflowId, workflowSnapshots);
      nextByWorkflowNodeId.set(workflowNodeKey, stableSnapshot);
      return stableSnapshot;
    });

    this.snapshotCache = nextSnapshotCache;
    this.snapshotByNodeIdCache = nextByNodeId;
    this.snapshotByWorkflowNodeIdCache = nextByWorkflowNodeId;
    this.snapshotByWorkflowIdCache = nextByWorkflowId;
    this.tasks.forEach((task) => syncTaskManifest(task));
  }

  private markTaskChanged(task: QueueTask): void {
    this.changedNodeIds.add(createNodeSnapshotKey(task.node.id.value, task.workflowId));
    this.changedNodeIds.add(createNodeSnapshotKey(task.node.id.value, undefined));
  }
}

function createDefaultDependencies(): WorkflowUploadSchedulerDependencies {
  return {
    getFileFromNode: backendFileService.getFileBlobFromNodeWithOptions,
    resolveExistingBackendFileId: backendFileService.resolveExistingBackendFileId,
    registerBackendFile: backendFileService.registerBackendFile,
    uploadBackendFile: backendFileService.uploadBackendFile,
    hashFile: hashWorkflowFile,
    getCachedBackendFileBinding: backendFileService.getCachedBackendFileBinding,
    cacheBackendFileBinding: backendFileService.cacheBackendFileBinding,
    getCachedBackendFileIdBySha256: backendFileService.getCachedBackendFileIdBySha256,
    cacheBackendFileIdBySha256: backendFileService.cacheBackendFileIdBySha256,
  };
}

export function createWorkflowUploadScheduler(
  dependencies: Partial<WorkflowUploadSchedulerDependencies> = {},
  config?: Partial<WorkflowUploadSchedulerConfig>,
): WorkflowUploadScheduler {
  return new WorkflowUploadScheduler({
    ...createDefaultDependencies(),
    ...dependencies,
  }, config);
}

export const workflowUploadScheduler = createWorkflowUploadScheduler();

setBackendFileIdResolver((node, options) => workflowUploadScheduler.ensureReady(node, {
  priority: 'high',
  signal: options?.signal,
  purpose: options?.purpose,
  workflowId: options?.workflowId,
}));

export { hashWorkflowFile } from './workflow-upload-hash';

export type {
  BackendFileRegisterResponse,
  BackendFileUploadResponse,
} from './backend-file-binding.contracts';
