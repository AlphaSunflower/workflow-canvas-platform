import {
  appendResolvedTaskOutputs,
  createRuntimeOutputSnapshot,
} from '@/nodes/shared/runtime';
import type { FileNodeData, Workflow } from '@/types';
import type { ExecutionOutputRuntimeResource } from '@/services/execution-output-runtime-sync';
import {
  buildExecutionOutputCommitFingerprint,
  executionOutputCommitCache as defaultExecutionOutputCommitCache,
  type ExecutionOutputCommitCache,
} from './execution-output-commit.cache';
import type {
  ExecutionOutputCommitCustomHandlerResult,
  ExecutionOutputCommitCacheEntry,
  ExecutionOutputCommitPreparedOutput,
  ExecutionOutputCommitRequest,
  ExecutionOutputCommitResolvedRequest,
  ExecutionOutputCommitResult,
  ExecutionOutputCommitWorkflowOutputState,
} from './execution-output-commit.types';
import type {
  ExecutionRuntimePatch,
  ExecutionRuntimeRunState,
} from './execution-runtime.types';
import type {
  ExecutionRuntimeNodeExecutionOutput,
  ExecutionRuntimeNodeExecutionTarget,
} from './node-execution.types';
import {
  executionRuntimeStore as defaultExecutionRuntimeStore,
  type ExecutionRuntimeStore,
} from './execution-runtime.store';

const DEFAULT_APPEND_OPTIONS = {
  gapX: 180,
  gapY: 180,
  columns: 1,
} satisfies NonNullable<ExecutionOutputCommitRequest['appendOptions']>;

function resolveCommittedWorkflowOutputState(
  workflow: Workflow | null,
  sourceNodeId: string,
  fileId: string,
  sourceHandle?: string,
): ExecutionOutputCommitWorkflowOutputState {
  const emptyState: ExecutionOutputCommitWorkflowOutputState = {
    sourceNodeId,
    resultFileId: fileId,
    sourceHandle,
    hasSourceOutput: false,
    matchedNodeIds: [],
    linkedMatchedNodeIds: [],
    relevantConnectionIds: [],
    brokenConnectionIds: [],
    isCommitted: false,
  };

  if (!workflow) {
    return emptyState;
  }

  const sourceNode = workflow.nodes[sourceNodeId];
  const hasSourceOutput = Boolean(
    sourceNode
    && 'outputs' in sourceNode
    && Array.isArray(sourceNode.outputs)
    && sourceNode.outputs.includes(fileId),
  );
  const matchedNodeIds = Object.values(workflow.nodes)
    .filter((node) => 'fileId' in node && (node as FileNodeData).fileId === fileId)
    .map((node) => node.id.value);
  const relevantConnections = workflow.connections
    .filter((connection) => (
      connection.type === 'output-link'
      && connection.sourceId === sourceNodeId
      && connection.sourceHandle === sourceHandle
    ));
  const linkedMatchedNodeIds = relevantConnections
    .map((connection) => connection.targetId)
    .filter((targetId) => matchedNodeIds.includes(targetId));
  const brokenConnectionIds = relevantConnections
    .filter((connection) => !matchedNodeIds.includes(connection.targetId))
    .map((connection) => connection.id);

  return {
    sourceNodeId,
    resultFileId: fileId,
    sourceHandle,
    hasSourceOutput,
    matchedNodeIds,
    linkedMatchedNodeIds,
    relevantConnectionIds: relevantConnections.map((connection) => connection.id),
    brokenConnectionIds,
    isCommitted: hasSourceOutput && linkedMatchedNodeIds.length > 0,
  };
}

function hasCommittedFileNode(
  workflow: Workflow | null,
  sourceNodeId: string,
  fileId: string,
  sourceHandle?: string,
): boolean {
  return resolveCommittedWorkflowOutputState(
    workflow,
    sourceNodeId,
    fileId,
    sourceHandle,
  ).isCommitted;
}

async function isOutputCommitted<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
>(
  workflow: Workflow | null,
  request: ExecutionOutputCommitRequest<TRequest, TTarget>,
  output: ExecutionRuntimeNodeExecutionOutput,
): Promise<boolean> {
  const adapterCommitted = await request.adapter.isOutputCommitted?.({
    workflow,
    node: request.node,
    snapshot: request.snapshot,
    payload: request.payload,
    output,
    adapterContext: request.adapterContext,
    workflowAccess: request.workflowAccess,
  });

  if (typeof adapterCommitted === 'boolean') {
    return adapterCommitted;
  }

  return hasCommittedFileNode(
    workflow,
    request.node.id.value,
    output.resultFileId,
    output.sourceHandle,
  );
}

