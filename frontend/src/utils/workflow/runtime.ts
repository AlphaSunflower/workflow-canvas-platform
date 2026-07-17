import { ConnectionLineType, type Edge, type Node, type Viewport as ReactFlowViewport } from 'reactflow';
import type {
  AnyNodeData,
  AINodeData,
  Connection,
  NodeReference,
  Viewport,
  Workflow,
  WorkflowRelatedTaskRef,
} from '@/types';
import type { WorkflowRuntimeSnapshot } from '@/contracts/workflow';
import { isAINodeData, isFileNodeData } from '@/utils/common/guards';
import {
  ensureAIImageInputGroups,
  normalizeAIImageGenInputHandle,
  normalizeAIImageGenOutputHandle,
} from '@/utils/node/create';
import { createGroupPortHandle } from '@/nodes/shared/group-port-handle';
import {
  AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
  AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
} from '@/nodes/ai-image-inpaint/constants';
import {
  createAIImageInpaintInputGroup,
  getAIImageInpaintInputHandle,
  getAIImageInpaintOutputHandle,
} from '@/nodes/ai-image-inpaint/groups';

export const WORKFLOW_CONNECTION_LINE_TYPE = ConnectionLineType.Bezier;
export const WORKFLOW_CONNECTION_LINE_STYLE = { stroke: '#b1b1b7', strokeWidth: 1 } as const;
const AI_IMAGE_INPUT_PORT_ID = 'images';

type LegacyWorkflowNode = AnyNodeData | {
  type: 'aiChat' | 'group' | 'aiImageRestore';
  [key: string]: unknown;
};

function migrateLegacyNode(node: LegacyWorkflowNode): AnyNodeData | null {
  if (node.type === 'aiChat' || node.type === 'group') {
    return null;
  }

  if (node.type === 'aiImageRestore') {
    return {
      ...(node as unknown as Record<string, unknown>),
      type: 'aiMultiViewRestore',
    } as AnyNodeData;
  }

  return node as unknown as AnyNodeData;
}

export function createReactFlowNode(node: AnyNodeData): Node<AnyNodeData> {
  return {
    id: node.id.value,
    type: node.type,
    position: node.position,
    data: node,
    dragHandle: node.type === 'aiImageGen' ? '.ai-image-gen-node__titlebar' : undefined,
  };
}

export function createReactFlowNodes(nodes: Record<string, AnyNodeData>): Node<AnyNodeData>[] {
  return Object.values(nodes).map(createReactFlowNode);
}

export function createReactFlowEdge(connection: Connection): Edge {
  return {
    id: connection.id,
    source: connection.sourceId,
    target: connection.targetId,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    type: WORKFLOW_CONNECTION_LINE_TYPE,
    animated: false,
    style: { ...WORKFLOW_CONNECTION_LINE_STYLE },
    data: {
      connectionType: connection.type,
      order: connection.order,
    },
  };
}

export function createReactFlowEdges(connections: Connection[]): Edge[] {
  return connections.map(createReactFlowEdge);
}

export function createWorkflowNodesRecord(nodes: Node<AnyNodeData>[]): Record<string, AnyNodeData> {
  return nodes.reduce<Record<string, AnyNodeData>>((accumulator, node) => {
    const transientFileNodeData = (
      (node.data.type === 'image' || node.data.type === 'video' || node.data.type === 'ply') &&
      ('renderTier' in node.data || 'activeState' in node.data || 'activeReasons' in node.data || 'imageResourceOwner' in node.data)
    )
      ? {
        ...node.data,
        renderTier: undefined,
        activeState: undefined,
        activeReasons: undefined,
        imageResourceOwner: undefined,
      }
      : node.data;

    accumulator[node.id] = {
      ...transientFileNodeData,
      position: node.position,
    };
    return accumulator;
  }, {});
}

