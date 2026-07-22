import type { WorkflowRuntimeSnapshot, WorkflowRuntimeSyncOptions } from '@/contracts/workflow';
import type { AINodeData, FileNodeData, Workflow } from '@/types';
import { isAINodeData, isFileNodeData } from '@/utils';
import { getExecutionRuntimeNodeAdapter } from './node-execution-adapter.registry';
import { executionOutputCommitService, type ExecutionOutputCommitService } from './execution-output-commit.service';
import type { ExecutionOutputCommitWorkflowAccess } from './execution-output-commit.types';
import type {
  ExecutionRuntimePersistedTaskRef,
  ExecutionRuntimeGroupedNodeAdapter,
  ExecutionRuntimeSingleNodeAdapter,
} from './node-execution-adapter.types';
import type {
  ExecutionRuntimeGroupedNodeExecutionTarget,
  ExecutionRuntimeSingleNodeExecutionTarget,
} from './node-execution.types';
import type { BackendExecutionRunSnapshot } from '@/services/backendExecutionService';

function getPersistedExecutionTaskRefs(
  workflow: Workflow,
  node: AINodeData,
): ExecutionRuntimePersistedTaskRef[] {
  return [
    ...(Array.isArray(node.tasks) ? node.tasks : []),
    ...(workflow.metadata.relatedTasks ?? []).filter((task) => task.nodeId === node.id.value),
  ];
}

function getTaskRefIdentity(taskRef: ExecutionRuntimePersistedTaskRef): string {
  if (typeof taskRef.taskId === 'string' && taskRef.taskId.trim().length > 0) {
    return `task:${taskRef.taskId}`;
  }

  if (typeof taskRef.runId === 'string' && taskRef.runId.trim().length > 0) {
    return `run:${taskRef.runId}:${taskRef.groupId ?? 'node'}:${taskRef.outputHandle ?? 'result'}`;
  }

  if (typeof taskRef.runNo === 'string' && taskRef.runNo.trim().length > 0) {
    return `runNo:${taskRef.runNo}:${taskRef.groupId ?? 'node'}:${taskRef.outputHandle ?? 'result'}`;
  }

  return `group:${taskRef.groupId ?? 'node'}:${taskRef.outputHandle ?? 'result'}`;
}

function getPersistedTaskCreatedAt(taskRef: ExecutionRuntimePersistedTaskRef): number | null {
  const candidate = taskRef as ExecutionRuntimePersistedTaskRef & { createdAt?: unknown };
  return typeof candidate.createdAt === 'number' ? candidate.createdAt : null;
}

function getLatestPersistedExecutionTaskRefs(
  workflow: Workflow,
  node: AINodeData,
): ExecutionRuntimePersistedTaskRef[] {
  const refs = getPersistedExecutionTaskRefs(workflow, node).reduce<ExecutionRuntimePersistedTaskRef[]>((accumulator, taskRef) => {
    const identity = getTaskRefIdentity(taskRef);
    if (accumulator.some((item) => getTaskRefIdentity(item) === identity)) {
      return accumulator;
    }

    accumulator.push(taskRef);
    return accumulator;
  }, []);

  if (refs.length <= 1) {
    return refs;
  }

  const latestTaskRef = refs
    .slice()
    .sort((left, right) => {
      const leftCreatedAt = getPersistedTaskCreatedAt(left) ?? 0;
      const rightCreatedAt = getPersistedTaskCreatedAt(right) ?? 0;

      if (leftCreatedAt !== rightCreatedAt) {
        return rightCreatedAt - leftCreatedAt;
      }

      return getTaskRefIdentity(left).localeCompare(getTaskRefIdentity(right));
    })[0];

  if (!latestTaskRef) {
    return refs;
  }

  if (typeof latestTaskRef.runId === 'string' && latestTaskRef.runId.trim().length > 0) {
    return refs.filter((taskRef) => taskRef.runId === latestTaskRef.runId);
  }

  if (typeof latestTaskRef.runNo === 'string' && latestTaskRef.runNo.trim().length > 0) {
    return refs.filter((taskRef) => taskRef.runNo === latestTaskRef.runNo);
  }

  const latestTaskCreatedAt = getPersistedTaskCreatedAt(latestTaskRef);
  if (latestTaskCreatedAt !== null) {
    return refs.filter((taskRef) => getPersistedTaskCreatedAt(taskRef) === latestTaskCreatedAt);
  }

  return [latestTaskRef];
}

