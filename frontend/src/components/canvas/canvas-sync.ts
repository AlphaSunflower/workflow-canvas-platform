import type { AnyNodeData, Connection, FileImportSessionGuard, FileNodeData, Position } from '@/types';
import type { WorkflowHydrationReason } from '@/contracts/workflow';

export interface CanvasSyncNodeLike {
  id: string;
  type?: string;
  position: Position;
  data: AnyNodeData;
}

interface MergeInstanceSnapshotNodesOptions<T extends CanvasSyncNodeLike> {
  preserveNodeIds?: ReadonlySet<string>;
  preserveNodeDataIds?: ReadonlySet<string>;
  preserveMissingCurrentNodes?: boolean;
  transientNodeTypes?: ReadonlySet<string>;
  workflowNodesById?: ReadonlyMap<string, T>;
}

interface MergeWorkflowConnectionsOptions {
  preserveConnectionIds?: ReadonlySet<string>;
  preserveMissingCurrentConnections?: boolean;
}

export function shouldHydrateCanvasFromWorkflow(
  lastAppliedHydrationVersion: number,
  nextHydrationVersion: number,
): boolean {
  return lastAppliedHydrationVersion !== nextHydrationVersion;
}

export function shouldBlockLocalCanvasSyncDuringHydration(params: {
  lastAppliedHydrationVersion: number;
  nextHydrationVersion: number;
  hydrationReason: WorkflowHydrationReason | null;
  pendingExternalHydrationVersion: number | null;
  force?: boolean;
}): boolean {
  if (params.force) {
    return false;
  }

  if (
    params.hydrationReason !== 'external-output'
    || params.pendingExternalHydrationVersion === null
    || params.pendingExternalHydrationVersion !== params.nextHydrationVersion
  ) {
    return false;
  }

  return shouldHydrateCanvasFromWorkflow(
    params.lastAppliedHydrationVersion,
    params.nextHydrationVersion,
  );
}

function stripTransientNodeFlags<T extends CanvasSyncNodeLike>(node: T): T {
  if (!('hidden' in node)) {
    return node;
  }

  const stableNode = { ...node } as T & { hidden?: boolean };
  delete stableNode.hidden;
  return stableNode as T;
}

export function mergeInstanceSnapshotNodes<T extends CanvasSyncNodeLike>(
  currentNodes: readonly T[],
  instanceNodes: readonly T[],
  options: MergeInstanceSnapshotNodesOptions<T> = {},
): T[] {
  const currentNodeMap = new Map(currentNodes.map((node) => [node.id, node] as const));
  const mergedNodes = instanceNodes.map((instanceNode) => {
    const stableInstanceNode = stripTransientNodeFlags(instanceNode);
    const currentNode = currentNodeMap.get(instanceNode.id);
    const workflowNode = options.workflowNodesById?.get(instanceNode.id);
    if (!currentNode) {
      return workflowNode && options.preserveNodeDataIds?.has(instanceNode.id)
        ? stripTransientNodeFlags(workflowNode)
        : stableInstanceNode;
    }

    const nextPosition = instanceNode.position;
    const currentUpdatedAt = currentNode.data.timestamp.updated;
    const instanceUpdatedAt = instanceNode.data.timestamp.updated;
    const isTransientInstanceNodeType = Boolean(
      instanceNode.type && options.transientNodeTypes?.has(instanceNode.type),
    );
    const shouldPreferWorkflowNode = Boolean(
      workflowNode
      && options.preserveNodeDataIds?.has(instanceNode.id),
    );
    const preferredNode = shouldPreferWorkflowNode
      ? workflowNode!
      : isTransientInstanceNodeType
        ? currentNode
      : instanceUpdatedAt > currentUpdatedAt
        ? stableInstanceNode
        : currentNode;
    const stablePreferredNode = stripTransientNodeFlags(preferredNode);
    return {
      ...stablePreferredNode,
      position: nextPosition,
      data: {
        ...stablePreferredNode.data,
        position: nextPosition,
      },
    };
  });

  if (
    !options.preserveNodeIds?.size
    && !options.preserveNodeDataIds?.size
    && options.preserveMissingCurrentNodes !== true
  ) {
    return mergedNodes;
  }

  const preserveNodeIds = options.preserveNodeIds ?? new Set<string>();
  const preserveNodeDataIds = options.preserveNodeDataIds ?? new Set<string>();
  const mergedNodeIds = new Set(mergedNodes.map((node) => node.id));
  const workflowNodesById = options.workflowNodesById ?? currentNodeMap;

  const appendPreservedNode = (nodeId: string, preferWorkflowNode: boolean): void => {
    if (mergedNodeIds.has(nodeId)) {
      return;
    }

    const workflowNode = preferWorkflowNode ? workflowNodesById.get(nodeId) : undefined;
    const currentNode = currentNodeMap.get(nodeId);
    const preservedNode = workflowNode ?? currentNode;
    if (!preservedNode) {
      return;
    }

    mergedNodes.push(stripTransientNodeFlags(preservedNode));
    mergedNodeIds.add(nodeId);
  };

  if (options.preserveMissingCurrentNodes === true) {
    currentNodes.forEach((node) => {
      appendPreservedNode(node.id, false);
    });
  }

  preserveNodeIds.forEach((nodeId) => {
    appendPreservedNode(nodeId, true);
  });

  preserveNodeDataIds.forEach((dataNodeId) => {
    appendPreservedNode(dataNodeId, true);
  });

  return mergedNodes;
}