export function createWorkflowConnections(edges: Edge[]): Connection[] {
  return edges.map((edge) => ({
    id: edge.id,
    type: (edge.data as { connectionType?: Connection['type'] } | undefined)?.connectionType ?? 'file-reference',
    sourceId: edge.source,
    targetId: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    order: (edge.data as { order?: number } | undefined)?.order,
  }));
}

function normalizeAINode(node: AINodeData): AINodeData {
  if (node.type === 'aiImageInpaint') {
    return {
      ...node,
      references: Array.isArray(node.references) ? node.references : [],
      outputs: Array.isArray(node.outputs) ? node.outputs : [],
      tasks: Array.isArray(node.tasks) ? node.tasks : [],
      config: {
        ...node.config,
        aspectRatio: typeof node.config.aspectRatio === 'string' && node.config.aspectRatio.length > 0
          ? node.config.aspectRatio
          : AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO,
        imageSize: typeof node.config.imageSize === 'string' && node.config.imageSize.length > 0
          ? node.config.imageSize
          : AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE,
        maskMode: typeof node.config.maskMode === 'string' && node.config.maskMode.length > 0
          ? node.config.maskMode
          : AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
        editorHeight: typeof node.config.editorHeight === 'number' && Number.isFinite(node.config.editorHeight)
          ? node.config.editorHeight
          : AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
        hasMaskMarks: node.config.hasMaskMarks === true,
        maskStrokes: Array.isArray(node.config.maskStrokes)
          ? node.config.maskStrokes
          : [],
        maskSourceFileId: typeof node.config.maskSourceFileId === 'string'
          ? node.config.maskSourceFileId
          : undefined,
        maskSourceWidth: typeof node.config.maskSourceWidth === 'number' && Number.isFinite(node.config.maskSourceWidth)
          ? node.config.maskSourceWidth
          : undefined,
        maskSourceHeight: typeof node.config.maskSourceHeight === 'number' && Number.isFinite(node.config.maskSourceHeight)
          ? node.config.maskSourceHeight
          : undefined,
        inputGroups: createAIImageInpaintInputGroup(),
      },
    };
  }

  if (node.type !== 'aiImageGen') {
    return {
      ...node,
      references: Array.isArray(node.references) ? node.references : [],
      outputs: Array.isArray(node.outputs) ? node.outputs : [],
      tasks: Array.isArray(node.tasks) ? node.tasks : [],
    };
  }

  return {
    ...node,
    references: Array.isArray(node.references) ? node.references : [],
    outputs: Array.isArray(node.outputs) ? node.outputs : [],
    tasks: Array.isArray(node.tasks) ? node.tasks : [],
    config: {
      ...node.config,
      model: typeof node.config.model === 'string' && node.config.model.length > 0
        ? node.config.model
        : 'gpt-image-2',
      aspectRatio: typeof node.config.aspectRatio === 'string' && node.config.aspectRatio.length > 0
        ? node.config.aspectRatio
        : '1:1',
      resolutionPreset: typeof node.config.resolutionPreset === 'string' && node.config.resolutionPreset.length > 0
        ? node.config.resolutionPreset
        : '1024x1024',
      outputCount: typeof node.config.outputCount === 'number' && Number.isFinite(node.config.outputCount)
        ? node.config.outputCount
        : 1,
      inputGroups: ensureAIImageInputGroups(node.config),
    },
  };
}

function normalizeRelatedTasks(metadata: Workflow['metadata']): WorkflowRelatedTaskRef[] {
  if (!Array.isArray(metadata.relatedTasks)) {
    return [];
  }

  return metadata.relatedTasks.filter((task): task is WorkflowRelatedTaskRef => (
    typeof task === 'object' &&
    task !== null &&
    typeof task.taskId === 'string' &&
    (task.taskNo === undefined || typeof task.taskNo === 'string') &&
    (task.runId === undefined || typeof task.runId === 'string') &&
    (task.runNo === undefined || typeof task.runNo === 'string') &&
    typeof task.nodeId === 'string' &&
    typeof task.nodeDisplayId === 'string' &&
    typeof task.nodeType === 'string' &&
    (task.groupId === undefined || typeof task.groupId === 'string') &&
    (task.groupOrder === undefined || typeof task.groupOrder === 'number') &&
    (task.outputHandle === undefined || typeof task.outputHandle === 'string') &&
    (task.createdAt === undefined || typeof task.createdAt === 'number')
  ));
}

