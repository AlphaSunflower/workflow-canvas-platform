import type { AINodeData, Connection, FileInfo, FileNodeData, FileSource, Workflow } from '@/types';
import type { WorkflowConnectionInput } from '@/contracts/workflow';
import { buildRemoteImageAsset } from '@/services/image';
import type { ExecutionOutputRuntimeResource } from '@/services/execution-output-runtime-sync';
import {
  getExecutionOutputRuntimeResource,
  registerExecutionOutputNodeRuntimeSource,
} from '@/services/execution-output-runtime-sync';
import {
  calculateFileNodeDimensions,
  createDefaultAINodeData,
  createDefaultFileNodeData,
  createSequentialNodeId,
  generateUUID,
  getFileTypeFromName,
} from '@/utils';
import type {
  GroupedExecutionContext,
  MockExecutionContext,
  MockOutputDescriptor,
  NodeDefinition,
  NodeExecutionAdapter,
  NodeExecutionGroupPlan,
  NodeExecutionPlan,
  NodeInputGroupDefinition,
  NodeValidationResult,
} from '../types';
import { parseGroupPortHandle } from './connection';

export interface MockExecutionResult {
  outputs: FileNodeData[];
}

export interface OutputPlacement {
  x: number;
  y: number;
  gapX?: number;
  gapY?: number;
  columns?: number;
  startIndex?: number;
  replaceExistingHandleSlot?: boolean;
  layoutMode?: 'grouped-horizontal' | 'vertical-column';
}

export interface OutputLinkDescriptor {
  sourceHandle?: string;
  order?: number;
}

export interface RuntimeOutputAppenderContext {
  workflow: Workflow;
  sourceNode: AINodeData;
  resolveFileUrl: (fileId: string, type?: 'thumbnail' | 'download') => string;
}

export interface ResolvedTaskOutput {
  taskId?: string;
  resultFileId?: string;
  groupId?: string;
  sourceHandle?: string;
  fileInfo: FileInfo;
  runtimeResource?: ExecutionOutputRuntimeResource | null;
  order: number;
}

export interface RuntimeOutputWriteResult {
  nodes: Record<string, FileNodeData | AINodeData>;
  connections: Connection[];
  outputIds: string[];
}

export interface RuntimeOutputSnapshot {
  id?: Workflow['id'];
  projectId?: Workflow['projectId'];
  name?: Workflow['name'];
  nodes: Workflow['nodes'];
  connections: Connection[];
  viewport: Workflow['viewport'];
  metadata?: Workflow['metadata'];
  timestamp?: Workflow['timestamp'];
  snapshotMeta: {
    source: 'external-output';
    scope: 'output-append';
    baseUpdatedAt: number;
    baseNodeCount: number;
    baseConnectionCount: number;
    sourceNodeId?: string;
    affectedNodeIds: string[];
    allowNodeShrink: false;
  };
}

export interface ExistingOutputNodeDescriptor {
  node: FileNodeData;
  sourceHandle?: string;
  order: number;
}

function getOutputHandleKey(sourceHandle?: string): string {
  return sourceHandle ?? '';
}

function isNodeOutputProducedBySource(node: FileNodeData, sourceNodeId: string): boolean {
  return node.source.type === 'node-output' && node.source.producerNodeId === sourceNodeId;
}

function isValidRuntimeFileSource(source: unknown): source is FileSource {
  if (!source || typeof source !== 'object') {
    return false;
  }
  const candidate = source as Record<string, unknown>;

  if (candidate['type'] === 'imported') {
    return true;
  }

  return (
    candidate['type'] === 'node-output' &&
    typeof candidate['producerNodeId'] === 'string' &&
    typeof candidate['producerNodeDisplayId'] === 'string' &&
    typeof candidate['producerNodeType'] === 'string' &&
    typeof candidate['taskId'] === 'string' &&
    typeof candidate['taskNo'] === 'string' &&
    typeof candidate['taskCreatedAt'] === 'number'
  );
}

