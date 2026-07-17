import { useCallback, useMemo } from 'react';
import type {
  WorkflowConnectionInput,
  WorkflowNodeGroupInput,
  WorkflowNodeGroupPortInput,
  WorkflowNodeGroupState,
  WorkflowResolvedNodeGroupState,
} from '@/contracts/workflow';
import type {
  AINodeData,
  AnyNodeData,
  Connection,
  FileNodeData,
  NodeTaskRef,
} from '@/types';
import { getNodeDefinition } from '@/nodes/registry';
import { getNodeDisplayName, isAINodeData, isFileNodeData } from '@/utils';
import {
  getFlattenedGroupInputs,
  getNodeInputGroupsFromConnections,
  hasAnyGroupInputs,
  toWorkflowResolvedNodeGroupStates,
} from './group-query';

interface UseWorkflowGraphSelectorsOptions {
  nodes: AnyNodeData[];
  connections: Connection[];
}

export interface WorkflowGraphSelectors {
  getNodeById: (nodeId: string) => AnyNodeData | null;
  getConnectionsForNode: (nodeId: string) => Connection[];
  getIncomingConnections: (nodeId: string) => Connection[];
  getOutgoingConnections: (nodeId: string) => Connection[];
  getIncomingSourceNodes: (nodeId: string) => AnyNodeData[];
  getConnectedFileInputs: (nodeId: string) => FileNodeData[];
  getConnectedAIInputs: (nodeId: string) => AINodeData[];
  getNodeInputSummary: (nodeId: string) => WorkflowConnectionInput[];
  getResolvedNodeInputGroups: (nodeId: string) => WorkflowResolvedNodeGroupState[];
  getResolvedNodeGroupPortInputs: (nodeId: string, groupId: string, portId: string) => WorkflowNodeGroupPortInput[];
  hasResolvedNodeGroupInputs: (nodeId: string) => boolean;
  getNodeGroupInputs: (nodeId: string, groupId: string) => WorkflowNodeGroupInput[];
  getNodeInputGroups: (nodeId: string) => WorkflowNodeGroupState[];
  hasNodeGroupInputs: (nodeId: string) => boolean;
  getNodeTasks: (nodeId: string) => NodeTaskRef[];
  getNodeDisplayName: (nodeId: string) => string;
  getAllNodeInputs: (nodeId: string) => WorkflowConnectionInput[];
}

function getConnectionIndex(connections: Connection[], connection: Connection): number {
  return connections.findIndex((candidate) => candidate.id === connection.id);
}

