import type { Edge as ReactFlowEdge } from 'reactflow';
import type { AINodeData, AnyNodeData, Connection, FileNodeData, Workflow } from '@/types';
import { generateUUID } from '@/utils/common/id';
import type {
  NodeConnectionBuildContext,
  NodeConnectionValidationContext,
  NodeInputGroupDefinition,
  NodePortDefinition,
  NodeValidationResult,
} from '../types';
import {
  parseGroupPortHandle,
  type ParsedGroupHandle,
} from './group-port-handle';

function invalid(reason: string): NodeValidationResult {
  return { valid: false, reason };
}

function valid(): NodeValidationResult {
  return { valid: true };
}

function isFileNode(node: AnyNodeData): node is FileNodeData {
  return node.type === 'image' || node.type === 'video' || node.type === 'ply';
}

interface ReactFlowConnectionData {
  connectionType?: Connection['type'];
  order?: number;
}

export type { ParsedGroupHandle } from './group-port-handle';
export { createGroupPortHandle, parseGroupPortHandle } from './group-port-handle';

export interface ResolvedConnectionRule {
  group: NodeInputGroupDefinition | null;
  port: NodePortDefinition | null;
  handle: ParsedGroupHandle | null;
}

export function findGroupPort(
  groups: NodeInputGroupDefinition[],
  handle?: string | null
): { group: NodeInputGroupDefinition; port: NodePortDefinition; handle: ParsedGroupHandle } | null {
  const parsedHandle = parseGroupPortHandle(handle);
  if (!parsedHandle) {
    return null;
  }

  const group = groups.find((item) => item.id === parsedHandle.groupId);
  if (!group) {
    return null;
  }

  const port = group.ports.find((item) => item.id === parsedHandle.portId);
  if (!port) {
    return null;
  }

  return {
    group,
    port,
    handle: parsedHandle,
  };
}

export function resolveConnectionRule(
  groups: NodeInputGroupDefinition[],
  handle?: string | null
): ResolvedConnectionRule {
  const resolved = findGroupPort(groups, handle);
  if (!resolved) {
    return {
      group: null,
      port: null,
      handle: parseGroupPortHandle(handle),
    };
  }

  return resolved;
}

export function rejectAINodeInputs(context: NodeConnectionValidationContext): NodeValidationResult {
  if (!isFileNode(context.sourceNode)) {
    return invalid('Only file nodes can connect into AI node inputs.');
  }

  return valid();
}

export function validateSingleOrderedInput(
  context: NodeConnectionValidationContext,
  accepts: FileNodeData['type'][],
  limit: number
): NodeValidationResult {
  const aiCheck = rejectAINodeInputs(context);
  if (!aiCheck.valid) {
    return aiCheck;
  }

  if (!isFileNode(context.sourceNode)) {
    return invalid('Only file nodes can be connected here.');
  }

  if (!accepts.includes(context.sourceNode.type)) {
    return invalid('Source file type is not accepted by this input.');
  }

  if (typeof context.targetHandle === 'string' && context.targetHandle.length > 0) {
    return invalid('This node only accepts the default input handle.');
  }

  const existingSameSource = context.existingInputs.some((input) => input.sourceNode.id.value === context.sourceNode.id.value);
  if (existingSameSource) {
    return invalid('This file is already connected to the current node.');
  }

  if (context.existingInputs.length >= limit) {
    return invalid(`This node accepts at most ${limit} inputs.`);
  }

  return valid();
}

export function validateGroupedSingleInput(
  context: NodeConnectionValidationContext,
  groups: NodeInputGroupDefinition[]
): NodeValidationResult {
  const aiCheck = rejectAINodeInputs(context);
  if (!aiCheck.valid) {
    return aiCheck;
  }

  if (!isFileNode(context.sourceNode)) {
    return invalid('Only file nodes can be connected here.');
  }

  if (!context.targetHandle) {
    return invalid('A concrete input handle is required.');
  }

  const resolvedGroupPort = findGroupPort(groups, context.targetHandle);
  if (!resolvedGroupPort) {
    return invalid('Target input group does not exist.');
  }

  const { port } = resolvedGroupPort;

  if (!port.accepts.includes(context.sourceNode.type)) {
    return invalid('Source file type is not accepted by this input.');
  }

  const existingForPort = context.existingInputs.filter((item) => item.connection.targetHandle === context.targetHandle);
  if (existingForPort.length >= (port.maxConnections ?? 1)) {
    return invalid('The target input handle is already full.');
  }

  const existingSameSource = context.existingInputs.some((item) =>
    item.sourceNode.id.value === context.sourceNode.id.value &&
    item.connection.targetHandle === context.targetHandle
  );

  if (existingSameSource) {
    return invalid('This file is already connected to the target input handle.');
  }

  return valid();
}