function buildResolvedOutputFileSource(
  sourceNode: AINodeData,
  output: ResolvedTaskOutput,
): FileSource {
  const rawSource = output.fileInfo.source as unknown;
  if (isValidRuntimeFileSource(rawSource)) {
    return rawSource;
  }
  const rawSourceRecord = (
    rawSource !== null &&
    typeof rawSource === 'object'
  ) ? rawSource as Record<string, unknown> : null;

  const rawTaskId = typeof rawSourceRecord?.['taskId'] === 'string'
    ? rawSourceRecord.taskId
    : undefined;
  const rawTaskNo = typeof rawSourceRecord?.['taskNo'] === 'string'
    ? rawSourceRecord.taskNo
    : undefined;
  const rawTaskCreatedAt = typeof rawSourceRecord?.['taskCreatedAt'] === 'number'
    ? rawSourceRecord.taskCreatedAt
    : undefined;
  const rawTaskStartedAt = typeof rawSourceRecord?.['taskStartedAt'] === 'number'
    ? rawSourceRecord.taskStartedAt
    : undefined;
  const rawTaskCompletedAt = typeof rawSourceRecord?.['taskCompletedAt'] === 'number'
    ? rawSourceRecord.taskCompletedAt
    : undefined;

  const matchedTask = sourceNode.tasks.find((task) => (
    task.taskId === output.taskId ||
    task.taskId === rawTaskId
  )) ?? sourceNode.tasks
    .slice()
    .sort((left, right) => (
      (right.completedAt ?? right.startedAt ?? right.createdAt) -
      (left.completedAt ?? left.startedAt ?? left.createdAt)
    ))[0];
  const fallbackTimestamp = matchedTask?.createdAt ?? Date.now();

  return {
    type: 'node-output',
    producerNodeId: sourceNode.id.value,
    producerNodeDisplayId: sourceNode.id.display,
    producerNodeType: sourceNode.type,
    taskId: output.taskId ?? matchedTask?.taskId ?? `runtime-${output.resultFileId ?? output.fileInfo.id}`,
    taskNo: rawTaskNo ?? matchedTask?.taskNo ?? `TASK-${output.resultFileId ?? output.fileInfo.id}`,
    taskCreatedAt: rawTaskCreatedAt ?? matchedTask?.createdAt ?? fallbackTimestamp,
    ...((rawTaskStartedAt ?? matchedTask?.startedAt) !== undefined
      ? { taskStartedAt: rawTaskStartedAt ?? matchedTask?.startedAt }
      : {}),
    ...((rawTaskCompletedAt ?? matchedTask?.completedAt) !== undefined
      ? { taskCompletedAt: rawTaskCompletedAt ?? matchedTask?.completedAt }
      : {}),
  };
}

function appendUniqueOutputIds(existingOutputIds: string[], nextOutputIds: string[]): string[] {
  const seen = new Set(existingOutputIds);
  const merged = [...existingOutputIds];

  nextOutputIds.forEach((outputId) => {
    if (seen.has(outputId)) {
      return;
    }

    seen.add(outputId);
    merged.push(outputId);
  });

  return merged;
}

export function removeOrphanedNodeOutputIds(
  sourceNode: AINodeData,
  workflowNodes: Workflow['nodes'],
  connections: readonly Connection[],
): AINodeData {
  const remainingOutputFileIds = new Set(
    connections
      .filter((connection) => (
        connection.type === 'output-link' &&
        connection.sourceId === sourceNode.id.value
      ))
      .flatMap((connection) => {
        const targetNode = workflowNodes[connection.targetId];
        if (!targetNode || (targetNode.type !== 'image' && targetNode.type !== 'video' && targetNode.type !== 'ply')) {
          return [];
        }

        return [targetNode.fileId];
      }),
  );

  return {
    ...sourceNode,
    outputs: sourceNode.outputs.filter((fileId) => remainingOutputFileIds.has(fileId)),
    timestamp: {
      ...sourceNode.timestamp,
      updated: Date.now(),
    },
  };
}

export interface ResolvedConnectedOutputGroup {
  groupId: string;
  order: number;
}

export interface ResolvedGroupedExecution {
  executableGroupIds: string[];
  skippedGroupIds: string[];
}

export function createDefinitionNodeData(definition: NodeDefinition, id: AINodeData['id'], position: AINodeData['position']): AINodeData {
  if (definition.createNodeData) {
    return definition.createNodeData(id, position);
  }

  const base = createDefaultAINodeData(id, position, definition.type);
  return {
    ...base,
    dimensions: { ...definition.defaultSize },
    config: {
      ...definition.defaultConfig,
    },
  };
}

export function createMockOutputNodes(
  _workflow: Workflow,
  sourceNode: AINodeData,
  descriptors: MockOutputDescriptor[],
  startSequence: number
): FileNodeData[] {
  return descriptors.map((descriptor, index) => {
    const nodeId = createSequentialNodeId(startSequence + index);

    const position = {
      x: sourceNode.position.x + 420 + (index % 2) * 180,
      y: sourceNode.position.y + Math.floor(index / 2) * 180,
    };

    const node = createDefaultFileNodeData(
      nodeId,
      position,
      descriptor.fileType,
      `mock-${sourceNode.id.value}-${index + 1}`,
      descriptor.fileName,
      0,
      descriptor.mimeType,
      {},
      descriptor.source ?? {
        type: 'node-output',
        producerNodeId: sourceNode.id.value,
        producerNodeDisplayId: sourceNode.id.display,
        producerNodeType: sourceNode.type,
      }
    );

    return {
      ...node,
      status: 'idle',
      previewUrl: undefined,
      thumbnailUrl: undefined,
      timestamp: {
        ...node.timestamp,
        updated: Date.now(),
      },
    };
  });
}

export function createBasicCanRun(minimumConnections: number, message: string): (
  node: AINodeData,
  inputs: WorkflowConnectionInput[]
) => NodeValidationResult {
  return (_node: AINodeData, inputs: WorkflowConnectionInput[]) => {
    if (inputs.length < minimumConnections) {
      return {
        valid: false,
        reason: message,
      };
    }

    return { valid: true };
  };
}

