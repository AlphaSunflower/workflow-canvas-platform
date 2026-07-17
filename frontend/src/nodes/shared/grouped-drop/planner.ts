import type { AIImageInputGroup, AINodeData, AnyNodeData, Workflow } from '@/types';
import type {
  NodeDropPlan,
  NodeDropPreview,
  NodeDropTargetContext,
  NodeInputGroupDefinition,
  NodePortDefinition,
} from '../../types';
import {
  buildFileReferenceConnectionsByHandle,
  createGroupPortHandle,
  findGroupPort,
  getFileReferenceSourceIdsByHandle,
} from '../connection';
import {
  createInvalidDropPreview,
  createValidDropPreview,
  replaceNodeConnections,
  resolveGroupedDropMode,
  resolveGroupedDropPortId,
  resolveGroupedDropTarget,
} from '../drop';
import {
  appendInputGroups,
  getConfiguredInputGroups,
  updateNodeInputGroups,
} from '../groups';
import type {
  GroupedDropPanelSide,
  GroupedDropSidePortMap,
  GroupedDropTarget,
} from './types';

export interface GroupedDropPlannerOptions<
  TNode extends AINodeData = AINodeData,
  TDraggedNode extends AnyNodeData = AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
> {
  getTargetNode: (workflow: Workflow, nodeId: string) => TNode | null;
  resolveInputGroups: (node: TNode) => NodeInputGroupDefinition[];
  normalizeDraggedNodes: (nodes: AnyNodeData[]) => TDraggedNode[];
  sidePortMap: GroupedDropSidePortMap<TSide>;
  maxGroups: number;
  allowCtrl?: boolean;
  allowShift?: boolean;
  ctrlSingleBroadcast?: boolean;
  appendGroups?: (groups: AIImageInputGroup[], count: number) => AIImageInputGroup[];
  validateDraggedNodes?: (nodes: TDraggedNode[]) => string | null;
  resolveDropTarget?: (
    context: NodeDropTargetContext,
    mode: ReturnType<typeof resolveGroupedDropMode>
  ) => GroupedDropTarget<TSide> | null;
}

interface ResolvedPlannerState<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string,
> {
  targetNode: TNode;
  droppedNodes: TDraggedNode[];
  dropTarget: GroupedDropTarget<TSide>;
  groupDefinitions: NodeInputGroupDefinition[];
  configuredGroups: AIImageInputGroup[];
  inputsByHandle: Map<string, string[]>;
  mode: ReturnType<typeof resolveGroupedDropMode>;
}

type PlannerResolution<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string,
> =
  | {
      ok: true;
      state: ResolvedPlannerState<TNode, TDraggedNode, TSide>;
    }
  | {
      ok: false;
      preview: NodeDropPreview;
    };

export function findGroupedDropPortDefinition(
  groupDefinitions: NodeInputGroupDefinition[],
  portId: string
): NodePortDefinition | null {
  for (const group of groupDefinitions) {
    const port = group.ports.find((item) => item.id === portId);
    if (port) {
      return port;
    }
  }

  return null;
}

function getGroupHandles(groupDefinitions: NodeInputGroupDefinition[]): string[] {
  return groupDefinitions.flatMap((group) =>
    group.ports.map((port) => createGroupPortHandle(group.id, port.id))
  );
}

export function getGroupedDropCurrentInputsByHandle(
  workflow: Workflow,
  targetNodeId: string,
  groupDefinitions: NodeInputGroupDefinition[]
): Map<string, string[]> {
  return getFileReferenceSourceIdsByHandle(
    workflow,
    targetNodeId,
    getGroupHandles(groupDefinitions)
  );
}

function resolvePlannerState<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string,
>(
  context: NodeDropTargetContext,
  options: GroupedDropPlannerOptions<TNode, TDraggedNode, TSide>
): PlannerResolution<TNode, TDraggedNode, TSide> {
  const targetNode = options.getTargetNode(context.workflow, context.target.nodeId);
  if (!targetNode) {
    return {
      ok: false,
      preview: createInvalidDropPreview('The current node does not support this grouped drop action.'),
    };
  }

  const droppedNodes = options.normalizeDraggedNodes(context.draggedNodes);
  if (droppedNodes.length === 0 || droppedNodes.length !== context.draggedNodes.length) {
    return {
      ok: false,
      preview: createInvalidDropPreview('Only supported file nodes can be dropped here.'),
    };
  }

  const mode = resolveGroupedDropMode(context.keyboard);
  const draggedNodeValidationReason = options.validateDraggedNodes?.(droppedNodes);
  if (draggedNodeValidationReason) {
    return {
      ok: false,
      preview: createInvalidDropPreview(draggedNodeValidationReason),
    };
  }

  const dropTarget =
    options.resolveDropTarget?.(context, mode) ??
    resolveGroupedDropTarget<TSide>(context.target);
  if (!dropTarget) {
    return {
      ok: false,
      preview: createInvalidDropPreview('Drop onto a specific slot or the input panel.'),
    };
  }

  const groupDefinitions = options.resolveInputGroups(targetNode);
  const configuredGroups = getConfiguredInputGroups(targetNode.config);
  const inputsByHandle = getGroupedDropCurrentInputsByHandle(
    context.workflow,
    targetNode.id.value,
    groupDefinitions
  );

  return {
    ok: true,
    state: {
      targetNode,
      droppedNodes,
      dropTarget,
      groupDefinitions,
      configuredGroups,
      inputsByHandle,
      mode,
    },
  };
}

