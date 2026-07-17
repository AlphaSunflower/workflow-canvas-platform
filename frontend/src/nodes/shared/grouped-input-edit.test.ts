import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from 'reactflow';
import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import {
  isGroupedInputInteractionDisabled,
  removeCanvasEdge,
  removeGroupedPortInput,
} from './grouped-input-edit';
import { reorderGroupedPortInputs } from './grouped-input-sort';

function createTimestamp() {
  return {
    created: 1,
    updated: 1,
  };
}

function createFileNode(id: string, type: FileNodeData['type'] = 'image'): ReactFlowNode<AnyNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      id: { value: id, display: `#${id}` },
      type,
      position: { x: 0, y: 0 },
      dimensions: { width: 120, height: 120 },
      rotation: 0,
      scale: 1,
      locked: false,
      status: 'idle',
      zIndex: 0,
      timestamp: createTimestamp(),
      fileId: `file-${id}`,
      fileName: `${id}.png`,
      fileSize: 1024,
      mimeType: 'image/png',
      source: {
        type: 'imported',
        importMethod: 'local',
        importedAt: 1,
      },
      metadata: {
        width: 1024,
        height: 1024,
      },
    },
  };
}

function createAINode(id: string): ReactFlowNode<AnyNodeData> {
  const data: AINodeData = {
    id: { value: id, display: `#${id}` },
    type: 'aiImageGen',
    position: { x: 300, y: 120 },
    dimensions: { width: 320, height: 320 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: createTimestamp(),
    references: [],
    outputs: ['file-image-out-1', 'file-image-out-2'],
    config: {
      inputGroups: [
        { id: 'group-1', label: 'Group 1', order: 0 },
        { id: 'group-2', label: 'Group 2', order: 1 },
      ],
    },
    tasks: [],
  };

  return {
    id,
    position: data.position,
    data,
  };
}

function createEdge(
  id: string,
  source: string,
  target: string,
  options: {
    sourceHandle?: string;
    targetHandle?: string;
    connectionType?: 'file-reference' | 'output-link';
    order?: number;
  } = {}
): ReactFlowEdge {
  return {
    id,
    source,
    target,
    sourceHandle: options.sourceHandle,
    targetHandle: options.targetHandle,
    data: {
      connectionType: options.connectionType ?? 'file-reference',
      order: options.order,
    },
  } as ReactFlowEdge;
}

export function runRemoveGroupedPortInputScenario(options: {
  inputHandle: string;
  outputHandle: string;
  sourceId: string;
  edges: ReactFlowEdge[];
}): ReturnType<typeof removeGroupedPortInput> {
  const nodes = createGroupedInputEditNodes();

  return removeGroupedPortInput(
    nodes,
    options.edges,
    {
      nodeId: 'ai-node-1',
      inputHandle: options.inputHandle,
      outputHandle: options.outputHandle,
      sourceId: options.sourceId,
    }
  );
}

export function runRemoveCanvasEdgeScenario(options: {
  edgeId: string;
  edges: ReactFlowEdge[];
}): ReturnType<typeof removeCanvasEdge> {
  const nodes = createGroupedInputEditNodes();

  return removeCanvasEdge(nodes, options.edges, options.edgeId);
}

export function createGroupedInputEditNodes(): ReactFlowNode<AnyNodeData>[] {
  const targetNode = createAINode('ai-node-1');
  const fileNodes = [
    createFileNode('image-a'),
    createFileNode('image-b'),
    createFileNode('image-c'),
    createFileNode('image-out-1'),
    createFileNode('image-out-2'),
  ];

  return [targetNode, ...fileNodes];
}

export function runReorderGroupedPortInputsScenario(options: {
  inputHandle: string;
  outputHandle: string;
  sourceIds: readonly string[];
  edges: ReactFlowEdge[];
}): ReturnType<typeof reorderGroupedPortInputs> {
  return reorderGroupedPortInputs(
    createGroupedInputEditNodes(),
    options.edges,
    {
      nodeId: 'ai-node-1',
      inputHandle: options.inputHandle,
      outputHandle: options.outputHandle,
      sourceIds: options.sourceIds,
    }
  );
}

export function getGroupedInputInteractionDisabledSnapshot() {
  return {
    locked: isGroupedInputInteractionDisabled({ locked: true, status: 'idle' }),
    queued: isGroupedInputInteractionDisabled({ locked: false, status: 'queued' }),
    processing: isGroupedInputInteractionDisabled({ locked: false, status: 'processing' }),
    idle: isGroupedInputInteractionDisabled({ locked: false, status: 'idle' }),
  };
}

export function createGroupedInputEditEdges() {
  return {
    singleSlot: [
      createEdge('edge-input-1', 'image-a', 'ai-node-1', {
        targetHandle: 'group-1:image',
        order: 0,
      }),
      createEdge('edge-output-1', 'ai-node-1', 'image-out-1', {
        sourceHandle: 'group-1:result',
        connectionType: 'output-link',
      }),
      createEdge('edge-output-2', 'ai-node-1', 'image-out-2', {
        sourceHandle: 'group-2:result',
        connectionType: 'output-link',
      }),
    ] satisfies ReactFlowEdge[],
    dualSlot: [
      createEdge('edge-input-left', 'image-a', 'ai-node-1', {
        targetHandle: 'group-1:white-model',
        order: 0,
      }),
      createEdge('edge-input-right', 'image-b', 'ai-node-1', {
        targetHandle: 'group-1:style-reference',
        order: 0,
      }),
      createEdge('edge-output-1', 'ai-node-1', 'image-out-1', {
        sourceHandle: 'group-1:result',
        connectionType: 'output-link',
      }),
      createEdge('edge-output-2', 'ai-node-1', 'image-out-2', {
        sourceHandle: 'group-2:result',
        connectionType: 'output-link',
      }),
    ] satisfies ReactFlowEdge[],
    sequence: [
      createEdge('edge-input-1', 'image-a', 'ai-node-1', {
        targetHandle: 'group-1:images',
        order: 0,
      }),
      createEdge('edge-input-2', 'image-b', 'ai-node-1', {
        targetHandle: 'group-1:images',
        order: 1,
      }),
      createEdge('edge-input-3', 'image-c', 'ai-node-1', {
        targetHandle: 'group-1:images',
        order: 2,
      }),
      createEdge('edge-output-1', 'ai-node-1', 'image-out-1', {
        sourceHandle: 'group-1:result',
        connectionType: 'output-link',
      }),
      createEdge('edge-output-2', 'ai-node-1', 'image-out-2', {
        sourceHandle: 'group-2:result',
        connectionType: 'output-link',
      }),
    ] satisfies ReactFlowEdge[],
    outputOnly: [
      createEdge('edge-input-1', 'image-a', 'ai-node-1', {
        targetHandle: 'group-1:image',
        order: 0,
      }),
      createEdge('edge-output-1', 'ai-node-1', 'image-out-1', {
        sourceHandle: 'group-1:result',
        connectionType: 'output-link',
      }),
      createEdge('edge-output-2', 'ai-node-1', 'image-out-2', {
        sourceHandle: 'group-2:result',
        connectionType: 'output-link',
      }),
    ] satisfies ReactFlowEdge[],
  };
}