export function useWorkflowGraphSelectors(
  options: UseWorkflowGraphSelectorsOptions,
): WorkflowGraphSelectors {
  const { nodes, connections } = options;

  const connectionsBySource = useMemo(() => {
    const map = new Map<string, Connection[]>();
    connections.forEach((connection) => {
      const current = map.get(connection.sourceId) ?? [];
      current.push(connection);
      map.set(connection.sourceId, current);
    });
    return map;
  }, [connections]);

  const connectionsByTarget = useMemo(() => {
    const map = new Map<string, Connection[]>();
    connections.forEach((connection) => {
      const current = map.get(connection.targetId) ?? [];
      current.push(connection);
      map.set(connection.targetId, current);
    });
    return map;
  }, [connections]);

  const nodeMap = useMemo(() => {
    return new Map<string, AnyNodeData>(nodes.map((node) => [node.id.value, node]));
  }, [nodes]);

  const getNodeById = useCallback((nodeId: string): AnyNodeData | null => {
    return nodeMap.get(nodeId) ?? null;
  }, [nodeMap]);

  const getNodeTasks = useCallback((nodeId: string): NodeTaskRef[] => {
    const node = nodeMap.get(nodeId);
    return node && isAINodeData(node) ? node.tasks : [];
  }, [nodeMap]);

  const getNodeNameById = useCallback((nodeId: string): string => {
    const node = nodeMap.get(nodeId);
    return node ? getNodeDisplayName(node.type) : nodeId;
  }, [nodeMap]);

  const getConnectionsForNode = useCallback((nodeId: string): Connection[] => {
    return connections.filter((connection) => connection.sourceId === nodeId || connection.targetId === nodeId);
  }, [connections]);

  const getIncomingConnections = useCallback((nodeId: string): Connection[] => {
    return connectionsByTarget.get(nodeId) ?? [];
  }, [connectionsByTarget]);

  const getOutgoingConnections = useCallback((nodeId: string): Connection[] => {
    return connectionsBySource.get(nodeId) ?? [];
  }, [connectionsBySource]);

  const getIncomingSourceNodes = useCallback((nodeId: string): AnyNodeData[] => {
    return getIncomingConnections(nodeId)
      .map((connection) => nodeMap.get(connection.sourceId))
      .filter((node): node is AnyNodeData => Boolean(node));
  }, [getIncomingConnections, nodeMap]);

  const getConnectedFileInputs = useCallback((nodeId: string): FileNodeData[] => {
    return getIncomingSourceNodes(nodeId).filter((node): node is FileNodeData => isFileNodeData(node));
  }, [getIncomingSourceNodes]);

  const getConnectedAIInputs = useCallback((nodeId: string): AINodeData[] => {
    return getIncomingSourceNodes(nodeId).filter((node): node is AINodeData => isAINodeData(node));
  }, [getIncomingSourceNodes]);

  const getNodeInputSummary = useCallback((nodeId: string): WorkflowConnectionInput[] => {
    return getIncomingConnections(nodeId)
      .map((connection) => {
        const sourceNode = nodeMap.get(connection.sourceId);
        const targetNode = nodeMap.get(connection.targetId);

        if (!sourceNode || !targetNode) {
          return null;
        }

        return {
          connection,
          sourceNode,
          targetNode,
        };
      })
      .filter((item): item is WorkflowConnectionInput => Boolean(item))
      .sort((left, right) => getConnectionIndex(connections, left.connection) - getConnectionIndex(connections, right.connection));
  }, [connections, getIncomingConnections, nodeMap]);

  const getResolvedNodeInputGroups = useCallback((nodeId: string): WorkflowResolvedNodeGroupState[] => {
    const targetNode = nodeMap.get(nodeId);
    if (!targetNode || !isAINodeData(targetNode)) {
      return [];
    }

    const definition = getNodeDefinition(targetNode.type);
    const groups = definition?.resolveInputGroups?.(targetNode) ?? [];
    if (groups.length === 0) {
      return [];
    }

    return toWorkflowResolvedNodeGroupStates(
      getNodeInputGroupsFromConnections(targetNode, groups, getIncomingConnections(nodeId), nodeMap),
    );
  }, [getIncomingConnections, nodeMap]);

  const getResolvedNodeGroupPortInputs = useCallback((nodeId: string, groupId: string, portId: string): WorkflowNodeGroupPortInput[] => {
    const groups = getResolvedNodeInputGroups(nodeId);
    const group = groups.find((item) => item.group.id === groupId);
    if (!group) {
      return [];
    }

    const port = group.ports.find((item) => item.portId === portId);
    return port?.inputs ?? [];
  }, [getResolvedNodeInputGroups]);

  const hasResolvedNodeGroupInputs = useCallback((nodeId: string): boolean => {
    const targetNode = nodeMap.get(nodeId);
    if (!targetNode || !isAINodeData(targetNode)) {
      return false;
    }

    const definition = getNodeDefinition(targetNode.type);
    const groups = definition?.resolveInputGroups?.(targetNode) ?? [];
    if (groups.length === 0) {
      return false;
    }

    return hasAnyGroupInputs(
      getNodeInputGroupsFromConnections(targetNode, groups, getIncomingConnections(nodeId), nodeMap),
    );
  }, [getIncomingConnections, nodeMap]);

  const getNodeGroupInputs = useCallback((nodeId: string, groupId: string): WorkflowNodeGroupInput[] => {
    const resolvedGroup = getResolvedNodeInputGroups(nodeId).find((group) => group.group.id === groupId);
    if (!resolvedGroup) {
      return [];
    }

    return resolvedGroup.ports.flatMap((port) =>
      port.inputs.map((input) => ({
        groupId: input.groupId,
        connection: input.connection,
        sourceNode: input.sourceNode,
      })),
    );
  }, [getResolvedNodeInputGroups]);

  const getNodeInputGroups = useCallback((nodeId: string): WorkflowNodeGroupState[] => {
    const targetNode = nodeMap.get(nodeId);
    if (!targetNode || !isAINodeData(targetNode)) {
      return [];
    }

    const definition = getNodeDefinition(targetNode.type);
    const groups = definition?.resolveInputGroups?.(targetNode) ?? [];
    if (groups.length === 0) {
      return [];
    }

    return getNodeInputGroupsFromConnections(targetNode, groups, getIncomingConnections(nodeId), nodeMap)
      .map((groupState) => ({
        group: groupState.group,
        inputs: getFlattenedGroupInputs(groupState),
      }));
  }, [getIncomingConnections, nodeMap]);

  const hasNodeGroupInputs = useCallback((nodeId: string): boolean => {
    return hasResolvedNodeGroupInputs(nodeId);
  }, [hasResolvedNodeGroupInputs]);

  return useMemo(() => ({
    getNodeById,
    getConnectionsForNode,
    getIncomingConnections,
    getOutgoingConnections,
    getIncomingSourceNodes,
    getConnectedFileInputs,
    getConnectedAIInputs,
    getNodeInputSummary,
    getResolvedNodeInputGroups,
    getResolvedNodeGroupPortInputs,
    hasResolvedNodeGroupInputs,
    getNodeGroupInputs,
    getNodeInputGroups,
    hasNodeGroupInputs,
    getNodeTasks,
    getNodeDisplayName: getNodeNameById,
    getAllNodeInputs: getNodeInputSummary,
  }), [
    getConnectedAIInputs,
    getConnectedFileInputs,
    getConnectionsForNode,
    getIncomingConnections,
    getIncomingSourceNodes,
    getNodeById,
    getNodeGroupInputs,
    getNodeInputGroups,
    getNodeInputSummary,
    getNodeNameById,
    getNodeTasks,
    getOutgoingConnections,
    getResolvedNodeGroupPortInputs,
    getResolvedNodeInputGroups,
    hasNodeGroupInputs,
    hasResolvedNodeGroupInputs,
  ]);
}