export function createBasicPlan(node: AINodeData, inputs: WorkflowConnectionInput[]): NodeExecutionPlan {
  const files = inputs
    .map((input) => input.sourceNode)
    .filter((sourceNode): sourceNode is FileNodeData => sourceNode.type === 'image' || sourceNode.type === 'video' || sourceNode.type === 'ply')
    .map((sourceNode) => sourceNode.fileId);

  return {
    files,
    references: files,
    config: node.config,
    prompt: typeof node.config.prompt === 'string' ? node.config.prompt : undefined,
    negativePrompt: typeof node.config.negativePrompt === 'string' ? node.config.negativePrompt : undefined,
  };
}

export function isMockExecutionAdapter(adapter: NodeExecutionAdapter): adapter is Extract<NodeExecutionAdapter, { mode: 'mock' }> {
  return adapter.mode === 'mock';
}

export function isSingleTaskExecutionAdapter(adapter: NodeExecutionAdapter): adapter is Extract<NodeExecutionAdapter, { mode: 'legacy-single-task' }> {
  return adapter.mode === 'legacy-single-task';
}

export function isGroupedTaskExecutionAdapter(adapter: NodeExecutionAdapter): adapter is Extract<NodeExecutionAdapter, { mode: 'legacy-grouped-task' }> {
  return adapter.mode === 'legacy-grouped-task';
}

export function isNodeActionOnlyExecutionAdapter(adapter: NodeExecutionAdapter): adapter is Extract<NodeExecutionAdapter, { mode: 'node-action-only' }> {
  return adapter.mode === 'node-action-only';
}

export function createGroupedExecutionContext(
  workflow: Workflow,
  node: AINodeData,
  inputs: WorkflowConnectionInput[]
): GroupedExecutionContext {
  return {
    workflow,
    node,
    inputs,
  };
}

export function resolveGroupedExecutionGroups<TGroupState extends { group: { id: string } }>(
  groupStates: TGroupState[],
  groupPlans: NodeExecutionGroupPlan[]
): ResolvedGroupedExecution {
  const resolvedGroups = groupPlans
    .slice()
    .sort((left, right) => left.order - right.order);
  const executableGroupIds = resolvedGroups.map((groupPlan) => groupPlan.groupId);
  const executableGroupIdSet = new Set(executableGroupIds);
  const skippedGroupIds = groupStates
    .map((groupState) => groupState.group.id)
    .filter((groupId) => !executableGroupIdSet.has(groupId));

  return {
    executableGroupIds,
    skippedGroupIds,
  };
}

function mapFileInfoToNodeType(fileInfo: FileInfo): FileNodeData['type'] {
  if (fileInfo.fileType === 'image' || fileInfo.fileType === 'video') {
    return fileInfo.fileType;
  }

  if (fileInfo.fileType === 'model3d') {
    return 'ply';
  }

  const detected = getFileTypeFromName(fileInfo.name);
  if (detected === 'image' || detected === 'video') {
    return detected;
  }

  return 'ply';
}

function getNextOutputNodeSequence(workflow: Workflow): number {
  return Math.max(
    ...Object.keys(workflow.nodes)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value)),
    workflow.metadata?.lastNodeId ?? 0,
    0
  ) + 1;
}

function getSourceNodeRightEdge(node: AINodeData): number {
  return node.position.x + Math.max(0, node.dimensions?.width ?? 0);
}

function resolveAppendStartX(node: AINodeData, startX: number, gapX: number): number {
  return Math.max(startX, getSourceNodeRightEdge(node) + gapX);
}

function getFileNodeWidth(node: FileNodeData): number {
  return Math.max(1, node.dimensions?.width ?? 1);
}

function getFileNodeHeight(node: FileNodeData): number {
  return Math.max(1, node.dimensions?.height ?? 1);
}

function resolveOutputNodeDimensions(fileInfo: FileInfo): { width: number; height: number } {
  return calculateFileNodeDimensions(mapFileInfoToNodeType(fileInfo), fileInfo.metadata);
}

function resolveRuntimeOutputSnapshotSourceNodeId(
  workflow: Workflow,
  writeResult: RuntimeOutputWriteResult,
): string | null {
  return Object.keys(writeResult.nodes).find((nodeId) => {
    const node = writeResult.nodes[nodeId];
    const previousNode = workflow.nodes[nodeId];

    return !('fileId' in node) && (!previousNode || !('fileId' in previousNode));
  }) ?? null;
}

function resolveLatestRuntimeSourceNode(
  workflow: Workflow,
  sourceNode: AINodeData,
): AINodeData {
  const latestSourceNode = workflow.nodes[sourceNode.id.value];
  if (
    latestSourceNode
    && latestSourceNode.type === sourceNode.type
    && !('fileId' in latestSourceNode)
  ) {
    return latestSourceNode as AINodeData;
  }

  return sourceNode;
}