function getPersistedTaskRefOutputHandle(taskRef: ExecutionRuntimePersistedTaskRef): string {
  const outputHandle = typeof taskRef.outputHandle === 'string' ? taskRef.outputHandle.trim() : '';
  if (outputHandle.length > 0) {
    return outputHandle;
  }

  const groupId = typeof taskRef.groupId === 'string' ? taskRef.groupId.trim() : '';
  if (groupId.length > 0) {
    return `${groupId}:result`;
  }

  return 'result';
}

function getOutputLinkConnections(
  workflow: Workflow,
  nodeId: string,
) {
  return workflow.connections.filter((connection) => (
    connection.type === 'output-link'
    && connection.sourceId === nodeId
  ));
}

function findPersistedTaskRef(
  workflow: Workflow,
  node: AINodeData,
  snapshot: BackendExecutionRunSnapshot,
  task: BackendExecutionRunSnapshot['tasks'][number],
): ExecutionRuntimePersistedTaskRef | null {
  const refs = getPersistedExecutionTaskRefs(workflow, node);
  return refs.find((item) => item.taskId === task.taskId)
    ?? refs.find((item) => (
      item.runId === snapshot.runId
      && item.groupId === task.groupId
    ))
    ?? refs.find((item) => (
      item.runNo === snapshot.runNo
      && item.groupId === task.groupId
    ))
    ?? null;
}

function createGroupedTargetFromPersistedTask(
  node: AINodeData,
  task: BackendExecutionRunSnapshot['tasks'][number],
  taskRef: ExecutionRuntimePersistedTaskRef | null,
): ExecutionRuntimeGroupedNodeExecutionTarget {
  return {
    kind: 'group',
    nodeId: node.id.value,
    nodeType: node.type,
    groupId: task.groupId,
    groupOrder: taskRef?.groupOrder ?? task.groupOrder,
    groupLabel: taskRef?.groupLabel,
    outputHandle: taskRef?.outputHandle ?? (task.groupId ? `${task.groupId}:result` : undefined),
  };
}

function buildFallbackGroupedTargets(
  workflow: Workflow,
  node: AINodeData,
  snapshot: BackendExecutionRunSnapshot,
): ExecutionRuntimeGroupedNodeExecutionTarget[] {
  const persistedTaskRefs = getPersistedExecutionTaskRefs(workflow, node);
  const adapter = getExecutionRuntimeNodeAdapter(node.type);
  if (adapter?.executionKind === 'grouped' && typeof adapter.createReconcileTargets === 'function') {
    return adapter.createReconcileTargets({
      workflow,
      node,
      snapshot,
      persistedTaskRefs,
    });
  }

  return snapshot.tasks
    .filter((task) => task.status === 'completed' && task.resultFileId && task.groupId)
    .map((task) => createGroupedTargetFromPersistedTask(
      node,
      task,
      findPersistedTaskRef(workflow, node, snapshot, task),
    ));
}

function buildFallbackSingleTarget(node: AINodeData): ExecutionRuntimeSingleNodeExecutionTarget[] {
  return [{
    kind: 'single',
    nodeId: node.id.value,
    nodeType: node.type,
    outputHandle: 'result',
    order: 0,
  }];
}

function hasLinkedResultNode(
  workflow: Workflow,
  node: AINodeData,
  resultFileId: string,
): boolean {
  return workflow.connections.some((connection) => {
    if (connection.type !== 'output-link' || connection.sourceId !== node.id.value) {
      return false;
    }

    const targetNode = workflow.nodes[connection.targetId];
    return Boolean(targetNode && isFileNodeData(targetNode) && targetNode.fileId === resultFileId);
  });
}