export function mergeWorkflowConnections(
  currentConnections: readonly Connection[],
  instanceConnections: readonly Connection[],
  options: MergeWorkflowConnectionsOptions = {},
): Connection[] {
  if (
    !options.preserveConnectionIds?.size
    && options.preserveMissingCurrentConnections !== true
  ) {
    return [...instanceConnections];
  }

  const mergedConnections = [...instanceConnections];
  const mergedConnectionIds = new Set(mergedConnections.map((connection) => connection.id));
  const preserveConnectionIds = options.preserveConnectionIds ?? new Set<string>();

  const appendPreservedConnection = (connectionId: string): void => {
    if (mergedConnectionIds.has(connectionId)) {
      return;
    }

    const workflowConnection = currentConnections.find((connection) => connection.id === connectionId);
    if (!workflowConnection) {
      return;
    }

    mergedConnections.push(workflowConnection);
    mergedConnectionIds.add(connectionId);
  };

  if (options.preserveMissingCurrentConnections === true) {
    currentConnections.forEach((connection) => {
      appendPreservedConnection(connection.id);
    });
  }

  preserveConnectionIds.forEach((connectionId) => {
    appendPreservedConnection(connectionId);
  });

  return mergedConnections;
}

export function patchNodeDataList<T extends CanvasSyncNodeLike>(
  currentNodes: readonly T[],
  nodeId: string,
  patcher: Partial<AnyNodeData> | ((node: AnyNodeData) => Partial<AnyNodeData> | null | undefined),
): { nextNodes: T[]; hasUpdated: boolean } {
  let hasUpdated = false;
  const nextNodes = currentNodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    const patch = typeof patcher === 'function' ? patcher(node.data) : patcher;
    if (!patch) {
      return node;
    }

    hasUpdated = true;
    const nextData = {
      ...node.data,
      ...patch,
      position: patch.position ?? node.data.position,
    } as AnyNodeData;

    return {
      ...node,
      position: nextData.position,
      data: nextData,
    };
  });

  return {
    nextNodes,
    hasUpdated,
  };
}

export function shouldApplyImportSessionResult<T extends CanvasSyncNodeLike>(
  currentNodes: readonly T[],
  expectedGuard: FileImportSessionGuard,
  currentGuard: FileImportSessionGuard | undefined,
): boolean {
  if (!currentGuard || currentGuard.sessionId !== expectedGuard.sessionId) {
    return false;
  }

  const node = currentNodes.find((item) => item.id === expectedGuard.nodeId);
  if (!node) {
    return false;
  }

  const fileNode = node.data as FileNodeData;
  return fileNode.fileId === expectedGuard.fileId;
}