export function validateDefinitionDrivenConnection(
  context: NodeConnectionValidationContext,
  groups: NodeInputGroupDefinition[]
): NodeValidationResult {
  if (!context.targetHandle) {
    return invalid('A concrete input handle is required.');
  }

  return validateGroupedSingleInput(context, groups);
}

export function getNextConnectionOrder(
  context: NodeConnectionBuildContext,
  groups: NodeInputGroupDefinition[]
): number {
  if (!context.targetHandle) {
    return context.existingConnections.length;
  }

  const resolvedGroupPort = findGroupPort(groups, context.targetHandle);
  if (!resolvedGroupPort) {
    return context.existingConnections.length;
  }

  if (resolvedGroupPort.port.orderMode !== 'ordered') {
    return context.existingConnections.length;
  }

  const samePortOrders = context.existingConnections
    .filter((connection) =>
      connection.targetId === context.targetNode.id.value &&
      connection.targetHandle === context.targetHandle &&
      connection.type === 'file-reference'
    )
    .map((connection) => connection.order)
    .filter((order): order is number => typeof order === 'number' && Number.isFinite(order));

  if (samePortOrders.length === 0) {
    return 0;
  }

  return Math.max(...samePortOrders) + 1;
}

export function getConnectedPortCount(inputs: NodeConnectionValidationContext['existingInputs'], handle: string): number {
  return inputs.filter((item) => item.connection.targetHandle === handle).length;
}

export function getConnectedGroupInputs(inputs: NodeConnectionValidationContext['existingInputs'], groupId: string): string[] {
  return inputs
    .filter((item) => item.connection.targetHandle?.startsWith(`${groupId}:`))
    .map((item) => item.connection.targetHandle as string);
}

export function buildFixedGroups(
  node: AINodeData,
  createPorts: (groupId: string, label: string, order: number) => NodeInputGroupDefinition
): NodeInputGroupDefinition[] {
  const rawGroups = Array.isArray(node.config.inputGroups) ? node.config.inputGroups : [];
  const sourceGroups = rawGroups.length > 0
    ? rawGroups
    : [{ id: 'group-1', label: 'Group 1', order: 0 }];

  return sourceGroups.map((group, index) => createPorts(group.id, group.label, index));
}

export function getFileReferenceSourceIdsByHandle(
  workflow: Workflow,
  targetNodeId: string,
  handles: Iterable<string>
): Map<string, string[]> {
  const nextSourceIdsByHandle = new Map<string, string[]>();

  Array.from(handles).forEach((handle) => {
    const sourceIds = workflow.connections
      .filter((connection) =>
        connection.type === 'file-reference' &&
        connection.targetId === targetNodeId &&
        connection.targetHandle === handle
      )
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((connection) => connection.sourceId);

    nextSourceIdsByHandle.set(handle, sourceIds);
  });

  return nextSourceIdsByHandle;
}

export function buildFileReferenceConnectionsByHandle(
  targetNodeId: string,
  inputsByHandle: Map<string, readonly string[]>
): Connection[] {
  return Array.from(inputsByHandle.entries()).flatMap(([handle, sourceIds]) =>
    sourceIds.map((sourceId, index) => ({
      id: generateUUID(),
      type: 'file-reference' as const,
      sourceId,
      targetId: targetNodeId,
      targetHandle: handle,
      order: index,
    }))
  );
}

export function getReactFlowEdgeConnectionType(
  edge: Pick<ReactFlowEdge, 'data'>
): Connection['type'] {
  const connectionType = (edge.data as ReactFlowConnectionData | undefined)?.connectionType;
  return connectionType ?? 'file-reference';
}

export function getReactFlowEdgeOrder(
  edge: Pick<ReactFlowEdge, 'data'>
): number {
  const order = (edge.data as ReactFlowConnectionData | undefined)?.order;
  if (typeof order === 'number' && Number.isFinite(order)) {
    return order;
  }

  return 0;
}

export function updateReactFlowEdgeOrder(
  edge: ReactFlowEdge,
  order: number
): ReactFlowEdge {
  return {
    ...edge,
    data: {
      ...((edge.data as ReactFlowConnectionData | undefined) ?? {}),
      connectionType: getReactFlowEdgeConnectionType(edge),
      order,
    },
  };
}