async function hasCommittedOutput(
  workflow: Workflow,
  node: AINodeData,
  snapshot: BackendExecutionRunSnapshot,
  task: BackendExecutionRunSnapshot['tasks'][number],
  workflowAccess: ExecutionOutputCommitWorkflowAccess,
): Promise<boolean> {
  const adapter = getExecutionRuntimeNodeAdapter(node.type);
  if (!task.resultFileId) {
    return false;
  }

  if (!adapter) {
    return node.outputs.includes(task.resultFileId)
      && hasLinkedResultNode(workflow, node, task.resultFileId);
  }

  const adapterContext = {
    workflowId: workflow.id,
    workflow,
    node,
    nodeTitle: node.id.display,
    inputs: [],
    resolvedInputGroups: [],
    services: {
      resolveFileUrl: workflowAccess.resolveFileUrl,
    },
  };
  const groupedTargets = adapter.executionKind === 'grouped'
    ? buildFallbackGroupedTargets(workflow, node, snapshot)
    : [];
  const groupedTarget = groupedTargets.find((target) => target.groupId === task.groupId);
  const persistedTaskRefs = getPersistedExecutionTaskRefs(workflow, node);
  const output = adapter.normalizeReconcileOutput?.({
    output: {
      nodeId: node.id.value,
      runId: snapshot.runId,
      taskId: task.taskId,
      taskType: findPersistedTaskRef(workflow, node, snapshot, task)?.taskType,
      resultFileId: task.resultFileId,
      groupId: task.groupId,
      groupOrder: groupedTarget?.groupOrder ?? task.groupOrder,
      sourceHandle: groupedTarget?.outputHandle ?? (task.groupId ? `${task.groupId}:result` : 'result'),
      resultFile: task.resultFileInfo ?? task.resultFile,
    },
    workflow,
    node,
    snapshot,
    persistedTaskRefs,
  }) ?? {
    nodeId: node.id.value,
    runId: snapshot.runId,
    taskId: task.taskId,
    taskType: findPersistedTaskRef(workflow, node, snapshot, task)?.taskType,
    resultFileId: task.resultFileId,
    groupId: task.groupId,
    groupOrder: groupedTarget?.groupOrder ?? task.groupOrder,
    sourceHandle: groupedTarget?.outputHandle ?? (task.groupId ? `${task.groupId}:result` : 'result'),
    resultFile: task.resultFileInfo ?? task.resultFile,
  };
  const adapterCommitted = adapter.executionKind === 'grouped'
    ? await (adapter as ExecutionRuntimeGroupedNodeAdapter<unknown>).isOutputCommitted?.({
      workflow,
      node,
      snapshot,
      payload: {
        nodeId: node.id.value,
        nodeType: node.type,
        nodeTitle: node.id.display,
        taskType: adapter.taskType,
        executionKind: 'grouped',
        request: undefined,
        targets: groupedTargets,
      },
      output,
      adapterContext,
      workflowAccess,
    })
    : await (adapter as ExecutionRuntimeSingleNodeAdapter<unknown>).isOutputCommitted?.({
      workflow,
      node,
      snapshot,
      payload: {
        nodeId: node.id.value,
        nodeType: node.type,
        nodeTitle: node.id.display,
        taskType: adapter.taskType,
        executionKind: 'single',
        request: undefined,
        targets: buildFallbackSingleTarget(node),
      },
      output,
      adapterContext,
      workflowAccess,
    });

  if (typeof adapterCommitted === 'boolean') {
    return adapterCommitted;
  }

  return node.outputs.includes(task.resultFileId)
    && hasLinkedResultNode(workflow, node, task.resultFileId);
}

