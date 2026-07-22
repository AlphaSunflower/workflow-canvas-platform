import type {
  FileInfo,
  NodeTaskRef,
  StoryboardShotData,
  Workflow,
  WorkflowRelatedTaskRef,
} from '@/types';
import { isAINodeData } from '@/utils';
import {
  createAIStoryboardNodeActionOnlyExecutionRequest,
} from '@/nodes/ai-storyboard/runtime';
import {
  appendResolvedTaskOutputs,
  createRuntimeOutputSnapshot,
} from '@/nodes/shared/runtime';
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
import type {
  ExecutionRuntimeGroupedNodeExecutionTarget,
  ExecutionRuntimeNodeActionOnlyExecutionPayload,
  ExecutionRuntimeNodeExecutionOutput,
} from '../node-execution.types';

type StoryboardMediaKind = 'image' | 'video';

const groupedOutputAdapter = createGroupedExecutionOutputAdapter();

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

    const shots: StoryboardShotData[] = Array.isArray(currentNode.config.shots)
      ? currentNode.config.shots
      : [];
    const matchingShot = shots.find((shot: StoryboardShotData) => shot.id === output.groupId);
    if (matchingShot) {
      const resultFileId = typeof output.resultFileId === 'string' ? output.resultFileId.trim() : '';
      if (resultFileId.length > 0) {
        if (mediaKind === 'image' && matchingShot.imageFileId === resultFileId) {
          return true;
        }
        if (mediaKind === 'video' && matchingShot.videoFileId === resultFileId) {
          return true;
        }
      }
    }

    return false;
  },
  commitExecutionOutputs: async (request) => {
    const currentWorkflow = request.currentWorkflow ?? request.workflowAccess.getCurrentWorkflow();
    if (!currentWorkflow) {
      return { changed: false };
    }

    const videoOutputs = request.preparedOutputs.filter((item) => {
      if (!item.fileInfo || !item.output) {
        return false;
      }
      return item.output.resultFile?.fileType === 'video'
        || item.output.resultFile?.mimeType?.startsWith('video/');
    });

    if (videoOutputs.length === 0) {
      return { changed: false };
    }

    const sourceNode = currentWorkflow.nodes[request.node.id.value];
    if (!sourceNode || !isAINodeData(sourceNode)) {
      return { changed: false };
    }

    const existingOutputCount = currentWorkflow.connections.filter(
      (connection) => connection.type === 'output-link' && connection.sourceId === sourceNode.id.value,
    ).length;

    const writeResult = appendResolvedTaskOutputs(
      {
        workflow: currentWorkflow,
        sourceNode,
        resolveFileUrl: request.workflowAccess.resolveFileUrl,
      },
      videoOutputs.map(({ output, fileInfo }) => ({
        fileInfo: fileInfo!,
        runtimeResource: null,
        sourceHandle: output!.sourceHandle,
        order: (output!.groupOrder ?? 0) * 1000,
      })),
      {
        x: sourceNode.position.x + Math.max(sourceNode.dimensions?.width ?? 0, 420) + 180,
        y: sourceNode.position.y,
        gapX: 180,
        gapY: 180,
        columns: 1,
        startIndex: existingOutputCount,
        replaceExistingHandleSlot: false,
      },
    );

    if (!writeResult) {
      return { changed: false };
    }

    const runtimeSnapshot = createRuntimeOutputSnapshot(currentWorkflow, writeResult);
    request.workflowAccess.applyRuntimeSnapshot(runtimeSnapshot, {
      hydrateCanvas: true,
      hydrationReason: 'external-output',
    });
    return { changed: true };
  },
};
