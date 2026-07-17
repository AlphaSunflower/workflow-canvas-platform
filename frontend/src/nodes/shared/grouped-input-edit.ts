import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from 'reactflow';
import type { AINodeData, AnyNodeData } from '@/types';
import {
  parseGroupPortHandle,
  getReactFlowEdgeConnectionType,
  getReactFlowEdgeOrder,
  updateReactFlowEdgeOrder,
} from './connection';
import { removeOrphanedNodeOutputIds } from './runtime';

export interface RemoveGroupedPortInputOptions {
  nodeId: string;
  inputHandle: string;
  outputHandle: string;
  sourceId: string;
}

export interface GroupedInputEditResult {
  nextEdges: ReactFlowEdge[];
  nextNodes: ReactFlowNode<AnyNodeData>[];
}

export interface RemoveCanvasEdgeResult {
  nextEdges: ReactFlowEdge[];
  nextNodes: ReactFlowNode<AnyNodeData>[];
}

export function isGroupedInputInteractionDisabled(options: {
  locked?: boolean;
  status?: string | null;
}): boolean {
  return Boolean(options.locked) ||
    options.status === 'queued' ||
    options.status === 'processing';
}

function patchAINodeOutputs(
  nodes: ReactFlowNode<AnyNodeData>[],
  edges: ReactFlowEdge[],
  nodeId: string
): ReactFlowNode<AnyNodeData>[] {
  const workflowNodes = Object.fromEntries(
    nodes.map((node) => [node.id, node.data] as const),
  );
  const workflowConnections = edges.map((edge) => ({
    id: edge.id,
    type: getReactFlowEdgeConnectionType(edge),
    sourceId: edge.source,
    targetId: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    order: getReactFlowEdgeOrder(edge),
  }));

  return nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    const currentData = node.data as AINodeData;
    const nextData = removeOrphanedNodeOutputIds(currentData, workflowNodes, workflowConnections);

    return {
      ...node,
      data: nextData,
      position: nextData.position,
    };
  });
}

function getGroupResultHandle(inputHandle?: string | null): string | null {
  const parsedHandle = parseGroupPortHandle(inputHandle);
  if (!parsedHandle) {
    return null;
  }

  return `${parsedHandle.groupId}:result`;
}

export function removeGroupedPortInput(
  nodes: ReactFlowNode<AnyNodeData>[],
  edges: ReactFlowEdge[],
  options: RemoveGroupedPortInputOptions
): GroupedInputEditResult {
  const remainingHandleEdges = edges
    .filter((edge) =>
      getReactFlowEdgeConnectionType(edge) === 'file-reference' &&
      edge.target === options.nodeId &&
      edge.targetHandle === options.inputHandle &&
      edge.source !== options.sourceId
    )
    .sort((left, right) => getReactFlowEdgeOrder(left) - getReactFlowEdgeOrder(right))
    .map((edge, index) => updateReactFlowEdgeOrder(edge, index));

  const nextEdges = [
    ...edges.filter((edge) => {
      if (
        getReactFlowEdgeConnectionType(edge) === 'file-reference' &&
        edge.target === options.nodeId &&
        edge.targetHandle === options.inputHandle
      ) {
        return false;
      }

      if (
        getReactFlowEdgeConnectionType(edge) === 'output-link' &&
        edge.source === options.nodeId &&
        edge.sourceHandle === options.outputHandle
      ) {
        return false;
      }

      return true;
    }),
    ...remainingHandleEdges,
  ];

  const nextNodes = patchAINodeOutputs(nodes, nextEdges, options.nodeId);

  return {
    nextEdges,
    nextNodes,
  };
}

export function removeCanvasEdge(
  nodes: ReactFlowNode<AnyNodeData>[],
  edges: ReactFlowEdge[],
  edgeId: string
): RemoveCanvasEdgeResult {
  const edgeToRemove = edges.find((edge) => edge.id === edgeId);
  if (!edgeToRemove) {
    return {
      nextEdges: edges,
      nextNodes: nodes,
    };
  }

  const edgeType = getReactFlowEdgeConnectionType(edgeToRemove);
  const nextEdges = edges.filter((edge) => {
    if (edge.id === edgeId) {
      return false;
    }

    if (
      edgeType === 'file-reference' &&
      getReactFlowEdgeConnectionType(edge) === 'output-link' &&
      edge.source === edgeToRemove.target &&
      edge.sourceHandle === getGroupResultHandle(edgeToRemove.targetHandle)
    ) {
      return false;
    }

    return true;
  });

  if (edgeType !== 'file-reference' && edgeType !== 'output-link') {
    return {
      nextEdges,
      nextNodes: nodes,
    };
  }

  const affectedNodeId = edgeType === 'output-link'
    ? edgeToRemove.source
    : edgeToRemove.target;

  return {
    nextEdges,
    nextNodes: patchAINodeOutputs(nodes, nextEdges, affectedNodeId),
  };
}