function normalizeWorkflowNode(node: LegacyWorkflowNode): AnyNodeData | null {
  const migrated = migrateLegacyNode(node);
  if (!migrated) {
    return null;
  }

  if (isAINodeData(migrated)) {
    return normalizeAINode(migrated);
  }

  return migrated;
}

function findLegacyReferenceSourceId(
  reference: NodeReference,
  nodesById: Map<string, AnyNodeData>
): string | null {
  const referencedNode = nodesById.get(reference.nodeId);
  if (referencedNode && isFileNodeData(referencedNode) && referencedNode.fileId === reference.fileId) {
    return referencedNode.id.value;
  }

  for (const node of nodesById.values()) {
    if (isFileNodeData(node) && node.fileId === reference.fileId) {
      return node.id.value;
    }
  }

  return null;
}

function createLegacyAIImageConnections(
  nodesById: Map<string, AnyNodeData>,
  existingConnections: Connection[]
): Connection[] {
  const generatedConnections: Connection[] = [];
  const existingKeys = new Set(existingConnections.map((connection) => [
    connection.type,
    connection.sourceId,
    connection.targetId,
    connection.targetHandle ?? '',
  ].join(':')));

  for (const node of nodesById.values()) {
    if (!isAINodeData(node) || node.type !== 'aiImageGen') {
      continue;
    }

    const existingAIInputs = existingConnections.some((connection) =>
      connection.type === 'file-reference' && connection.targetId === node.id.value
    );
    if (existingAIInputs) {
      continue;
    }

    const references = Array.isArray(node.references) ? [...node.references] : [];
    if (references.length === 0) {
      continue;
    }

    const defaultGroupId = ensureAIImageInputGroups(node.config)[0]?.id ?? 'group-1';
    references
      .slice()
      .sort((left, right) => left.order - right.order)
      .forEach((reference, index) => {
        const sourceId = findLegacyReferenceSourceId(reference, nodesById);
        if (!sourceId) {
          return;
        }

        const key = ['file-reference', sourceId, node.id.value, defaultGroupId].join(':');
        if (existingKeys.has(key)) {
          return;
        }

        existingKeys.add(key);
        generatedConnections.push({
          id: `legacy-ai-image-${node.id.value}-${sourceId}-${index + 1}`,
          type: 'file-reference',
          sourceId,
          targetId: node.id.value,
          targetHandle: createGroupPortHandle(defaultGroupId, AI_IMAGE_INPUT_PORT_ID),
          order: typeof reference.order === 'number' && Number.isFinite(reference.order) ? reference.order : index,
        });
      });
  }

  return generatedConnections;
}