function resolveLatestCommitNode<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
>(
  workflow: Workflow,
  request: ExecutionOutputCommitRequest<TRequest, TTarget>,
): typeof request.node {
  const latestNode = workflow.nodes[request.node.id.value];
  if (
    latestNode
    && !('fileId' in latestNode)
    && latestNode.type === request.node.type
  ) {
    return latestNode as typeof request.node;
  }

  return request.node;
}

function shouldTreatCacheEntryAsCommitted<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
>(
  workflow: Workflow | null,
  request: ExecutionOutputCommitRequest<TRequest, TTarget>,
  output: ExecutionRuntimeNodeExecutionOutput,
  cacheEntry: ExecutionOutputCommitCacheEntry | null,
): Promise<boolean> {
  if (!cacheEntry) {
    return Promise.resolve(false);
  }

  return isOutputCommitted(workflow, request, output);
}

async function collectCommittedTaskIds<
  TRequest = unknown,
  TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
>(
  workflow: Workflow | null,
  request: ExecutionOutputCommitRequest<TRequest, TTarget>,
  outputs: ReadonlyArray<ExecutionRuntimeNodeExecutionOutput>,
): Promise<Set<string>> {
  const committedTaskIds = new Set<string>();

  await Promise.all(outputs.map(async (output) => {
    if (await isOutputCommitted(workflow, request, output)) {
      committedTaskIds.add(output.taskId);
    }
  }));

  return committedTaskIds;
}

function isWorkflowOutputStateBroken(state: ExecutionOutputCommitWorkflowOutputState): boolean {
  return !state.isCommitted && (
    state.hasSourceOutput
    || state.matchedNodeIds.length > 0
    || state.relevantConnectionIds.length > 0
  );
}

function buildReadyPatches(
  run: ExecutionRuntimeRunState,
  readyTaskIds: Set<string>,
): ExecutionRuntimePatch[] {
  if (readyTaskIds.size === 0) {
    return [];
  }

  const runTasks = run.tasks.map((task) => (
    readyTaskIds.has(task.taskId)
      ? {
        ...task,
        resultCommitStatus: 'ready' as const,
        resultCommittedAt: null,
        resultCommitError: null,
        isOutputCommitted: false,
      }
      : task
  ));

  const patches: ExecutionRuntimePatch[] = [{
    kind: 'run',
    runId: run.runId,
    next: {
      tasks: runTasks,
      allOutputsCommitted: false,
    },
  }];

  run.tasks.forEach((task) => {
    if (!readyTaskIds.has(task.taskId)) {
      return;
    }

    patches.push({
      kind: 'task',
      runId: run.runId,
      taskId: task.taskId,
      next: {
        resultCommitStatus: 'ready',
        resultCommittedAt: null,
        resultCommitError: null,
        isOutputCommitted: false,
      },
    });

    if (run.nodeId) {
      patches.push({
        kind: 'group',
        nodeId: run.nodeId,
        groupId: task.groupId,
        next: {
          resultCommitStatus: 'ready',
          resultCommittedAt: null,
          isOutputCommitted: false,
        },
      });
    }
  });

  if (run.nodeId) {
    patches.push({
      kind: 'node',
      nodeId: run.nodeId,
      next: {
        resultCommitStatus: 'ready',
        resultCommittedAt: null,
        isOutputCommitted: false,
      },
    });
  }

  return patches;
}

function buildCommittedPatches(
  run: ExecutionRuntimeRunState,
  committedTaskIds: Set<string>,
): ExecutionRuntimePatch[] {
  if (committedTaskIds.size === 0) {
    return [];
  }

  const committedAt = Date.now();
  const runTasks = run.tasks.map((task) => (
    committedTaskIds.has(task.taskId)
      ? {
        ...task,
        resultCommitStatus: 'committed' as const,
        resultCommittedAt: committedAt,
        resultCommitError: null,
        isOutputCommitted: true,
      }
      : task
  ));

  const runPatches: ExecutionRuntimePatch[] = [{
    kind: 'run',
    runId: run.runId,
    next: {
      tasks: runTasks,
      allOutputsCommitted: runTasks
        .filter((task) => task.canCommitOutput)
        .every((task) => task.isOutputCommitted || committedTaskIds.has(task.taskId)),
    },
  }];

  run.tasks.forEach((task) => {
    if (!committedTaskIds.has(task.taskId)) {
      return;
    }

    runPatches.push({
      kind: 'task',
      runId: run.runId,
      taskId: task.taskId,
      next: {
        resultCommitStatus: 'committed',
        resultCommittedAt: committedAt,
        resultCommitError: null,
        isOutputCommitted: true,
      },
    });

    if (run.nodeId) {
      runPatches.push({
        kind: 'group',
        nodeId: run.nodeId,
        groupId: task.groupId,
        next: {
          resultCommitStatus: 'committed',
          resultCommittedAt: committedAt,
          isOutputCommitted: true,
        },
      });
    }
  });

  if (run.nodeId) {
    const readyTasks = run.tasks.filter((task) => task.canCommitOutput);
    const committedReadyTaskCount = readyTasks.filter((task) =>
      task.isOutputCommitted || committedTaskIds.has(task.taskId)
    ).length;

    runPatches.push({
      kind: 'node',
      nodeId: run.nodeId,
      next: {
        resultCommitStatus: readyTasks.length > 0 && committedReadyTaskCount === readyTasks.length
          ? 'committed'
          : readyTasks.length > 0
            ? 'ready'
            : 'idle',
        resultCommittedAt: committedTaskIds.size > 0 ? committedAt : null,
        isOutputCommitted: readyTasks.length > 0 && committedReadyTaskCount === readyTasks.length,
      },
    });
  }

  return runPatches;
}

