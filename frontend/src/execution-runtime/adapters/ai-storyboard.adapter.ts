import type {
  FileInfo,
  NodeTaskRef,
  Workflow,
  WorkflowRelatedTaskRef,
} from '@/types';
import { isAINodeData, isFileNodeData } from '@/utils';
import {
  appendResolvedTaskOutputs,
  createRuntimeOutputSnapshot,
} from '@/nodes/shared/runtime';
import { AI_STORYBOARD_DEFAULT_SIZE } from '@/nodes/ai-storyboard/constants';
import {
  createAIStoryboardNodeActionOnlyExecutionRequest,
} from '@/nodes/ai-storyboard/runtime';
import {
  findMatchingStoryboardTaskRef,
  getStoryboardOutputHandleForGroupId,
  getStoryboardTaskTypeFromFileInfo,
  isStoryboardPersistedTaskRef,
  isStoryboardTaskType,
  normalizeStoryboardExecutionTargetIdentity,
  normalizeStoryboardTaskRefIdentity,
} from '@/nodes/ai-storyboard/storyboard-output-identity';
import type { ExecutionOutputCommitStateCheckRequest } from '../execution-output-commit.types';
import { createGroupedExecutionOutputAdapter } from '../execution-output-commit.adapters';
import { buildExecutionRuntimePatchesFromSnapshot } from '../execution-polling.utils';
import type {
  ExecutionRuntimeGroupedNodeAdapter,
  ExecutionRuntimePersistedTaskRef,
} from '../node-execution-adapter.types';
import { getAIStoryboardOutputHandle } from '@/nodes/ai-storyboard/groups';
import type {
  ExecutionRuntimeGroupedNodeExecutionTarget,
  ExecutionRuntimeNodeActionOnlyExecutionPayload,
  ExecutionRuntimeNodeExecutionOutput,
} from '../node-execution.types';

type StoryboardMediaKind = 'image' | 'video';

const groupedOutputAdapter = createGroupedExecutionOutputAdapter();
const STORYBOARD_OUTPUT_GAP_X = 180;
const LEGACY_STORYBOARD_OUTPUT_HANDLE = getAIStoryboardOutputHandle('group-1');

function resolveStoryboardMediaKind(fileInfo?: FileInfo): StoryboardMediaKind | null {
  if (!fileInfo) {
    return null;
  }

  if (fileInfo.fileType === 'image' || fileInfo.mimeType.startsWith('image/')) {
    return 'image';
  }

  if (fileInfo.fileType === 'video' || fileInfo.mimeType.startsWith('video/')) {
    return 'video';
  }

  return null;
}

type PersistedStoryboardTaskRef = Pick<
  NodeTaskRef | WorkflowRelatedTaskRef,
  'taskId' | 'runId' | 'runNo' | 'taskType' | 'groupId' | 'groupLabel' | 'groupOrder' | 'outputHandle'
>;

function getStoryboardTaskRefs(
  workflow: Workflow,
  node: ExecutionOutputCommitStateCheckRequest['node'],
): {
  nodeTaskRefs: PersistedStoryboardTaskRef[];
  relatedTaskRefs: PersistedStoryboardTaskRef[];
} {
  return {
    nodeTaskRefs: (Array.isArray(node.tasks) ? node.tasks : [])
      .map((taskRef) => normalizeStoryboardTaskRefIdentity(taskRef))
      .filter(isStoryboardPersistedTaskRef),
    relatedTaskRefs: (workflow.metadata.relatedTasks ?? [])
      .filter((task) => task.nodeId === node.id.value)
      .map((taskRef) => normalizeStoryboardTaskRefIdentity(taskRef))
      .filter(isStoryboardPersistedTaskRef),
  };
}