function getTargetPortDefinition<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string,
>(
  state: ResolvedPlannerState<TNode, TDraggedNode, TSide>,
  options: GroupedDropPlannerOptions<TNode, TDraggedNode, TSide>
): NodePortDefinition | null {
  if (state.dropTarget.kind === 'slot') {
    return findGroupPort(
      state.groupDefinitions,
      createGroupPortHandle(state.dropTarget.groupId, state.dropTarget.portId)
    )?.port ?? null;
  }

  const portId = resolveGroupedDropPortId(state.dropTarget, options.sidePortMap);
  if (!portId) {
    return null;
  }

    return findGroupedDropPortDefinition(state.groupDefinitions, portId);
  }

export function getGroupedDropEmptyHandlesForPort(
  groups: AIImageInputGroup[],
  groupDefinitions: NodeInputGroupDefinition[],
  inputsByHandle: Map<string, string[]>,
  portId: string
): string[] {
  return groups
    .map((group) => createGroupPortHandle(group.id, portId))
    .filter((handle) => {
      const resolvedPort = findGroupPort(groupDefinitions, handle);
      if (!resolvedPort) {
        return false;
      }

      return (inputsByHandle.get(handle)?.length ?? 0) === 0;
    });
}

export function cloneGroupedDropInputsByHandle(inputsByHandle: Map<string, string[]>): Map<string, string[]> {
  return new Map(
    Array.from(inputsByHandle.entries()).map(([handle, sourceIds]) => [handle, [...sourceIds]])
  );
}

function assignNodesToHandles(
  inputsByHandle: Map<string, string[]>,
  handles: string[],
  droppedNodes: AnyNodeData[]
): Map<string, string[]> {
  const nextInputsByHandle = cloneGroupedDropInputsByHandle(inputsByHandle);

  droppedNodes.forEach((node, index) => {
    const handle = handles[index];
    if (!handle) {
      return;
    }

    nextInputsByHandle.set(handle, [node.id.value]);
  });

  return nextInputsByHandle;
}

function assignSingleNodeToAllHandles(
  inputsByHandle: Map<string, string[]>,
  handles: string[],
  droppedNode: AnyNodeData
): Map<string, string[]> {
  const nextInputsByHandle = cloneGroupedDropInputsByHandle(inputsByHandle);

  handles.forEach((handle) => {
    nextInputsByHandle.set(handle, [droppedNode.id.value]);
  });

  return nextInputsByHandle;
}

export function validateGroupedDropPortAcceptance(
  port: NodePortDefinition,
  droppedNodes: AnyNodeData[]
): NodeDropPreview | null {
  const invalidNode = droppedNodes.find((node) => !port.accepts.includes(node.type as never));
  if (invalidNode) {
    return createInvalidDropPreview('The dropped file type is not accepted by the target port.');
  }

  return null;
}