export class ExecutionOutputCommitService {
  private readonly cache: ExecutionOutputCommitCache;

  private readonly store: ExecutionRuntimeStore;

  constructor(options: {
    cache?: ExecutionOutputCommitCache;
    store?: ExecutionRuntimeStore;
  } = {}) {
    this.cache = options.cache ?? defaultExecutionOutputCommitCache;
    this.store = options.store ?? defaultExecutionRuntimeStore;
  }

  async commit<
    TRequest = unknown,
    TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
  >(request: ExecutionOutputCommitRequest<TRequest, TTarget>): Promise<ExecutionOutputCommitResult> {
    const mode = request.mode ?? 'incremental';
    if (mode === 'terminal-only' && !request.snapshot.isTerminal) {
      return {
        changed: false,
        committedCount: 0,
        skippedCount: 0,
        outputs: [],
      };
    }

    const currentWorkflow = request.workflowAccess.getCurrentWorkflow();
    if (!currentWorkflow) {
      return {
        changed: false,
        committedCount: 0,
        skippedCount: 0,
        outputs: [],
      };
    }

    const outputs = request.adapter.extractExecutionOutputs(request.snapshot, {
      workflowId: request.workflowId ?? request.snapshot.workflowId ?? null,
      nodeId: request.node.id.value,
      payload: request.payload,
      previousSnapshot: this.store.getRun(request.snapshot.runId),
    });

    if (outputs.length === 0) {
      return {
        changed: false,
        committedCount: 0,
        skippedCount: 0,
        outputs: [],
      };
    }

    const snapshotTaskMap = new Map(request.snapshot.tasks.map((task) => [task.taskId, task] as const));
    const alreadyCommittedTaskIds = await collectCommittedTaskIds(
      currentWorkflow,
      request,
      outputs,
    );
    const pendingOutputStates = await Promise.all(outputs.map(async (output) => {
      const task = snapshotTaskMap.get(output.taskId);
      if (alreadyCommittedTaskIds.has(output.taskId)) {
        return { output, pending: false };
      }

      if (
        (task?.isOutputCommitted || task?.resultCommitStatus === 'committed')
        && !(await isOutputCommitted(currentWorkflow, request, output))
      ) {
        return { output, pending: true };
      }

      if (task?.isOutputCommitted || task?.resultCommitStatus === 'committed') {
        return { output, pending: false };
      }

      const fingerprint = buildExecutionOutputCommitFingerprint({
        runId: output.runId,
        taskId: output.taskId,
        groupId: output.groupId ?? null,
        resultFileId: output.resultFileId,
      });

      if (await shouldTreatCacheEntryAsCommitted(
        currentWorkflow,
        request,
        output,
        this.cache.getByFingerprint(request.runId, fingerprint, request.workflowId),
      )) {
        return { output, pending: false };
      }

      return {
        output,
        pending: !(await isOutputCommitted(currentWorkflow, request, output)),
      };
    }));
    const pendingOutputs = pendingOutputStates
      .filter((item) => item.pending)
      .map((item) => item.output);

    if (pendingOutputs.length === 0) {
      const committedTaskIds = await collectCommittedTaskIds(
        currentWorkflow,
        request,
        outputs,
      );
      const patches = buildCommittedPatches(request.snapshot, committedTaskIds);
      if (patches.length > 0) {
        this.store.applyPatches(patches, {
          workflowId: request.workflowId ?? request.snapshot.workflowId ?? null,
          nodeId: request.node.id.value,
        });
      }

      const incompleteCommittedTaskIds = new Set(
        (await Promise.all(outputs
          .filter((output) => !committedTaskIds.has(output.taskId))
          .map(async (output) => {
            const committed = await isOutputCommitted(currentWorkflow, request, output);
            if (committed) {
              return null;
            }

            const state = resolveCommittedWorkflowOutputState(
              currentWorkflow,
              request.node.id.value,
              output.resultFileId,
              output.sourceHandle,
            );
            return isWorkflowOutputStateBroken(state) ? output.taskId : null;
          })))
          .filter((taskId): taskId is string => Boolean(taskId)),
      );
      const readyPatches = buildReadyPatches(request.snapshot, incompleteCommittedTaskIds);
      if (readyPatches.length > 0) {
        this.store.applyPatches(readyPatches, {
          workflowId: request.workflowId ?? request.snapshot.workflowId ?? null,
          nodeId: request.node.id.value,
        });
      }

      return {
        changed: false,
        committedCount: 0,
        skippedCount: outputs.length,
        outputs,
      };
    }

    const resolvedPendingOutputs: ExecutionOutputCommitPreparedOutput[] = request.adapter.commitExecutionOutputs
      ? pendingOutputs.map((output): ExecutionOutputCommitPreparedOutput => {
        const snapshotTask = snapshotTaskMap.get(output.taskId);
        return {
          output,
          fileInfo: output.resultFile ?? snapshotTask?.resultFileInfo ?? snapshotTask?.resultFile,
        };
      })
      : pendingOutputs
      .map((output): ExecutionOutputCommitPreparedOutput | null => {
        const snapshotTask = snapshotTaskMap.get(output.taskId);
        const fileInfo = output.resultFile ?? snapshotTask?.resultFileInfo ?? snapshotTask?.resultFile;
        if (!fileInfo) {
          return null;
        }

        return {
          output,
          fileInfo,
        };
      })
      .filter((item): item is ExecutionOutputCommitPreparedOutput => item !== null);

    if (resolvedPendingOutputs.length === 0) {
      return {
        changed: false,
        committedCount: 0,
        skippedCount: outputs.length - pendingOutputs.length,
        outputs,
      };
    }

    const resolvedOutputsWithRuntime: ExecutionOutputCommitPreparedOutput[] = resolvedPendingOutputs.map(({ output, fileInfo }) => {
      if (fileInfo) {
        void request.workflowAccess.prefetchExecutionOutputRuntimeResource?.(
          fileInfo,
          {
            signal: request.adapterContext.signal,
          },
        );
      }

      return {
        output,
        fileInfo,
        runtimeResource: null,
      };
    });
    let nextWorkflow: Workflow | null = currentWorkflow;
    let changed = false;
    if (request.adapter.commitExecutionOutputs) {
      const customCommitResult: ExecutionOutputCommitCustomHandlerResult = await request.adapter.commitExecutionOutputs({
        ...request,
        currentWorkflow,
        preparedOutputs: resolvedOutputsWithRuntime,
      });
      nextWorkflow = request.workflowAccess.getCurrentWorkflow();
      changed = customCommitResult.changed;
    } else {
      const commitReadyOutputs = resolvedOutputsWithRuntime.filter((item): item is ExecutionOutputCommitPreparedOutput & {
        output: ExecutionRuntimeNodeExecutionOutput;
        fileInfo: NonNullable<ExecutionOutputCommitPreparedOutput['fileInfo']>;
        runtimeResource: ExecutionOutputRuntimeResource | null;
      } => item.fileInfo !== undefined);
      if (commitReadyOutputs.length === 0) {
        return {
          changed: false,
          committedCount: 0,
          skippedCount: outputs.length - pendingOutputs.length,
          outputs,
        };
      }

      const writeBaseWorkflow = request.workflowAccess.getCurrentWorkflow() ?? currentWorkflow;
      const writeBaseNode = resolveLatestCommitNode(writeBaseWorkflow, request);
      const existingOutputCount = writeBaseWorkflow.connections.filter((connection) => (
        connection.type === 'output-link' && connection.sourceId === writeBaseNode.id.value
      )).length;

      const writeResult = appendResolvedTaskOutputs({
        workflow: writeBaseWorkflow,
        sourceNode: writeBaseNode,
        resolveFileUrl: request.workflowAccess.resolveFileUrl,
      }, commitReadyOutputs.map(({ output, fileInfo, runtimeResource }) => ({
        fileInfo,
        runtimeResource,
        sourceHandle: output.sourceHandle,
        order: output.groupOrder * 1000,
      })), {
        x: request.appendOptions?.x ?? (
          writeBaseNode.position.x
          + Math.max(
            typeof writeBaseNode.dimensions?.width === 'number' ? writeBaseNode.dimensions.width : 0,
            420,
          )
          + (request.appendOptions?.gapX ?? DEFAULT_APPEND_OPTIONS.gapX)
        ),
        y: request.appendOptions?.y ?? writeBaseNode.position.y,
        gapX: request.appendOptions?.gapX ?? DEFAULT_APPEND_OPTIONS.gapX,
        gapY: request.appendOptions?.gapY ?? DEFAULT_APPEND_OPTIONS.gapY,
        columns: request.appendOptions?.columns ?? DEFAULT_APPEND_OPTIONS.columns,
        startIndex: existingOutputCount,
        replaceExistingHandleSlot: false,
      });

      if (!writeResult) {
        return {
          changed: false,
          committedCount: 0,
          skippedCount: outputs.length - pendingOutputs.length,
          outputs,
        };
      }

      const runtimeSnapshot = createRuntimeOutputSnapshot(writeBaseWorkflow, writeResult);
      const runtimeOptions = {
        hydrateCanvas: true,
        hydrationReason: 'external-output',
      } as const;
      nextWorkflow = request.workflowAccess.applyRuntimeSnapshot(runtimeSnapshot, runtimeOptions);
      changed = true;
    }

    const committedAt = Date.now();
    const committedTaskIds = new Set<string>();
    const readyForReplayTaskIds = new Set<string>();
    await Promise.all(resolvedOutputsWithRuntime.map(async ({ output }) => {
      if (!(await isOutputCommitted(nextWorkflow, request, output))) {
        readyForReplayTaskIds.add(output.taskId);
        return;
      }

      const fingerprint = buildExecutionOutputCommitFingerprint({
        runId: output.runId,
        taskId: output.taskId,
        groupId: output.groupId ?? null,
        resultFileId: output.resultFileId,
      });

      committedTaskIds.add(output.taskId);
      this.cache.register({
        runId: output.runId,
        nodeId: output.nodeId,
        workflowId: request.workflowId ?? request.snapshot.workflowId ?? null,
        taskId: output.taskId,
        groupId: output.groupId ?? null,
        resultFileId: output.resultFileId,
        sourceHandle: output.sourceHandle,
        fingerprint,
        committedAt,
      });
    }));

    const patches = buildCommittedPatches(request.snapshot, committedTaskIds);
    if (patches.length > 0) {
      this.store.applyPatches(patches, {
        workflowId: request.workflowId ?? request.snapshot.workflowId ?? null,
        nodeId: request.node.id.value,
      });
    }
    const readyPatches = buildReadyPatches(request.snapshot, readyForReplayTaskIds);
    if (readyPatches.length > 0) {
      this.store.applyPatches(readyPatches, {
        workflowId: request.workflowId ?? request.snapshot.workflowId ?? null,
        nodeId: request.node.id.value,
      });
    }

    const result = {
      changed,
      committedCount: committedTaskIds.size,
      skippedCount: outputs.length - resolvedPendingOutputs.length + readyForReplayTaskIds.size,
      outputs,
    };

    return result;
  }