function normalizeConnection(
  connection: Connection,
  fallbackOrder: number,
  nodesById: Map<string, AnyNodeData>
): Connection | null {
  if (!nodesById.has(connection.sourceId) || !nodesById.has(connection.targetId)) {
    return null;
  }

  const targetNode = nodesById.get(connection.targetId);
  const normalizedTargetHandle = (
    connection.type === 'file-reference' &&
    targetNode &&
    isAINodeData(targetNode) &&
    targetNode.type === 'aiImageGen'
  )
    ? ((): string | undefined => {
      const defaultGroupId = ensureAIImageInputGroups(targetNode.config)[0]?.id;
      if (!defaultGroupId) {
        return connection.targetHandle;
      }

      return normalizeAIImageGenInputHandle(connection.targetHandle ?? undefined, targetNode.config);
    })()
    : connection.targetHandle;

  const sourceNode = nodesById.get(connection.sourceId);
  const normalizedInpaintTargetHandle = (
    connection.type === 'file-reference' &&
    targetNode &&
    isAINodeData(targetNode) &&
    targetNode.type === 'aiImageInpaint'
  )
    ? getAIImageInpaintInputHandle()
    : normalizedTargetHandle;

  const normalizedSourceHandle = (
    connection.type === 'output-link' &&
    sourceNode &&
    isAINodeData(sourceNode) &&
    sourceNode.type === 'aiImageGen'
  )
    ? normalizeAIImageGenOutputHandle(connection.sourceHandle ?? undefined, sourceNode.config)
    : (
      connection.type === 'output-link' &&
      sourceNode &&
      isAINodeData(sourceNode) &&
      sourceNode.type === 'aiImageInpaint'
    )
      ? getAIImageInpaintOutputHandle()
      : connection.sourceHandle;

  return {
    ...connection,
    sourceHandle: normalizedSourceHandle ?? undefined,
    targetHandle: normalizedInpaintTargetHandle ?? undefined,
    order: typeof connection.order === 'number' && Number.isFinite(connection.order)
      ? connection.order
      : fallbackOrder,
  };
}

export function normalizeWorkflowData(workflow: Workflow): Workflow {
  const normalizedNodes = Object.fromEntries(
    Object.entries(workflow.nodes)
      .map(([nodeId, node]) => [nodeId, normalizeWorkflowNode(node as LegacyWorkflowNode)] as const)
      .filter((entry): entry is [string, AnyNodeData] => entry[1] !== null)
  );

  const nodesById = new Map<string, AnyNodeData>(
    Object.values(normalizedNodes).map((node) => [node.id.value, node])
  );
  const legacyConnections = createLegacyAIImageConnections(nodesById, workflow.connections);
  const normalizedConnections = dedupeAIImageInpaintConnections([
    ...workflow.connections,
    ...legacyConnections,
  ], nodesById)
    .map((connection, index) => normalizeConnection(connection, index, nodesById))
    .filter((connection): connection is Connection => Boolean(connection));

  return {
    ...workflow,
    nodes: normalizedNodes,
    connections: normalizedConnections,
    metadata: {
      ...workflow.metadata,
      relatedTasks: normalizeRelatedTasks(workflow.metadata),
    },
  };
}

function dedupeAIImageInpaintConnections(
  connections: Connection[],
  nodesById: Map<string, AnyNodeData>,
): Connection[] {
  const latestInputByNodeId = new Map<string, Connection>();
  const passthroughConnections: Connection[] = [];

  connections.forEach((connection) => {
    const targetNode = nodesById.get(connection.targetId);
    if (
      connection.type === 'file-reference' &&
      targetNode &&
      isAINodeData(targetNode) &&
      targetNode.type === 'aiImageInpaint'
    ) {
      latestInputByNodeId.set(targetNode.id.value, {
        ...connection,
        targetHandle: getAIImageInpaintInputHandle(),
        order: 0,
      });
      return;
    }

    if (
      connection.type === 'output-link' &&
      nodesById.get(connection.sourceId)?.type === 'aiImageInpaint'
    ) {
      passthroughConnections.push({
        ...connection,
        sourceHandle: getAIImageInpaintOutputHandle(),
      });
      return;
    }

    passthroughConnections.push(connection);
  });

  return [
    ...passthroughConnections,
    ...Array.from(latestInputByNodeId.values()),
  ];
}

export function normalizeViewport(viewport: ReactFlowViewport): Viewport {
  return {
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.zoom,
  };
}

export function createWorkflowRuntimeSnapshot(
  nodes: Node<AnyNodeData>[],
  edges: Edge[],
  viewport: ReactFlowViewport
): WorkflowRuntimeSnapshot {
  return {
    nodes: createWorkflowNodesRecord(nodes),
    connections: createWorkflowConnections(edges),
    viewport: normalizeViewport(viewport),
  };
}