export function createRuntimeOutputSnapshot(
  workflow: Workflow,
  writeResult: RuntimeOutputWriteResult
): RuntimeOutputSnapshot {
  const sourceNodeId = resolveRuntimeOutputSnapshotSourceNodeId(workflow, writeResult);
  const affectedNodeIds = Object.keys(writeResult.nodes);

  return {
    id: workflow.id,
    projectId: workflow.projectId,
    name: workflow.name,
    nodes: {
      ...workflow.nodes,
      ...writeResult.nodes,
    },
    connections: writeResult.connections,
    viewport: workflow.viewport,
    metadata: workflow.metadata,
    timestamp: workflow.timestamp,
    snapshotMeta: {
      source: 'external-output',
      scope: 'output-append',
      baseUpdatedAt: workflow.timestamp.updated,
      baseNodeCount: Object.keys(workflow.nodes).length,
      baseConnectionCount: workflow.connections.length,
      ...(sourceNodeId ? { sourceNodeId } : {}),
      affectedNodeIds,
      allowNodeShrink: false,
    },
  };
}

export function resolveConnectedOutputGroups(
  inputs: WorkflowConnectionInput[],
  groups: NodeInputGroupDefinition[]
): ResolvedConnectedOutputGroup[] {
  const connectedPortsByGroup = new Map<string, Set<string>>();

  inputs.forEach((input) => {
    const parsedHandle = parseGroupPortHandle(input.connection.targetHandle);
    if (!parsedHandle) {
      return;
    }

    const currentPorts = connectedPortsByGroup.get(parsedHandle.groupId) ?? new Set<string>();
    currentPorts.add(parsedHandle.portId);
    connectedPortsByGroup.set(parsedHandle.groupId, currentPorts);
  });

  return groups.flatMap((group, index) => {
    const connectedPorts = connectedPortsByGroup.get(group.id);
    if (!connectedPorts) {
      return [];
    }

    const hasRequiredInputs = group.ports.every((port) => !port.required || connectedPorts.has(port.id));
    if (!hasRequiredInputs) {
      return [];
    }

    return [{
      groupId: group.id,
      order: index,
    }];
  });
}