  commitResolved<
    TRequest = unknown,
    TTarget extends ExecutionRuntimeNodeExecutionTarget = ExecutionRuntimeNodeExecutionTarget,
  >(request: ExecutionOutputCommitResolvedRequest<TRequest, TTarget>): Promise<ExecutionOutputCommitResult> {
    return this.commit(request);
  }

  resetRun(runId: string, workflowId?: string | null): void {
    this.cache.resetRun(runId, workflowId);
  }

  resetWorkflow(workflowId?: string | null): void {
    this.cache.resetWorkflow(workflowId);
  }

  reset(): void {
    this.cache.reset();
  }
}

let globalExecutionOutputCommitService: ExecutionOutputCommitService | null = null;

export function createExecutionOutputCommitService(options: {
  cache?: ExecutionOutputCommitCache;
  store?: ExecutionRuntimeStore;
} = {}): ExecutionOutputCommitService {
  return new ExecutionOutputCommitService(options);
}

export function getExecutionOutputCommitService(): ExecutionOutputCommitService {
  if (!globalExecutionOutputCommitService) {
    globalExecutionOutputCommitService = createExecutionOutputCommitService();
  }

  return globalExecutionOutputCommitService;
}

export function setExecutionOutputCommitService(service: ExecutionOutputCommitService): void {
  globalExecutionOutputCommitService = service;
}

export const executionOutputCommitService = getExecutionOutputCommitService();