function findStoryboardTaskRef(
  taskRefs: readonly ExecutionRuntimePersistedTaskRef[],
  snapshot: { runId: string; runNo?: string },
  task: { taskId: string; groupId: string; taskType?: string },
): ExecutionRuntimePersistedTaskRef | null {
  return findMatchingStoryboardTaskRef(
    taskRefs.map((item) => normalizeStoryboardTaskRefIdentity(item)),
    snapshot,
    task,
    {
      fallbackTaskType: isStoryboardTaskType(task.taskType) ? task.taskType : null,
    },
  );
}

function createStoryboardReconcileTarget(
  node: ExecutionOutputCommitStateCheckRequest['node'],
  task: { taskId: string; groupId: string; groupOrder: number },
  taskRef: ExecutionRuntimePersistedTaskRef | null,
): ExecutionRuntimeGroupedNodeExecutionTarget {
  const identity = normalizeStoryboardExecutionTargetIdentity(taskRef ?? task, {
    fallbackGroupId: task.groupId,
    fallbackTaskType: isStoryboardTaskType(taskRef?.taskType) ? taskRef.taskType : null,
  });

  return {
    kind: 'group',
    nodeId: node.id.value,
    nodeType: node.type,
    groupId: identity?.groupId ?? task.groupId,
    groupOrder: taskRef?.groupOrder ?? task.groupOrder,
    groupLabel: taskRef?.groupLabel,
    outputHandle: identity?.outputHandle ?? getStoryboardOutputHandleForGroupId(task.groupId),
  };
}

function normalizeStoryboardReconcileOutput(input: {
  output: ExecutionRuntimeNodeExecutionOutput;
  persistedTaskRefs: readonly ExecutionRuntimePersistedTaskRef[];
  snapshot: { runId: string; runNo?: string };
}): ExecutionRuntimeNodeExecutionOutput {
  const taskRef = input.output.groupId
    ? findStoryboardTaskRef(input.persistedTaskRefs, input.snapshot, {
        taskId: input.output.taskId,
        groupId: input.output.groupId,
        taskType: input.output.taskType
          ?? getStoryboardTaskTypeFromFileInfo(input.output.resultFile),
      })
    : null;
  const normalizedTaskRef = taskRef
    ? normalizeStoryboardTaskRefIdentity(taskRef, {
      fallbackTaskType: getStoryboardTaskTypeFromFileInfo(input.output.resultFile) ?? null,
    })
    : null;
  const normalizedIdentity = normalizeStoryboardExecutionTargetIdentity({
    groupId: normalizedTaskRef?.groupId ?? input.output.groupId,
    outputHandle: normalizedTaskRef?.outputHandle ?? input.output.sourceHandle,
    taskType: input.output.taskType
      ?? normalizedTaskRef?.taskType
      ?? getStoryboardTaskTypeFromFileInfo(input.output.resultFile),
  });

  return {
    ...input.output,
    taskType: input.output.taskType
      ?? normalizedTaskRef?.taskType
      ?? getStoryboardTaskTypeFromFileInfo(input.output.resultFile),
    groupId: normalizedIdentity?.groupId ?? input.output.groupId,
    groupOrder: normalizedTaskRef?.groupOrder ?? 0,
    sourceHandle: normalizedIdentity?.outputHandle
      ?? (
        input.output.groupId
          ? getStoryboardOutputHandleForGroupId(input.output.groupId)
          : input.output.sourceHandle
      ),
  };
}

function getLatestStoryboardTaskRef(
  workflow: Workflow,
  node: ExecutionOutputCommitStateCheckRequest['node'],
  groupId?: string,
): PersistedStoryboardTaskRef | null {
  const { nodeTaskRefs, relatedTaskRefs } = getStoryboardTaskRefs(workflow, node);
  const matchesGroup = (taskRef: PersistedStoryboardTaskRef): boolean => (
    typeof groupId === 'string' ? taskRef.groupId === groupId : true
  );

  return nodeTaskRefs.slice().reverse().find(matchesGroup)
    ?? relatedTaskRefs.slice().reverse().find(matchesGroup)
    ?? null;
}