export async function shouldReconcileNodeOutputs(
  workflow: Workflow,
  node: AINodeData,
  snapshot: BackendExecutionRunSnapshot,
  options?: {
    resolveFileUrl?: (fileId: string) => string;
  },
): Promise<boolean> {
  const completedTasks = snapshot.tasks.filter((task) => (
    task.status === 'completed'
    && typeof task.resultFileId === 'string'
    && task.resultFileId.length > 0
  ));

  if (completedTasks.length === 0) {
    return false;
  }

  const workflowAccess: ExecutionOutputCommitWorkflowAccess = {
    getCurrentWorkflow: () => workflow,
    applyRuntimeSnapshot: () => workflow,
    resolveFileUrl: options?.resolveFileUrl ?? ((fileId: string): string => fileId),
  };
  const committedFlags = await Promise.all(completedTasks.map((task) => (
    hasCommittedOutput(workflow, node, snapshot, task, workflowAccess)
  )));

  return committedFlags.some((committed) => !committed);
}

export function hasLocallyIncompleteReconcileOutputs(
  workflow: Workflow,
  node: AINodeData,
): boolean {
  const latestTaskRefs = getLatestPersistedExecutionTaskRefs(workflow, node);
  if (latestTaskRefs.length === 0) {
    return false;
  }

  const outputConnections = getOutputLinkConnections(workflow, node.id.value);
  if (node.outputs.length === 0 || outputConnections.length === 0) {
    return true;
  }

  const outputFileIds = new Set(
    node.outputs
      .filter((fileId): fileId is string => typeof fileId === 'string' && fileId.trim().length > 0),
  );
  const linkedFileIds = new Set<string>();
  const linkedOutputHandles = new Set<string>();

  for (const connection of outputConnections) {
    if (typeof connection.sourceHandle === 'string' && connection.sourceHandle.trim().length > 0) {
      linkedOutputHandles.add(connection.sourceHandle);
    }

    const targetNode = workflow.nodes[connection.targetId];
    if (!targetNode || !isFileNodeData(targetNode) || typeof targetNode.fileId !== 'string' || targetNode.fileId.trim().length === 0) {
      return true;
    }

    linkedFileIds.add(targetNode.fileId);
  }

  if (linkedFileIds.size === 0) {
    return true;
  }

  for (const fileId of outputFileIds) {
    if (!linkedFileIds.has(fileId)) {
      return true;
    }
  }

  for (const fileId of linkedFileIds) {
    if (!outputFileIds.has(fileId)) {
      return true;
    }
  }

  if (outputFileIds.size < latestTaskRefs.length || linkedFileIds.size < latestTaskRefs.length) {
    return true;
  }

  const expectedOutputHandles = new Set(latestTaskRefs.map(getPersistedTaskRefOutputHandle));
  for (const outputHandle of expectedOutputHandles) {
    if (!linkedOutputHandles.has(outputHandle)) {
      return true;
    }
  }

  return false;
}

