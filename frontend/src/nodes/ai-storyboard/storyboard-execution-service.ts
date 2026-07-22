import type { WorkflowRuntimeSnapshot } from '@/contracts/workflow';
import type {
  AINodeData,
  AnyNodeData,
  FileInfo,
  FileNodeData,
  NodeTaskRef,
  StoryboardShotData,
  Workflow,
} from '@/types';
import type { ExecutionRuntimeGroupState } from '@/execution-runtime/execution-runtime.types';
import type {
  ExecutionRuntimeGroupedNodeExecutionTarget,
  ExecutionRuntimeNodeActionOnlyExecutionPayload,
} from '@/execution-runtime/node-execution.types';
import { createAIStoryboardNodeActionOnlyExecutionRequest } from './runtime';
import { getStoryboardShotVideoUnavailableReason } from './shot-video-execution';
import {
  createStoryboardExecutionTargetIdentity,
  getStoryboardOutputHandleForGroupId,
  getStoryboardTaskTypeForMediaKind,
  matchesStoryboardOutputIdentity,
} from './storyboard-output-identity';

export type StoryboardExecutionMediaKind = 'image' | 'video';

export interface StoryboardNodePatchState {
  currentNode: AINodeData;
  shots: StoryboardShotData[];
  processedInputFileIds: string[];
}

export interface StoryboardNodePatchResult {
  nextNode: AINodeData;
  runtimeSnapshot: WorkflowRuntimeSnapshot;
}

export interface StoryboardCommittedGroupLookupOptions {
  workflowId?: string | null;
  runId?: string | null;
  taskId?: string | null;
  resultFileId?: string | null;
  fileType?: FileInfo['fileType'];
}

export interface ResolveStoryboardReferenceFileIdsOptions {
  shot: StoryboardShotData;
  sourceNode: FileNodeData | null;
  connectedImages?: Array<{ sourceNode: FileNodeData; order: number }>;
  signal?: AbortSignal;
  maxReferences: number;
  ensureBackendFileId: (
    sourceNode: FileNodeData,
    options?: { signal?: AbortSignal; workflowId?: string | null },
  ) => Promise<string | null | undefined>;
  workflowId?: string | null;
}

export interface ResolveStoryboardReferenceFileIdsResult {
  referenceFileIds: string[];
  unavailableReason: string | null;
}

function normalizeFileId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isAIStoryboardNode(node: AnyNodeLike): node is AINodeData & { type: 'aiStoryboard' } {
  return Boolean(node && node.type === 'aiStoryboard');
}

type AnyNodeLike = Pick<AnyNodeData, 'type'> | null | undefined;

export function getStoryboardShots(node: AINodeData): StoryboardShotData[] {
  return Array.isArray(node.config.shots) ? node.config.shots : [];
}

export function getStoryboardProcessedInputFileIds(node: AINodeData): string[] {
  return Array.isArray(node.config.processedInputFileIds)
    ? node.config.processedInputFileIds
    : [];
}

export function getStoryboardShotExecutionOutputHandle(
  shotId: string,
  _mediaKind: StoryboardExecutionMediaKind,
): string {
  return getStoryboardOutputHandleForGroupId(shotId);
}

export function createStoryboardShotExecutionTarget(
  node: AINodeData,
  shot: StoryboardShotData,
  mediaKind: StoryboardExecutionMediaKind,
): ExecutionRuntimeGroupedNodeExecutionTarget {
  const identity = createStoryboardExecutionTargetIdentity({
    groupId: shot.id,
    taskType: mediaKind,
  });

  return {
    kind: 'group',
    nodeId: node.id.value,
    nodeType: node.type,
    groupId: identity.groupId,
    groupOrder: shot.order,
    groupLabel: `Shot ${shot.order}`,
    outputHandle: identity.outputHandle,
  };
}

