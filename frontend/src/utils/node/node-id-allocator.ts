import type { NodeId, WorkflowMetadata, Workflow } from '@/types';
import { MAX_NODE_ID, NODE_ID_EXHAUSTED_ERROR, generateNodeId } from './node-id.shared';

export interface NodeIdAllocationResult {
  success: boolean;
  nodeId?: NodeId;
  error?: string;
}

export interface NodeIdBatchAllocationResult {
  success: boolean;
  nodeIds?: NodeId[];
  error?: string;
}

export interface NodeIdAllocatorSnapshot {
  lastIssued: number;
}

export interface NodeIdAllocator {
  next(): NodeIdAllocationResult;
  nextBatch(count: number): NodeIdBatchAllocationResult;
  getLastIssued(): number;
  isExhausted(): boolean;
  snapshot(): NodeIdAllocatorSnapshot;
}

function parseNumericNodeId(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getMaxNodeIdFromNodeMap(nodes: Record<string, Workflow['nodes'][string]>): number {
  return Object.keys(nodes).reduce((max, nodeId) => Math.max(max, parseNumericNodeId(nodeId)), 0);
}

export function getMaxNodeIdFromCollection(nodeIds: readonly string[] | undefined): number {
  if (!Array.isArray(nodeIds)) {
    return 0;
  }

  return nodeIds.reduce((max, nodeId) => Math.max(max, parseNumericNodeId(nodeId)), 0);
}

export function normalizeWorkflowNodeIdMetadata(
  metadata: WorkflowMetadata,
  nodes: Record<string, Workflow['nodes'][string]>,
): WorkflowMetadata {
  const maxNodeIdFromNodes = getMaxNodeIdFromNodeMap(nodes);
  const maxNodeIdFromUsedIds = getMaxNodeIdFromCollection(metadata.usedNodeIds);
  const historicalLastNodeId = parseNumericNodeId(metadata.lastNodeId);
  const normalizedLastNodeId = Math.max(
    historicalLastNodeId,
    maxNodeIdFromNodes,
    maxNodeIdFromUsedIds,
  );

  const usedNodeIds = Array.from(new Set([
    ...(Array.isArray(metadata.usedNodeIds) ? metadata.usedNodeIds : []),
    ...Object.keys(nodes),
  ]));

  return {
    ...metadata,
    lastNodeId: normalizedLastNodeId,
    usedNodeIds,
    releasedNodeIds: Array.isArray(metadata.releasedNodeIds) ? metadata.releasedNodeIds : [],
  };
}

export function createMonotonicNodeIdAllocator(
  initialLastIssued: number = 0,
): NodeIdAllocator {
  let lastIssued = Math.max(0, Math.floor(initialLastIssued));

  function allocateOne(): NodeIdAllocationResult {
    if (lastIssued >= MAX_NODE_ID) {
      return {
        success: false,
        error: NODE_ID_EXHAUSTED_ERROR,
      };
    }

    lastIssued += 1;
    return {
      success: true,
      nodeId: generateNodeId(lastIssued),
    };
  }

  return {
    next(): NodeIdAllocationResult {
      return allocateOne();
    },
    nextBatch(count: number): NodeIdBatchAllocationResult {
      const safeCount = Math.max(0, Math.floor(count));
      if (safeCount === 0) {
        return {
          success: true,
          nodeIds: [],
        };
      }

      if (lastIssued + safeCount > MAX_NODE_ID) {
        return {
          success: false,
          error: NODE_ID_EXHAUSTED_ERROR,
        };
      }

      const nodeIds = Array.from({ length: safeCount }, () => {
        const allocation = allocateOne();
        return allocation.nodeId as NodeId;
      });

      return {
        success: true,
        nodeIds,
      };
    },
    getLastIssued(): number {
      return lastIssued;
    },
    isExhausted(): boolean {
      return lastIssued >= MAX_NODE_ID;
    },
    snapshot(): NodeIdAllocatorSnapshot {
      return { lastIssued };
    },
  };
}

export function createNodeIdAllocatorFromWorkflowMetadata(
  metadata: WorkflowMetadata,
  nodes: Record<string, Workflow['nodes'][string]>,
): NodeIdAllocator {
  const normalizedMetadata = normalizeWorkflowNodeIdMetadata(metadata, nodes);
  return createMonotonicNodeIdAllocator(normalizedMetadata.lastNodeId);
}
