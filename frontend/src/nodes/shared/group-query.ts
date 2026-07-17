import type {
  WorkflowNodeGroupInput,
  WorkflowNodeGroupPortInput,
  WorkflowNodeGroupPortState,
  WorkflowResolvedNodeGroupState,
} from '@/contracts/workflow';
import type { AINodeData, AIImageInputGroup, AnyNodeData, Connection, FileNodeData } from '@/types';
import type {
  NodeResolvedInputGroupState,
  NodeResolvedPortInput,
  NodeResolvedPortState,
  NodeInputGroupDefinition,
} from '../types';
import { ensureAIImageInputGroups, isFileNodeData } from '@/utils/node';
import { createGroupPortHandle, parseGroupPortHandle } from './connection';

function compareNodeCanvasPosition(left: AnyNodeData, right: AnyNodeData): number {
  if (left.position.y !== right.position.y) {
    return left.position.y - right.position.y;
  }

  if (left.position.x !== right.position.x) {
    return left.position.x - right.position.x;
  }

  return left.id.value.localeCompare(right.id.value);
}

function compareConnectionOrder(left: Connection, right: Connection): number {
  const leftOrder = typeof left.order === 'number' ? left.order : 0;
  const rightOrder = typeof right.order === 'number' ? right.order : 0;
  return leftOrder - rightOrder;
}

export function getNodeInputGroupsFromConnections(
  node: AINodeData,
  groupDefinitions: NodeInputGroupDefinition[],
  connections: Connection[],
  nodeMap: Map<string, AnyNodeData>
): NodeResolvedInputGroupState<FileNodeData>[] {
  const configuredGroups = ensureAIImageInputGroups(node.config)
    .slice()
    .sort((left, right) => left.order - right.order);
  const configuredGroupById = new Map(configuredGroups.map((group) => [group.id, group] as const));

  const groups = groupDefinitions.map((definition, index) => {
    const configuredGroup = configuredGroupById.get(definition.id);
    return {
      id: definition.id,
      label: configuredGroup?.label ?? definition.label,
      order: configuredGroup?.order ?? index,
    } satisfies AIImageInputGroup;
  });

  return groups.map((group) => {
    const definition = groupDefinitions.find((item) => item.id === group.id);
    const ports: NodeResolvedPortState<FileNodeData>[] = (definition?.ports ?? []).map((port) => {
      const handle = createGroupPortHandle(group.id, port.id);
      const inputs = connections
        .filter((connection) =>
          connection.type === 'file-reference' &&
          connection.targetId === node.id.value &&
          connection.targetHandle === handle
        )
        .sort(compareConnectionOrder)
        .map((connection) => {
          const sourceNode = nodeMap.get(connection.sourceId);
          if (
            !sourceNode ||
            !isFileNodeData(sourceNode) ||
            !port.accepts.includes(sourceNode.type)
          ) {
            return null;
          }

          return {
            groupId: group.id,
            portId: port.id,
            handle,
            connection,
            sourceNode,
          } satisfies NodeResolvedPortInput<FileNodeData>;
        })
        .filter((item): item is NodeResolvedPortInput<FileNodeData> => Boolean(item))
        .sort((left, right) => {
          const orderDelta = compareConnectionOrder(left.connection, right.connection);
          if (orderDelta !== 0) {
            return orderDelta;
          }

          return compareNodeCanvasPosition(left.sourceNode, right.sourceNode);
        });

      return {
        port,
        handle,
        inputs,
      };
    });

    return {
      group,
      ports,
    };
  });
}

export function getPortInputsFromGroups<TNode extends AnyNodeData = FileNodeData>(
  groups: NodeResolvedInputGroupState<TNode>[],
  groupId: string,
  portId: string
): NodeResolvedPortInput<TNode>[] {
  const group = groups.find((item) => item.group.id === groupId);
  if (!group) {
    return [];
  }

  const port = group.ports.find((item) => item.port.id === portId);
  return port?.inputs ?? [];
}

export function countConnectedPortInputs(groups: NodeResolvedInputGroupState[], handle: string): number {
  const parsedHandle = parseGroupPortHandle(handle);
  if (!parsedHandle) {
    return 0;
  }

  return getPortInputsFromGroups(groups, parsedHandle.groupId, parsedHandle.portId).length;
}

export function countConnectedGroupInputs(groups: NodeResolvedInputGroupState[], groupId: string): number {
  const group = groups.find((item) => item.group.id === groupId);
  if (!group) {
    return 0;
  }

  return group.ports.reduce((sum, port) => sum + port.inputs.length, 0);
}

export function hasAnyGroupInputs(groups: NodeResolvedInputGroupState[]): boolean {
  return groups.some((group) => group.ports.some((port) => port.inputs.length > 0));
}

export function findResolvedInputGroup(
  groups: NodeResolvedInputGroupState[],
  groupId: string
): NodeResolvedInputGroupState | null {
  return groups.find((group) => group.group.id === groupId) ?? null;
}

export function findResolvedPort(
  groups: NodeResolvedInputGroupState[],
  handle: string
): NodeResolvedPortState | null {
  const parsedHandle = parseGroupPortHandle(handle);
  if (!parsedHandle) {
    return null;
  }

  const group = findResolvedInputGroup(groups, parsedHandle.groupId);
  if (!group) {
    return null;
  }

  return group.ports.find((port) => port.port.id === parsedHandle.portId) ?? null;
}

export function getNormalizedInputGroups(config: AINodeData['config'] | undefined): AIImageInputGroup[] {
  return ensureAIImageInputGroups(config)
    .slice()
    .sort((left, right) => left.order - right.order);
}

export function toWorkflowNodeGroupPortInput(
  input: NodeResolvedPortInput<FileNodeData>
): WorkflowNodeGroupPortInput {
  return {
    groupId: input.groupId,
    portId: input.portId,
    handle: input.handle,
    connection: input.connection,
    sourceNode: input.sourceNode,
  };
}

export function toWorkflowNodeGroupPortState(
  port: NodeResolvedPortState<FileNodeData>
): WorkflowNodeGroupPortState {
  return {
    portId: port.port.id,
    label: port.port.label,
    handle: port.handle,
    inputs: port.inputs.map(toWorkflowNodeGroupPortInput),
  };
}

export function toWorkflowResolvedNodeGroupState(
  group: NodeResolvedInputGroupState<FileNodeData>
): WorkflowResolvedNodeGroupState {
  return {
    group: group.group,
    ports: group.ports.map(toWorkflowNodeGroupPortState),
  };
}

export function toWorkflowResolvedNodeGroupStates(
  groups: NodeResolvedInputGroupState<FileNodeData>[]
): WorkflowResolvedNodeGroupState[] {
  return groups.map(toWorkflowResolvedNodeGroupState);
}

export function getFlattenedGroupInputs(
  group: NodeResolvedInputGroupState<FileNodeData>
): WorkflowNodeGroupInput[] {
  return group.ports
    .flatMap((port) => port.inputs)
    .map((input) => ({
      groupId: input.groupId,
      connection: input.connection,
      sourceNode: input.sourceNode,
    }));
}