export async function reconcileExecutionOutputs(params: {
  workflow: Workflow;
  node: AINodeData;
  snapshot: BackendExecutionRunSnapshot;
  resolveFileUrl: (fileId: string) => string;
  getCurrentWorkflow?: () => Workflow | null;
  applyRuntimeSnapshot: (
    runtime: WorkflowRuntimeSnapshot,
    options?: WorkflowRuntimeSyncOptions,
  ) => Workflow | null;
  commitService?: ExecutionOutputCommitService;
}): Promise<boolean> {
  const adapter = getExecutionRuntimeNodeAdapter(params.node.type);
  if (!adapter) {
    return false;
  }

  const adapterContext = {
    workflowId: params.workflow.id,
    workflow: params.workflow,
    node: params.node,
    nodeTitle: params.node.id.display,
    inputs: [],
    resolvedInputGroups: [],
    services: {
      resolveFileUrl: params.resolveFileUrl,
    },
  };
  let currentWorkflow = params.getCurrentWorkflow?.() ?? params.workflow;
  const workflowAccess: ExecutionOutputCommitWorkflowAccess = {
    getCurrentWorkflow: () => params.getCurrentWorkflow?.() ?? currentWorkflow,
    applyRuntimeSnapshot: (
      runtime: WorkflowRuntimeSnapshot,
      options?: WorkflowRuntimeSyncOptions,
    ): Workflow | null => {
      const reconcileRuntimeSnapshotMeta = {
        ...(runtime.snapshotMeta ?? {}),
        ...(options?.runtimeSnapshotMeta ?? {}),
        source: 'execution-reconcile' as const,
        scope: 'output-reconcile' as const,
      };
      const nextWorkflow = params.applyRuntimeSnapshot({
        ...runtime,
        snapshotMeta: reconcileRuntimeSnapshotMeta,
      }, {
        ...options,
        runtimeSnapshotMeta: reconcileRuntimeSnapshotMeta,
      });
      if (nextWorkflow) {
        currentWorkflow = nextWorkflow;
      }

      return nextWorkflow;
    },
    resolveFileUrl: params.resolveFileUrl,
  };
  const reconcileMode = 'incremental' as const;
  const commitService = params.commitService ?? executionOutputCommitService;

  const result = adapter.executionKind === 'grouped'
    ? await commitService.commit<unknown, ExecutionRuntimeGroupedNodeExecutionTarget>({
      workflowId: params.workflow.id,
      runId: params.snapshot.runId,
      node: params.node,
      snapshot: params.snapshot,
      payload: {
        nodeId: params.node.id.value,
        nodeType: params.node.type,
        nodeTitle: params.node.id.display,
        taskType: adapter.taskType,
        executionKind: 'grouped',
        request: undefined,
        targets: buildFallbackGroupedTargets(params.workflow, params.node, params.snapshot),
      },
      adapter: adapter as ExecutionRuntimeGroupedNodeAdapter<unknown>,
      adapterContext,
      workflowAccess,
      mode: reconcileMode,
    })
    : await commitService.commit<unknown, ExecutionRuntimeSingleNodeExecutionTarget>({
      workflowId: params.workflow.id,
      runId: params.snapshot.runId,
      node: params.node,
      snapshot: params.snapshot,
      payload: {
        nodeId: params.node.id.value,
        nodeType: params.node.type,
        nodeTitle: params.node.id.display,
        taskType: adapter.taskType,
        executionKind: 'single',
        request: undefined,
        targets: buildFallbackSingleTarget(params.node),
      },
      adapter: adapter as ExecutionRuntimeSingleNodeAdapter<unknown>,
      adapterContext,
      workflowAccess,
      mode: reconcileMode,
    });

  return result.changed && result.committedCount > 0;
}

export function getReconciliableExecutionNodes(workflow: Workflow): AINodeData[] {
  const relatedNodeIds = new Set<string>([
    ...Object.values(workflow.nodes)
      .filter((node): node is AINodeData => isAINodeData(node))
      .filter((node) => node.tasks.length > 0)
      .map((node) => node.id.value),
    ...(workflow.metadata.relatedTasks ?? []).map((task) => task.nodeId),
  ]);

  return Object.values(workflow.nodes)
    .filter((node): node is AINodeData => isAINodeData(node))
    .filter((node) => getExecutionRuntimeNodeAdapter(node.type) !== null)
    .filter((node) => relatedNodeIds.has(node.id.value));
}

export function getReconcileExecutionNodeIds(workflow: Workflow): string[] {
  return getReconciliableExecutionNodes(workflow)
    .map((node) => node.id.value)
    .sort((left, right) => left.localeCompare(right));
}

export function getLocallyIncompleteReconcileExecutionNodes(workflow: Workflow): AINodeData[] {
  return getReconciliableExecutionNodes(workflow)
    .filter((node) => hasLocallyIncompleteReconcileOutputs(workflow, node));
}

export function getLocallyIncompleteReconcileExecutionNodeIds(workflow: Workflow): string[] {
  return getLocallyIncompleteReconcileExecutionNodes(workflow)
    .map((node) => node.id.value)
    .sort((left, right) => left.localeCompare(right));
}

export function canReconcileWorkflowExecutions(workflow: Workflow | null | undefined): boolean {
  if (!workflow?.id) {
    return false;
  }

  return typeof workflow.version === 'number' && typeof workflow.ownerUserId === 'string';
}

export function findExistingOutputNodeByFileId(
  workflow: Workflow,
  fileId: string,
): FileNodeData | null {
  return Object.values(workflow.nodes).find((node): node is FileNodeData => (
    isFileNodeData(node) && node.fileId === fileId
  )) ?? null;
}
