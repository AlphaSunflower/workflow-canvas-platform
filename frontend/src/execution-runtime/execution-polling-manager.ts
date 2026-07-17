import type { AppError } from '@/types';
import { backendExecutionService } from '@/services/backendExecutionService';
import {
  executionRuntimeStore as defaultExecutionRuntimeStore,
  type ExecutionRuntimeStore,
} from './execution-runtime.store';
import type {
  ExecutionPollingManagerOptions,
  ExecutionPollingTaskHandle,
  ExecutionPollingTaskOptions,
  ExecutionPollingTaskState,
} from './execution-polling.types';
import type { ExecutionRuntimeRunState } from './execution-runtime.types';
import {
  buildExecutionRuntimePatchesFromSnapshot,
  isExecutionRunSnapshotTerminal,
  mergeAbortSignals,
  normalizeExecutionRunSnapshot,
  sleepWithSignal,
} from './execution-polling.utils';

const DEFAULT_POLLING_INTERVAL_MS = 1500;

interface InternalPollingTask {
  handle: ExecutionPollingTaskHandle;
  controller: AbortController;
  taskState: ExecutionPollingTaskState;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class ExecutionPollingManager {
  private readonly store: ExecutionRuntimeStore;

  private readonly defaultIntervalMs: number;

  private readonly tasks = new Map<string, InternalPollingTask>();

  constructor(options: ExecutionPollingManagerOptions = {}) {
    this.store = options.store ?? defaultExecutionRuntimeStore;
    this.defaultIntervalMs = options.defaultIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;
  }

  start(options: ExecutionPollingTaskOptions): ExecutionPollingTaskHandle {
    const existing = this.tasks.get(options.runId);
    if (existing) {
      return existing.handle;
    }

    const controller = new AbortController();
    const mergedSignal = mergeAbortSignals(controller.signal, options.signal);
    const intervalMs = options.config?.intervalMs ?? this.defaultIntervalMs;
    const taskState: ExecutionPollingTaskState = {
      runId: options.runId,
      workflowId: options.workflowId ?? null,
      nodeId: options.nodeId ?? null,
      status: 'running',
      startedAt: Date.now(),
      lastPolledAt: null,
      intervalMs,
    };

    const stop = (): void => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };

    const promise = this.runLoop(options, taskState, mergedSignal)
      .finally(() => {
        this.tasks.delete(options.runId);
      });

    const handle: ExecutionPollingTaskHandle = {
      state: taskState,
      promise,
      stop,
      signal: mergedSignal,
    };

    this.tasks.set(options.runId, {
      handle,
      controller,
      taskState,
    });

    return handle;
  }

  stop(runId: string): void {
    this.tasks.get(runId)?.handle.stop();
  }

  stopAll(): void {
    Array.from(this.tasks.keys()).forEach((runId) => this.stop(runId));
  }

  getTask(runId: string): ExecutionPollingTaskHandle | null {
    return this.tasks.get(runId)?.handle ?? null;
  }

  hasTask(runId: string): boolean {
    return this.tasks.has(runId);
  }

  private async runLoop(
    options: ExecutionPollingTaskOptions,
    taskState: ExecutionPollingTaskState,
    signal: AbortSignal,
  ): Promise<ExecutionRuntimeRunState> {
    try {
      while (!signal.aborted && taskState.status === 'running') {
        const previousSnapshot = this.store.getRun(options.runId);
        const snapshot = normalizeExecutionRunSnapshot(
          await backendExecutionService.getExecutionRun(options.runId, signal),
          {
            workflowId: options.workflowId,
            nodeId: options.nodeId,
          },
          previousSnapshot,
        );

        taskState.lastPolledAt = Date.now();
        const patches = options.mapSnapshotToPatches
          ? options.mapSnapshotToPatches(snapshot, previousSnapshot)
          : buildExecutionRuntimePatchesFromSnapshot(previousSnapshot, snapshot, {
            workflowId: options.workflowId,
            nodeId: options.nodeId,
          });
        this.store.applyPatches(patches, {
          workflowId: options.workflowId,
          nodeId: options.nodeId,
        });
        const applyResult = this.store.applyRunSnapshot(snapshot);
        options.onSnapshot?.(snapshot, applyResult);

        if (isExecutionRunSnapshotTerminal(snapshot)) {
          taskState.status = 'completed';
          options.onCompleted?.(snapshot);
          options.onStopped?.('completed');
          return snapshot;
        }

        await sleepWithSignal(taskState.intervalMs, signal);
      }

      if (signal.aborted) {
        throw new DOMException('Execution polling aborted.', 'AbortError');
      }

      throw new Error('Execution polling stopped before reaching a terminal snapshot.');
    } catch (error) {
      if (isAbortError(error)) {
        taskState.status = 'cancelled';
        options.onStopped?.(signal.aborted ? 'aborted' : 'manual');
        throw error;
      }

      taskState.status = 'failed';
      options.onFailed?.(error as AppError | Error | DOMException | unknown);
      options.onStopped?.('failed');
      throw error;
    }
  }
}

let globalExecutionPollingManager: ExecutionPollingManager | null = null;

export function createExecutionPollingManager(options: ExecutionPollingManagerOptions = {}): ExecutionPollingManager {
  return new ExecutionPollingManager(options);
}

export function getExecutionPollingManager(): ExecutionPollingManager {
  if (!globalExecutionPollingManager) {
    globalExecutionPollingManager = createExecutionPollingManager();
  }

  return globalExecutionPollingManager;
}

export function setExecutionPollingManager(manager: ExecutionPollingManager): void {
  globalExecutionPollingManager = manager;
}

export const executionPollingManager = getExecutionPollingManager();