export function createStoryboardShotExecutionPayload(
  node: AINodeData,
  nodeTitle: string,
  shot: StoryboardShotData,
  mediaKind: StoryboardExecutionMediaKind,
): ExecutionRuntimeNodeActionOnlyExecutionPayload<ExecutionRuntimeGroupedNodeExecutionTarget> {
  return {
    nodeId: node.id.value,
    nodeType: node.type,
    nodeTitle,
    taskType: getStoryboardTaskTypeForMediaKind(mediaKind),
    executionKind: 'grouped',
    request: createAIStoryboardNodeActionOnlyExecutionRequest(),
    targets: [createStoryboardShotExecutionTarget(node, shot, mediaKind)],
  };
}

export function mergeStoryboardNodeTaskRefs(
  existingTaskRefs: NodeTaskRef[],
  nextTaskRef: NodeTaskRef,
): NodeTaskRef[] {
  return [
    ...existingTaskRefs.filter((taskRef) => !(
      taskRef.taskId === nextTaskRef.taskId
      || matchesStoryboardOutputIdentity(taskRef, nextTaskRef, { allowMissingTaskType: true })
    )),
    nextTaskRef,
  ];
}

export function createStoryboardNodePatchResult(
  workflow: Workflow,
  nodeId: string,
  updater: (
    state: StoryboardNodePatchState,
  ) => {
    shots?: StoryboardShotData[];
    processedInputFileIds?: string[];
  } | null,
): StoryboardNodePatchResult | null {
  const currentNode = workflow.nodes[nodeId];
  if (!currentNode || !isAIStoryboardNode(currentNode)) {
    return null;
  }

  const currentShots = getStoryboardShots(currentNode);
  const currentProcessedInputFileIds = getStoryboardProcessedInputFileIds(currentNode);
  const nextState = updater({
    currentNode,
    shots: currentShots,
    processedInputFileIds: currentProcessedInputFileIds,
  });

  if (!nextState) {
    return null;
  }

  const nextNode: AINodeData = {
    ...currentNode,
    config: {
      ...currentNode.config,
      processedInputFileIds: currentNode.config.processedInputFileIds,
      ...(currentNode.config.processedInputFileIds !== currentProcessedInputFileIds
        ? { processedInputFileIds: currentProcessedInputFileIds }
        : {}),
      ...(typeof nextState.processedInputFileIds !== 'undefined'
        ? { processedInputFileIds: nextState.processedInputFileIds }
        : {}),
      ...(typeof nextState.shots !== 'undefined'
        ? { shots: nextState.shots }
        : {}),
    },
    timestamp: {
      ...currentNode.timestamp,
      updated: Date.now(),
    },
  };

  return {
    nextNode,
    runtimeSnapshot: {
      nodes: {
        ...workflow.nodes,
        [nodeId]: nextNode,
      },
      connections: workflow.connections,
      viewport: workflow.viewport,
      metadata: workflow.metadata ?? undefined,
    },
  };
}

export function createStoryboardShotPatchResult(
  workflow: Workflow,
  nodeId: string,
  shotId: string,
  updater: (shots: StoryboardShotData[]) => StoryboardShotData[],
): StoryboardNodePatchResult | null {
  return createStoryboardNodePatchResult(workflow, nodeId, ({ shots }) => {
    if (!shots.some((item) => item.id === shotId)) {
      return null;
    }

    return {
      shots: updater(shots),
    };
  });
}

export function getCommittedStoryboardGroupState(
  options: {
    nodeId: string;
    shotId: string;
    getGroupState: (
      nodeId: string,
      groupId: string,
      workflowId?: string | null,
    ) => ExecutionRuntimeGroupState | null;
  } & StoryboardCommittedGroupLookupOptions,
): ExecutionRuntimeGroupState | null {
  const groupState = options.getGroupState(
    options.nodeId,
    options.shotId,
    options.workflowId ?? null,
  );

  if (!groupState || groupState.isOutputCommitted !== true) {
    return null;
  }

  if (
    typeof options.runId === 'string'
    && options.runId.length > 0
    && groupState.runId !== options.runId
  ) {
    return null;
  }

  if (
    typeof options.taskId === 'string'
    && options.taskId.length > 0
    && groupState.aiTaskId !== options.taskId
  ) {
    return null;
  }

  if (
    typeof options.resultFileId === 'string'
    && options.resultFileId.length > 0
    && groupState.resultFileId !== options.resultFileId
  ) {
    return null;
  }

  if (
    typeof options.fileType === 'string'
    && groupState.resultFile?.fileType !== options.fileType
  ) {
    return null;
  }

  return groupState;
}