function isStaleStoryboardOutput(
  workflow: Workflow,
  node: ExecutionOutputCommitStateCheckRequest['node'],
  output: ExecutionOutputCommitStateCheckRequest['output'],
): boolean {
  const latestGroupTaskRef = getLatestStoryboardTaskRef(workflow, node, output.groupId);
  if (!latestGroupTaskRef) {
    return false;
  }

  if (
    typeof latestGroupTaskRef.runId === 'string'
    && latestGroupTaskRef.runId.length > 0
    && latestGroupTaskRef.runId !== output.runId
  ) {
    return true;
  }

  return latestGroupTaskRef.taskId !== output.taskId;
}

function hasCommittedStoryboardOutput(
  workflow: Workflow,
  node: ExecutionOutputCommitStateCheckRequest['node'],
  output: ExecutionOutputCommitStateCheckRequest['output'],
): boolean {
  const acceptedSourceHandles = new Set([
    output.sourceHandle,
    typeof output.groupId === 'string'
      ? getStoryboardOutputHandleForGroupId(output.groupId)
      : undefined,
    LEGACY_STORYBOARD_OUTPUT_HANDLE,
  ].filter((handle): handle is string => typeof handle === 'string' && handle.length > 0));

  const sourceNode = workflow.nodes[node.id.value];
  if (
    !sourceNode
    || !('outputs' in sourceNode)
    || !Array.isArray(sourceNode.outputs)
    || !sourceNode.outputs.includes(output.resultFileId)
  ) {
    return false;
  }

  return workflow.connections.some((connection) => {
    if (
      connection.type !== 'output-link'
      || connection.sourceId !== node.id.value
      || !acceptedSourceHandles.has(connection.sourceHandle ?? '')
    ) {
      return false;
    }

    const targetNode = workflow.nodes[connection.targetId];
    return Boolean(targetNode && isFileNodeData(targetNode) && targetNode.fileId === output.resultFileId);
  });
}

function validateStoryboardExecution(): { valid: true } {
  return { valid: true };
}

async function createStoryboardExecutionPayload(
  context: Parameters<ExecutionRuntimeGroupedNodeAdapter['createExecutionPayload']>[0],
): Promise<ExecutionRuntimeNodeActionOnlyExecutionPayload<ExecutionRuntimeGroupedNodeExecutionTarget>> {
  return {
    nodeId: context.node.id.value,
    nodeType: context.node.type,
    nodeTitle: context.nodeTitle,
    taskType: 'video-gen',
    executionKind: 'grouped',
    request: createAIStoryboardNodeActionOnlyExecutionRequest(),
    targets: [],
  };
}