export function validateGroupedDropPlan<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
>(
  context: NodeDropTargetContext,
  options: GroupedDropPlannerOptions<TNode, TDraggedNode, TSide>
): NodeDropPreview {
  const resolved = resolvePlannerState(context, options);
  if (!resolved.ok) {
    return resolved.preview;
  }

  const { state } = resolved;
  const allowCtrl = options.allowCtrl ?? true;
  const allowShift = options.allowShift ?? true;
  const targetPort = getTargetPortDefinition(state, options);

  if (!targetPort) {
    return createInvalidDropPreview('The target port could not be resolved for this drop action.');
  }

  const acceptanceResult = validateGroupedDropPortAcceptance(targetPort, state.droppedNodes);
  if (acceptanceResult) {
    return acceptanceResult;
  }

  if (state.mode === 'invalid') {
    return createInvalidDropPreview('Shift + Ctrl is not supported for the same drop action.');
  }

  if (state.mode === 'normal') {
    if (state.dropTarget.kind !== 'slot') {
      return createInvalidDropPreview('Normal drag requires a specific slot target.');
    }

    if (state.droppedNodes.length !== 1) {
      return createInvalidDropPreview('Normal drag supports only one file at a time.');
    }

    const handle = createGroupPortHandle(state.dropTarget.groupId, state.dropTarget.portId);
    const currentInputs = state.inputsByHandle.get(handle) ?? [];

    if (currentInputs.includes(state.droppedNodes[0].id.value)) {
      return createInvalidDropPreview('This file is already connected to the target slot.');
    }

    if (currentInputs.length >= (targetPort.maxConnections ?? 1)) {
      return createInvalidDropPreview('The target slot is already full.');
    }

    return createValidDropPreview();
  }

  if (state.dropTarget.kind !== 'panel') {
    return createInvalidDropPreview('Batch drag requires the input panel target.');
  }

  const panelPortId = resolveGroupedDropPortId(state.dropTarget, options.sidePortMap);
  if (!panelPortId) {
    return createInvalidDropPreview('The panel side is not mapped to any input port.');
  }

  const emptyHandles = getGroupedDropEmptyHandlesForPort(
    state.configuredGroups,
    state.groupDefinitions,
    state.inputsByHandle,
    panelPortId
  );

  if (state.mode === 'ctrl') {
    if (!allowCtrl) {
      return createInvalidDropPreview('Ctrl batch fill is not enabled for this node.');
    }

    if (emptyHandles.length === 0) {
      return createInvalidDropPreview('No empty slots are available on the target side.');
    }

    if (state.droppedNodes.length === 1 && options.ctrlSingleBroadcast) {
      return createValidDropPreview();
    }

    if (state.droppedNodes.length > emptyHandles.length) {
      return createInvalidDropPreview(`Only ${emptyHandles.length} empty slots are available on the target side.`);
    }

    return createValidDropPreview();
  }

  if (!allowShift) {
    return createInvalidDropPreview('Shift batch expansion is not enabled for this node.');
  }

  const missingGroupCapacity = Math.max(0, options.maxGroups - state.configuredGroups.length);
  const totalCapacity = emptyHandles.length + missingGroupCapacity;
  if (state.droppedNodes.length > totalCapacity) {
    return createInvalidDropPreview(`Only ${totalCapacity} files can be accepted on the target side.`);
  }

  return createValidDropPreview();
}

export function buildGroupedDropPlan<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
>(
  context: NodeDropTargetContext,
  options: GroupedDropPlannerOptions<TNode, TDraggedNode, TSide>
): NodeDropPlan | null {
  const validation = validateGroupedDropPlan(context, options);
  if (!validation.valid) {
    return null;
  }

  const resolved = resolvePlannerState(context, options);
  if (!resolved.ok) {
    return null;
  }

  const { state } = resolved;
  let nextGroups = state.configuredGroups;
  let nextInputsByHandle = cloneGroupedDropInputsByHandle(state.inputsByHandle);

  if (state.mode === 'normal') {
    if (state.dropTarget.kind !== 'slot' || state.droppedNodes.length !== 1) {
      return null;
    }

    const handle = createGroupPortHandle(state.dropTarget.groupId, state.dropTarget.portId);
    nextInputsByHandle.set(handle, [state.droppedNodes[0].id.value]);
  } else {
    if (state.dropTarget.kind !== 'panel') {
      return null;
    }

    const panelPortId = resolveGroupedDropPortId(state.dropTarget, options.sidePortMap);
    if (!panelPortId) {
      return null;
    }

    const emptyHandles = getGroupedDropEmptyHandlesForPort(
      state.configuredGroups,
      state.groupDefinitions,
      nextInputsByHandle,
      panelPortId
    );

    if (state.mode === 'ctrl') {
      if (state.droppedNodes.length === 1 && options.ctrlSingleBroadcast) {
        nextInputsByHandle = assignSingleNodeToAllHandles(
          nextInputsByHandle,
          emptyHandles,
          state.droppedNodes[0]
        );
      } else {
        nextInputsByHandle = assignNodesToHandles(
          nextInputsByHandle,
          emptyHandles,
          state.droppedNodes
        );
      }
    } else {
      const requiredExtraGroups = Math.max(0, state.droppedNodes.length - emptyHandles.length);
      const appendGroupsFn = options.appendGroups ?? appendInputGroups;

      if (requiredExtraGroups > 0) {
        nextGroups = appendGroupsFn(state.configuredGroups, requiredExtraGroups);
      }

      const nextTargetNodeForGroups = updateNodeInputGroups(state.targetNode, nextGroups) as TNode;
      const nextGroupDefinitions = options.resolveInputGroups(nextTargetNodeForGroups);
      const nextHandles = getGroupedDropEmptyHandlesForPort(
        nextGroups,
        nextGroupDefinitions,
        nextInputsByHandle,
        panelPortId
      );

      nextInputsByHandle = assignNodesToHandles(
        nextInputsByHandle,
        nextHandles,
        state.droppedNodes
      );
    }
  }

  const nextTargetNode = updateNodeInputGroups(state.targetNode, nextGroups);
  const nextConnections = buildFileReferenceConnectionsByHandle(
    nextTargetNode.id.value,
    nextInputsByHandle
  );

  return {
    nextTargetNode,
    nextConnections: replaceNodeConnections(
      context.workflow,
      nextTargetNode.id.value,
      nextConnections
    ),
  };
}