export function appendResolvedTaskOutputs(
  context: RuntimeOutputAppenderContext,
  outputs: ResolvedTaskOutput[],
  placement?: OutputPlacement
): RuntimeOutputWriteResult | null {
  if (outputs.length === 0) {
    return null;
  }

  const sourceNode = resolveLatestRuntimeSourceNode(context.workflow, context.sourceNode);
  const gapX = placement?.gapX ?? 180;
  const gapY = placement?.gapY ?? 180;
  const columns = Math.max(1, placement?.columns ?? 1);
  const startX = placement?.x ?? (sourceNode.position.x + 420);
  const startY = placement?.y ?? sourceNode.position.y;
  const replaceExistingHandleSlot = placement?.replaceExistingHandleSlot ?? false;
  const appendLayoutMode = replaceExistingHandleSlot
    ? 'replace-slot'
    : placement?.layoutMode === 'vertical-column'
      ? 'append-vertical-column'
      : 'append-grouped-horizontal';
  const nextNodesRecord: Record<string, FileNodeData> = {};
  const nextConnections = [...context.workflow.connections];
  const nextOutputIds: string[] = [];
  const sourceNodeId = sourceNode.id.value;
  const existingOutgoingOutputCount = nextConnections.filter((connection) => (
    connection.type === 'output-link' && connection.sourceId === sourceNodeId
  )).length;
  const startIndex = Math.max(0, placement?.startIndex ?? (
    replaceExistingHandleSlot ? 0 : existingOutgoingOutputCount
  ));
  let appendedNewOutputCount = 0;
  let nextOutputNodeSequence: number | null = null;
  const existingFileNodes = Object.values(context.workflow.nodes)
    .filter((node): node is FileNodeData => 'fileId' in node);
  const existingFileNodesById = new Map(
    existingFileNodes.map((node) => [node.id.value, node] as const),
  );
  const removedOutputIds = new Set<string>();
  const sortedOutputs = outputs
    .slice()
    .sort((left, right) => left.order - right.order);
  const safeStartX = appendLayoutMode === 'replace-slot'
    ? startX
    : resolveAppendStartX(sourceNode, startX, gapX);
  const existingSourceOutputConnections = nextConnections.filter((connection) => (
    connection.type === 'output-link' && connection.sourceId === sourceNodeId
  ));
  const linkedSourceOutputNodeIds = new Set(
    existingSourceOutputConnections.map((connection) => connection.targetId),
  );
  const isOwnedBySource = (node: FileNodeData): boolean => (
    linkedSourceOutputNodeIds.has(node.id.value) || isNodeOutputProducedBySource(node, sourceNodeId)
  );
  const existingOwnedFileNodesByFileId = new Map(
    existingFileNodes
      .filter((node) => isOwnedBySource(node))
      .map((node) => [node.fileId, node] as const),
  );

  const hasOutputLink = (targetId: string, sourceHandle?: string): boolean => nextConnections.some((connection) => (
    connection.type === 'output-link'
    && connection.sourceId === sourceNodeId
    && connection.targetId === targetId
    && getOutputHandleKey(connection.sourceHandle) === getOutputHandleKey(sourceHandle)
  ));

  const removeConflictingOutputLinks = (sourceHandle: string | undefined, preserveTargetId: string): void => {
    const handleKey = getOutputHandleKey(sourceHandle);

    for (let index = nextConnections.length - 1; index >= 0; index -= 1) {
      const connection = nextConnections[index];
      if (
        connection.type !== 'output-link'
        || connection.sourceId !== sourceNodeId
        || getOutputHandleKey(connection.sourceHandle) !== handleKey
        || connection.targetId === preserveTargetId
      ) {
        continue;
      }

      const removedNode = nextNodesRecord[connection.targetId] ?? existingFileNodesById.get(connection.targetId);
      if (removedNode && isOwnedBySource(removedNode)) {
        removedOutputIds.add(removedNode.fileId);
      }

      nextConnections.splice(index, 1);
    }
  };

  const findExistingSlotNode = (sourceHandle: string | undefined): FileNodeData | null => {
    const handleKey = getOutputHandleKey(sourceHandle);
    const matchedConnection = nextConnections.find((connection) => (
      connection.type === 'output-link'
      && connection.sourceId === sourceNodeId
      && getOutputHandleKey(connection.sourceHandle) === handleKey
    ));
    if (!matchedConnection) {
      return null;
    }

    return nextNodesRecord[matchedConnection.targetId]
      ?? existingFileNodesById.get(matchedConnection.targetId)
      ?? null;
  };

  const countOccupiedSlotsBefore = (order: number, sourceHandle: string | undefined): number => {
    const currentHandleKey = getOutputHandleKey(sourceHandle);
    const slotEntries = new Map<string, number>();

    nextConnections.forEach((connection) => {
      if (connection.type !== 'output-link' || connection.sourceId !== sourceNodeId) {
        return;
      }

      const handleKey = getOutputHandleKey(connection.sourceHandle);
      if (handleKey === currentHandleKey) {
        return;
      }

      const connectionOrder = connection.order ?? 0;
      const currentOrder = slotEntries.get(handleKey);
      if (currentOrder === undefined || connectionOrder < currentOrder) {
        slotEntries.set(handleKey, connectionOrder);
      }
    });

    return Array.from(slotEntries.entries()).filter(([handleKey, existingOrder]) => (
      existingOrder < order || (existingOrder === order && handleKey.localeCompare(currentHandleKey) < 0)
    )).length;
  };

  const verticalAppendNodesById = new Map<string, FileNodeData>();
  existingSourceOutputConnections.forEach((connection) => {
    const existingNode = existingFileNodesById.get(connection.targetId);
    if (!existingNode || !isOwnedBySource(existingNode)) {
      return;
    }

    verticalAppendNodesById.set(existingNode.id.value, existingNode);
  });
  const verticalAppendNodes = Array.from(verticalAppendNodesById.values());
  const verticalColumnX = verticalAppendNodes.length > 0
    ? Math.max(safeStartX, Math.min(...verticalAppendNodes.map((node) => node.position.x)))
    : safeStartX;
  let nextVerticalY = verticalAppendNodes
    .slice()
    .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x)
    .reduce(
      (currentY, node) => Math.max(currentY, node.position.y + getFileNodeHeight(node) + gapY),
      startY,
    );

  const existingAppendLaneNodes = new Map<string, FileNodeData[]>();
  const appendLaneOrderByHandle = new Map<string, number>();
  existingSourceOutputConnections.forEach((connection) => {
    const handleKey = getOutputHandleKey(connection.sourceHandle);
    const existingOrder = appendLaneOrderByHandle.get(handleKey);
    const connectionOrder = connection.order ?? 0;
    if (existingOrder === undefined || connectionOrder < existingOrder) {
      appendLaneOrderByHandle.set(handleKey, connectionOrder);
    }

    const existingNode = existingFileNodesById.get(connection.targetId);
    if (!existingNode || !isOwnedBySource(existingNode)) {
      return;
    }

    const currentNodes = existingAppendLaneNodes.get(handleKey) ?? [];
    currentNodes.push(existingNode);
    existingAppendLaneNodes.set(handleKey, currentNodes);
  });

  const pendingAppendOutputsByHandle = new Map<string, ResolvedTaskOutput[]>();
  sortedOutputs.forEach((output) => {
    const handleKey = getOutputHandleKey(output.sourceHandle);
    const existingOrder = appendLaneOrderByHandle.get(handleKey);
    if (existingOrder === undefined || output.order < existingOrder) {
      appendLaneOrderByHandle.set(handleKey, output.order);
    }

    const currentOutputs = pendingAppendOutputsByHandle.get(handleKey) ?? [];
    currentOutputs.push(output);
    pendingAppendOutputsByHandle.set(handleKey, currentOutputs);
  });

  const appendLaneStateByHandle = new Map<string, { baseY: number; nextX: number }>();
  if (appendLayoutMode === 'append-grouped-horizontal') {
    let nextFreeLaneY = startY;
    let occupiedLaneBottom = startY - gapY;
    Array.from(appendLaneOrderByHandle.entries())
      .sort(([leftHandleKey, leftOrder], [rightHandleKey, rightOrder]) => (
        leftOrder - rightOrder || leftHandleKey.localeCompare(rightHandleKey)
      ))
      .forEach(([handleKey]) => {
        const existingNodes = existingAppendLaneNodes.get(handleKey) ?? [];
        const pendingOutputs = pendingAppendOutputsByHandle.get(handleKey) ?? [];
        const pendingDimensions = pendingOutputs.map((output) => resolveOutputNodeDimensions(output.fileInfo));
        const laneHeight = Math.max(
          1,
          ...existingNodes.map((node) => getFileNodeHeight(node)),
          ...pendingDimensions.map((dimensions) => dimensions.height),
        );
        const baseY = existingNodes.length > 0
          ? Math.min(...existingNodes.map((node) => node.position.y))
          : nextFreeLaneY;
        const rightmostEdge = existingNodes.reduce(
          (currentRight, node) => Math.max(currentRight, node.position.x + getFileNodeWidth(node)),
          safeStartX - gapX,
        );
        const nextX = existingNodes.length > 0
          ? Math.max(safeStartX, rightmostEdge + gapX)
          : safeStartX;

        appendLaneStateByHandle.set(handleKey, {
          baseY,
          nextX,
        });
        occupiedLaneBottom = Math.max(occupiedLaneBottom, baseY + laneHeight);
        nextFreeLaneY = occupiedLaneBottom + gapY;
      });
  }

  sortedOutputs.forEach((output) => {
      const layoutIndex = replaceExistingHandleSlot
        ? startIndex + countOccupiedSlotsBefore(output.order, output.sourceHandle)
        : startIndex + appendedNewOutputCount;
      let defaultPosition = {
        x: startX + (layoutIndex % columns) * gapX,
        y: startY + Math.floor(layoutIndex / columns) * gapY,
      };
      if (appendLayoutMode === 'append-grouped-horizontal') {
        const laneState = appendLaneStateByHandle.get(getOutputHandleKey(output.sourceHandle));
        defaultPosition = laneState
          ? {
            x: laneState.nextX,
            y: laneState.baseY,
          }
          : {
            x: safeStartX,
            y: startY,
          };
      } else if (appendLayoutMode === 'append-vertical-column') {
        defaultPosition = {
          x: verticalColumnX,
          y: nextVerticalY,
        };
      }
      const existingSlotNode = replaceExistingHandleSlot
        ? findExistingSlotNode(output.sourceHandle)
        : null;
      const existingNode = existingSlotNode ?? existingOwnedFileNodesByFileId.get(output.fileInfo.id) ?? null;
      if (existingNode) {
        const preservedPosition = (existingSlotNode || !replaceExistingHandleSlot)
          ? existingNode.position
          : defaultPosition;
        const nodeType = mapFileInfoToNodeType(output.fileInfo);
        const refreshedNode = {
          ...existingNode,
          ...createDefaultFileNodeData(
            existingNode.id,
            preservedPosition,
            nodeType,
            output.fileInfo.id,
            output.fileInfo.name,
            output.fileInfo.size,
            output.fileInfo.mimeType,
            output.fileInfo.metadata,
            buildResolvedOutputFileSource(sourceNode, output),
          ),
          position: preservedPosition,
          rotation: existingNode.rotation,
          scale: existingNode.scale,
          locked: existingNode.locked,
          zIndex: existingNode.zIndex,
          timestamp: {
            ...existingNode.timestamp,
            updated: Date.now(),
          },
        };
        const runtimeResource = output.runtimeResource ?? getExecutionOutputRuntimeResource(output.fileInfo.id);

        if (nodeType === 'image') {
          registerExecutionOutputNodeRuntimeSource(refreshedNode.id.value, output.fileInfo.id, {
            workflowId: context.workflow.id,
          });
          if (runtimeResource?.objectUrl) {
            refreshedNode.imageAsset = {
              assetId: output.fileInfo.id,
              source: 'local',
              variants: {
                thumbnail: {
                  url: runtimeResource.objectUrl,
                  width: output.fileInfo.metadata.width,
                  height: output.fileInfo.metadata.height,
                  mimeType: runtimeResource.mimeType,
                  updatedAt: runtimeResource.syncedAt,
                },
                original: {
                  url: output.fileInfo.path,
                  width: output.fileInfo.metadata.width,
                  height: output.fileInfo.metadata.height,
                  mimeType: output.fileInfo.mimeType,
                  updatedAt: output.fileInfo.timestamp.updated,
                },
              },
              intrinsicSize: (
                typeof output.fileInfo.metadata.width === 'number'
                && typeof output.fileInfo.metadata.height === 'number'
              )
                ? {
                  width: output.fileInfo.metadata.width,
                  height: output.fileInfo.metadata.height,
                }
                : undefined,
              version: 1,
            };
            refreshedNode.thumbnailUrl = runtimeResource.objectUrl;
          } else {
            const remoteImage = buildRemoteImageAsset(output.fileInfo.id, output.fileInfo.metadata, {
              thumbnailUrl: output.fileInfo.thumbnailPath,
              originalUrl: output.fileInfo.path,
              getUrl: context.resolveFileUrl,
            });
            refreshedNode.imageAsset = remoteImage.imageAsset;
            refreshedNode.thumbnailUrl = remoteImage.thumbnailUrl;
          }
          refreshedNode.previewUrl = undefined;
        } else if (nodeType === 'video') {
          registerExecutionOutputNodeRuntimeSource(refreshedNode.id.value, output.fileInfo.id, {
            workflowId: context.workflow.id,
          });
          refreshedNode.imageAsset = undefined;
          refreshedNode.thumbnailUrl = undefined;
          refreshedNode.previewUrl = runtimeResource?.objectUrl ?? output.fileInfo.path;
        } else {
          refreshedNode.imageAsset = undefined;
          refreshedNode.thumbnailUrl = undefined;
          refreshedNode.previewUrl = undefined;
        }

        refreshedNode.status = 'idle';
        nextNodesRecord[existingNode.id.value] = refreshedNode;
        existingFileNodesById.set(existingNode.id.value, refreshedNode);
        if (isOwnedBySource(existingNode)) {
          existingOwnedFileNodesByFileId.delete(existingNode.fileId);
        }
        existingOwnedFileNodesByFileId.set(output.fileInfo.id, refreshedNode);
        nextOutputIds.push(output.fileInfo.id);
        if (existingNode.fileId !== output.fileInfo.id && isOwnedBySource(existingNode)) {
          removedOutputIds.add(existingNode.fileId);
        }

        if (replaceExistingHandleSlot) {
          removeConflictingOutputLinks(output.sourceHandle, existingNode.id.value);
        }
        if (!hasOutputLink(existingNode.id.value, output.sourceHandle)) {
          nextConnections.push({
            id: generateUUID(),
            type: 'output-link',
            sourceId: sourceNodeId,
            targetId: existingNode.id.value,
            sourceHandle: output.sourceHandle,
            order: output.order,
          });
        }
        return;
      }

      if (nextOutputNodeSequence === null) {
        nextOutputNodeSequence = getNextOutputNodeSequence(context.workflow);
      }
      const nodeId = createSequentialNodeId(nextOutputNodeSequence);
      nextOutputNodeSequence += 1;
      const nodeType = mapFileInfoToNodeType(output.fileInfo);
      const createdNode = createDefaultFileNodeData(
        nodeId,
        defaultPosition,
        nodeType,
        output.fileInfo.id,
        output.fileInfo.name,
        output.fileInfo.size,
        output.fileInfo.mimeType,
        output.fileInfo.metadata,
        buildResolvedOutputFileSource(context.sourceNode, output),
      );
      const runtimeResource = output.runtimeResource ?? getExecutionOutputRuntimeResource(output.fileInfo.id);

      if (nodeType === 'image') {
        registerExecutionOutputNodeRuntimeSource(createdNode.id.value, output.fileInfo.id, {
          workflowId: context.workflow.id,
        });
        if (runtimeResource?.objectUrl) {
          createdNode.imageAsset = {
            assetId: output.fileInfo.id,
            source: 'local',
            variants: {
              thumbnail: {
                url: runtimeResource.objectUrl,
                width: output.fileInfo.metadata.width,
                height: output.fileInfo.metadata.height,
                mimeType: runtimeResource.mimeType,
                updatedAt: runtimeResource.syncedAt,
              },
              original: {
                url: output.fileInfo.path,
                width: output.fileInfo.metadata.width,
                height: output.fileInfo.metadata.height,
                mimeType: output.fileInfo.mimeType,
                updatedAt: output.fileInfo.timestamp.updated,
              },
            },
            intrinsicSize: (
              typeof output.fileInfo.metadata.width === 'number'
              && typeof output.fileInfo.metadata.height === 'number'
            )
              ? {
                width: output.fileInfo.metadata.width,
                height: output.fileInfo.metadata.height,
              }
              : undefined,
            version: 1,
          };
          createdNode.thumbnailUrl = runtimeResource.objectUrl;
        } else {
          const remoteImage = buildRemoteImageAsset(output.fileInfo.id, output.fileInfo.metadata, {
            thumbnailUrl: output.fileInfo.thumbnailPath,
            originalUrl: output.fileInfo.path,
            getUrl: context.resolveFileUrl,
          });
          createdNode.imageAsset = remoteImage.imageAsset;
          createdNode.thumbnailUrl = remoteImage.thumbnailUrl;
        }
        createdNode.previewUrl = undefined;
      } else if (nodeType === 'video') {
        registerExecutionOutputNodeRuntimeSource(createdNode.id.value, output.fileInfo.id, {
          workflowId: context.workflow.id,
        });
        createdNode.previewUrl = runtimeResource?.objectUrl ?? output.fileInfo.path;
      }

      createdNode.status = 'idle';
      nextNodesRecord[createdNode.id.value] = createdNode;
      existingFileNodesById.set(createdNode.id.value, createdNode);
      existingOwnedFileNodesByFileId.set(output.fileInfo.id, createdNode);
      nextOutputIds.push(output.fileInfo.id);
      if (replaceExistingHandleSlot) {
        removeConflictingOutputLinks(output.sourceHandle, createdNode.id.value);
      }
      if (!hasOutputLink(createdNode.id.value, output.sourceHandle)) {
        nextConnections.push({
          id: generateUUID(),
          type: 'output-link',
          sourceId: sourceNodeId,
          targetId: createdNode.id.value,
          sourceHandle: output.sourceHandle,
          order: output.order,
        });
      }
      if (appendLayoutMode === 'append-grouped-horizontal') {
        const laneState = appendLaneStateByHandle.get(getOutputHandleKey(output.sourceHandle));
        if (laneState) {
          laneState.nextX = createdNode.position.x + getFileNodeWidth(createdNode) + gapX;
        }
      } else if (appendLayoutMode === 'append-vertical-column') {
        nextVerticalY = createdNode.position.y + getFileNodeHeight(createdNode) + gapY;
      } else if (!replaceExistingHandleSlot) {
        appendedNewOutputCount += 1;
      }
    });

  const nextSourceNode: AINodeData = {
    ...sourceNode,
    outputs: appendUniqueOutputIds(
      sourceNode.outputs.filter((fileId) => !removedOutputIds.has(fileId)),
      nextOutputIds,
    ),
    timestamp: {
      ...sourceNode.timestamp,
      updated: Date.now(),
    },
  };

  return {
    nodes: {
      ...nextNodesRecord,
      [sourceNode.id.value]: nextSourceNode,
    },
    connections: nextConnections,
    outputIds: nextOutputIds,
  };
}

