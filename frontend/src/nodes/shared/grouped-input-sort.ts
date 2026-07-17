import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from 'reactflow';
import type { AINodeData, AnyNodeData } from '@/types';
import {
  getReactFlowEdgeConnectionType,
  getReactFlowEdgeOrder,
  updateReactFlowEdgeOrder,
} from './connection';

export interface ReorderGroupedPortInputsOptions {
  nodeId: string;
  inputHandle: string;
  outputHandle: string;
  sourceIds: readonly string[];
}

export interface ReorderGroupedPortInputsResult {
  nextEdges: ReactFlowEdge[];
  nextNodes: ReactFlowNode<AnyNodeData>[];
}

function reorderList<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return [...items];
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

export function reorderGroupedPortSourceIds(
  sourceIds: readonly string[],
  activeSourceId: string,
  overSourceId: string
): string[] {
  const fromIndex = sourceIds.indexOf(activeSourceId);
  const toIndex = sourceIds.indexOf(overSourceId);
  return reorderList(sourceIds, fromIndex, toIndex);
}

export function reorderGroupedPortInputs(
  nodes: ReactFlowNode<AnyNodeData>[],
  edges: ReactFlowEdge[],
  options: ReorderGroupedPortInputsOptions
): ReorderGroupedPortInputsResult {
  const fileReferenceEdges = edges.filter((edge) =>
    getReactFlowEdgeConnectionType(edge) === 'file-reference' &&
    edge.target === options.nodeId &&
    edge.targetHandle === options.inputHandle
  );

  const fileReferenceEdgesBySourceId = new Map(
    fileReferenceEdges.map((edge) => [edge.source, edge] as const)
  );

  const nextOrderedEdges = options.sourceIds.flatMap((sourceId, index) => {
    const edge = fileReferenceEdgesBySourceId.get(sourceId);
    if (!edge) {
      return [];
    }

    return [updateReactFlowEdgeOrder(edge, index)];
  });

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
    ...nextOrderedEdges,
  ];

  const remainingOutputFileIds = new Set(
    nextEdges
      .filter((edge) =>
        getReactFlowEdgeConnectionType(edge) === 'output-link' &&
        edge.source === options.nodeId
      )
      .flatMap((edge) => {
        const targetNode = nodes.find((node) => node.id === edge.target);
        const targetData = targetNode?.data;
        if (!targetData || (targetData.type !== 'image' && targetData.type !== 'video' && targetData.type !== 'ply')) {
          return [];
        }

        return [targetData.fileId];
      })
  );

  const nextNodes = nodes.map((node) => {
    if (node.id !== options.nodeId) {
      return node;
    }

    const currentData = node.data as AINodeData;
    const nextData: AINodeData = {
      ...currentData,
      outputs: currentData.outputs.filter((fileId) => remainingOutputFileIds.has(fileId)),
      timestamp: {
        ...currentData.timestamp,
        updated: Date.now(),
      },
    };

    return {
      ...node,
      data: nextData,
      position: nextData.position,
    };
  });

  return {
    nextEdges,
    nextNodes,
  };
}

export function getOrderedSourceIdsForHandle(
  edges: ReactFlowEdge[],
  nodeId: string,
  inputHandle: string
): string[] {
  return edges
    .filter((edge) =>
      getReactFlowEdgeConnectionType(edge) === 'file-reference' &&
      edge.target === nodeId &&
      edge.targetHandle === inputHandle
    )
    .sort((left, right) => getReactFlowEdgeOrder(left) - getReactFlowEdgeOrder(right))
    .map((edge) => edge.source);
}