export async function resolveStoryboardExecutionReferenceFileIds(
  options: ResolveStoryboardReferenceFileIdsOptions,
): Promise<ResolveStoryboardReferenceFileIdsResult> {
  const referenceFileIds = new Set<string>();
  const persistedImageFileId = normalizeFileId(options.shot.imageFileId);
  const persistedSourceImageFileId = normalizeFileId(options.shot.sourceImageFileId);
  const persistedSourceFileId = normalizeFileId(options.shot.sourceFileId);
  const hasConfirmedFallbackSourceImageFileId = (
    persistedSourceImageFileId.length > 0
    && (persistedSourceFileId.length === 0 || persistedSourceImageFileId !== persistedSourceFileId)
  );

  // Priority 1: AI-generated image (always first)
  if (persistedImageFileId.length > 0) {
    referenceFileIds.add(persistedImageFileId);
  }

  // Priority 2: Connected images from per-shot input port
  if (options.connectedImages && options.connectedImages.length > 0) {
    const sortedConnected = [...options.connectedImages].sort((a, b) => a.order - b.order);
    for (const connected of sortedConnected) {
      if (referenceFileIds.size >= options.maxReferences) {
        break;
      }
      if (connected.sourceNode.type === 'image') {
        const connectedBackendFileId = await options.ensureBackendFileId(connected.sourceNode, {
          signal: options.signal,
          workflowId: options.workflowId,
        });
        const normalizedConnectedFileId = normalizeFileId(connectedBackendFileId);
        if (normalizedConnectedFileId.length > 0) {
          referenceFileIds.add(normalizedConnectedFileId);
        }
      }
    }
  }

  // Priority 3: Legacy source node (fallback)
  if (referenceFileIds.size < options.maxReferences) {
    if (options.sourceNode && options.sourceNode.type === 'image') {
      const sourceBackendFileId = await options.ensureBackendFileId(options.sourceNode, {
        signal: options.signal,
        workflowId: options.workflowId,
      });
      const normalizedSourceBackendFileId = normalizeFileId(sourceBackendFileId);
      if (normalizedSourceBackendFileId.length > 0) {
        referenceFileIds.add(normalizedSourceBackendFileId);
      }
    } else if (hasConfirmedFallbackSourceImageFileId) {
      referenceFileIds.add(persistedSourceImageFileId);
    }
  }

  const normalizedReferenceFileIds = Array.from(referenceFileIds).slice(0, options.maxReferences);
  const unavailableReason = normalizedReferenceFileIds.length > 0
    ? null
    : getStoryboardShotVideoUnavailableReason(options.shot)
      ?? '当前镜头缺少可用参考图，无法执行分镜媒体生成。';

  return {
    referenceFileIds: normalizedReferenceFileIds,
    unavailableReason,
  };
}

export function getStoryboardExecutionDebtMap(): string[] {
  return [
    '节点定义层 aiStoryboard 已接入 node-action-only execution contract，并通过 runtime.ts 声明内部动作。',
    'WorkflowContext 已不再对外暴露分镜专属 actions，也不再直接组装 storyboard action facade；共享执行基础设施通过 node action service registry 注入节点域门面。',
    '分镜任务的 groupId 继续承载 shot.id，输出 handle 已路由到对应 shot.id 的独立 result handle，并保留 legacy group-1 锚点兼容旧边线。',
    '分镜 UI 已通过通用 runNodeAction 分发内部动作，并由 storyboard application facade 承接编排、单镜头和批量执行协作。',
    '分镜执行已完成 node-action-only 契约化，但 WorkflowContext 的进一步体积收敛仍属于后续架构治理项。',
  ];
}