export function appendExistingOutputNodes(
  context: RuntimeOutputAppenderContext,
  outputs: ExistingOutputNodeDescriptor[]
): RuntimeOutputWriteResult | null {
  if (outputs.length === 0) {
    return null;
  }

  const sourceNode = resolveLatestRuntimeSourceNode(context.workflow, context.sourceNode);
  const nextNodesRecord: Record<string, FileNodeData> = {};
  const nextConnections = [...context.workflow.connections];
  const nextOutputIds: string[] = [];
  const existingOutputLinkKeys = new Set(
    nextConnections
      .filter((connection) => connection.type === 'output-link')
      .map((connection) => [
        connection.sourceId,
        connection.targetId,
        connection.sourceHandle ?? '',
      ].join('::')),
  );

  outputs
    .slice()
    .sort((left, right) => left.order - right.order)
    .forEach((output) => {
      nextNodesRecord[output.node.id.value] = output.node;
      nextOutputIds.push(output.node.fileId);
      const nextConnectionKey = [
        sourceNode.id.value,
        output.node.id.value,
        output.sourceHandle ?? '',
      ].join('::');
      if (!existingOutputLinkKeys.has(nextConnectionKey)) {
        nextConnections.push({
          id: generateUUID(),
          type: 'output-link',
          sourceId: sourceNode.id.value,
          targetId: output.node.id.value,
          sourceHandle: output.sourceHandle,
          order: output.order,
        });
        existingOutputLinkKeys.add(nextConnectionKey);
      }
    });

  const nextSourceNode: AINodeData = {
    ...sourceNode,
    outputs: appendUniqueOutputIds(sourceNode.outputs, nextOutputIds),
    timestamp: {
      ...sourceNode.timestamp,
      updated: Date.now(),
    },
  };

  return {
    nodes: {
      ...nextNodesRecord,
      [context.sourceNode.id.value]: nextSourceNode,
    },
    connections: nextConnections,
    outputIds: nextOutputIds,
  };
}

export function appendMockExecutionOutputs(
  context: RuntimeOutputAppenderContext,
  descriptors: MockOutputDescriptor[]
): RuntimeOutputWriteResult | null {
  if (descriptors.length === 0) {
    return null;
  }

  const existingOutgoingOutputLinks = context.workflow.connections.filter((connection) =>
    connection.type === 'output-link' && connection.sourceId === context.sourceNode.id.value
  );
  const outputNodes = createMockOutputNodes(
    context.workflow,
    context.sourceNode,
    descriptors,
    getNextOutputNodeSequence(context.workflow)
  );

  return appendExistingOutputNodes(
    context,
    outputNodes.map((node, index) => ({
      node,
      sourceHandle: descriptors[index]?.sourceHandle,
      order: descriptors[index]?.order ?? (existingOutgoingOutputLinks.length + index),
    }))
  );
}

export function buildMockExecutionContext(
  workflow: Workflow,
  node: AINodeData,
  inputs: WorkflowConnectionInput[]
): MockExecutionContext {
  return {
    workflow,
    node,
    inputs,
  };
}