export const aiStoryboardExecutionRuntimeAdapter: ExecutionRuntimeGroupedNodeAdapter = {
  nodeType: 'aiStoryboard',
  executionKind: 'grouped',
  taskType: 'video-gen',
  outputCommitMode: groupedOutputAdapter.outputCommitMode,
  validateExecution: validateStoryboardExecution,
  createExecutionPayload: createStoryboardExecutionPayload,
  mapSnapshotToRuntimePatch: (snapshot, context) => buildExecutionRuntimePatchesFromSnapshot(
    context.previousSnapshot,
    snapshot,
    {
      workflowId: context.workflowId ?? snapshot.workflowId ?? null,
      nodeId: context.nodeId,
    },
  ),
  extractExecutionOutputs: (snapshot, context) => groupedOutputAdapter
    .extractExecutionOutputs(snapshot, context)
    .map((output) => ({
      ...output,
      sourceHandle: output.groupId
        ? getStoryboardOutputHandleForGroupId(output.groupId)
        : output.sourceHandle,
      taskType: output.taskType ?? getStoryboardTaskTypeFromFileInfo(output.resultFile),
    })),
  createReconcileTargets: ({ node, snapshot, persistedTaskRefs }) => snapshot.tasks
    .filter((task) => task.status === 'completed' && task.resultFileId && task.groupId)
    .map((task) => createStoryboardReconcileTarget(
      node,
      task,
      findStoryboardTaskRef(persistedTaskRefs, snapshot, {
        taskId: task.taskId,
        groupId: task.groupId,
        taskType: getStoryboardTaskTypeFromFileInfo(task.resultFileInfo ?? task.resultFile),
      }),
    )),
  normalizeReconcileOutput: ({ output, snapshot, persistedTaskRefs }) => normalizeStoryboardReconcileOutput({
    output,
    snapshot,
    persistedTaskRefs,
  }),
  isOutputCommitted: ({ workflow, node, output }) => {
    if (!workflow || typeof output.groupId !== 'string' || output.groupId.length === 0) {
      return false;
    }

    const currentNode = workflow.nodes[node.id.value];
    if (!currentNode || !isAINodeData(currentNode) || currentNode.type !== 'aiStoryboard') {
      return false;
    }

    const mediaKind = resolveStoryboardMediaKind(output.resultFile);
    if (!mediaKind) {
      return false;
    }

    if (isStaleStoryboardOutput(workflow, currentNode, output)) {
      return true;
    }

    return hasCommittedStoryboardOutput(workflow, currentNode, output);
  },
  commitExecutionOutputs: async ({ currentWorkflow, node, preparedOutputs, workflowAccess, appendOptions }) => {
    const latestWorkflow = workflowAccess.getCurrentWorkflow() ?? currentWorkflow;
    const latestNode = latestWorkflow.nodes[node.id.value];
    if (!latestNode || !isAINodeData(latestNode) || latestNode.type !== 'aiStoryboard') {
      return { changed: false };
    }

    const outputsToAppend = preparedOutputs
      .filter((item): item is typeof item & { fileInfo: NonNullable<typeof item.fileInfo> } => Boolean(item.fileInfo))
      .map(({ output, fileInfo, runtimeResource }) => ({
        taskId: output.taskId,
        resultFileId: output.resultFileId,
        groupId: output.groupId,
        sourceHandle: output.sourceHandle,
        fileInfo,
        runtimeResource,
        order: output.groupOrder * 1000,
      }));

    if (outputsToAppend.length === 0) {
      return { changed: false };
    }

    const existingOutputCount = latestWorkflow.connections.filter((connection) => (
      connection.type === 'output-link' && connection.sourceId === node.id.value
    )).length;
    const latestNodeWidth = Math.max(
      typeof latestNode.dimensions?.width === 'number' ? latestNode.dimensions.width : 0,
      AI_STORYBOARD_DEFAULT_SIZE.width,
    );
    const outputGapX = appendOptions?.gapX ?? STORYBOARD_OUTPUT_GAP_X;

    const writeResult = appendResolvedTaskOutputs({
      workflow: latestWorkflow,
      sourceNode: latestNode,
      resolveFileUrl: workflowAccess.resolveFileUrl,
    }, outputsToAppend, {
      x: appendOptions?.x ?? (latestNode.position.x + latestNodeWidth + outputGapX),
      y: appendOptions?.y ?? latestNode.position.y,
      gapX: outputGapX,
      gapY: appendOptions?.gapY ?? 180,
      columns: appendOptions?.columns ?? 1,
      startIndex: existingOutputCount,
      replaceExistingHandleSlot: false,
    });

    if (!writeResult) {
      return { changed: false };
    }

    const runtimeSnapshot = createRuntimeOutputSnapshot(latestWorkflow, writeResult);
    const nextWorkflow = workflowAccess.applyRuntimeSnapshot(runtimeSnapshot, {
      hydrateCanvas: true,
      hydrationReason: 'external-output',
    });

    return {
      changed: nextWorkflow !== null,
    };
  },
};
