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
} from '../connection';
import {
  createInvalidDropPreview,
  createValidDropPreview,
  replaceNodeConnections,
  resolveGroupedDropMode,
  resolveGroupedDropPortId,
} from '../drop';
import {
  appendInputGroups,
  getConfiguredInputGroups,
  updateNodeInputGroups,
} from '../groups';
import type { GroupedDropPanelSide, GroupedDropTarget } from './types';
import {
  cloneGroupedDropInputsByHandle,
  getGroupedDropCurrentInputsByHandle,
  validateGroupedDropPortAcceptance,
} from './planner';

export interface SequenceGroupedDropPlannerOptions<
  TNode extends AINodeData = AINodeData,
  TDraggedNode extends AnyNodeData = AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
> {
  getTargetNode: (workflow: Workflow, nodeId: string) => TNode | null;
  resolveInputGroups: (node: TNode) => NodeInputGroupDefinition[];
  normalizeDraggedNodes: (nodes: AnyNodeData[]) => TDraggedNode[];
  sidePortMap: Readonly<Partial<Record<TSide, string>>>;
  maxGroups: number;
  allowCtrl?: boolean;
  allowShift?: boolean;
  ctrlSingleBroadcast?: boolean;
  shiftPlacementStrategy?: 'fill-capacity' | 'single-per-group';
  disallowHandleDuplicates?: boolean;
  appendGroups?: (groups: AIImageInputGroup[], count: number) => AIImageInputGroup[];
  validateDraggedNodes?: (nodes: TDraggedNode[]) => string | null;
  resolveDropTarget?: (
    context: NodeDropTargetContext,
    mode: ReturnType<typeof resolveGroupedDropMode>
  ) => GroupedDropTarget<TSide> | null;
  getPortOrderValue?: (node: TDraggedNode, index: number) => number;
}

interface ResolvedSequencePlannerState<
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

type SequencePlannerResolution<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string,
> =
  | {
      ok: true;
      state: ResolvedSequencePlannerState<TNode, TDraggedNode, TSide>;
    }
  | {
      ok: false;
      preview: NodeDropPreview;
    };

interface SequenceHandlePlacement {
  handle: string;
  remainingCapacity: number;
}

function resolveSequenceDropTarget<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string,
>(
  context: NodeDropTargetContext,
  options: SequenceGroupedDropPlannerOptions<TNode, TDraggedNode, TSide>,
  mode: ReturnType<typeof resolveGroupedDropMode>
): GroupedDropTarget<TSide> | null {
  if (options.resolveDropTarget) {
    return options.resolveDropTarget(context, mode);
  }

  if (context.target.nodeType !== 'group' || !context.target.groupId) {
    return null;
  }

  const parts = context.target.groupId.split('|');
  if (parts[0] === 'slot' && parts[1] && parts[2]) {
    return {
      kind: 'slot',
      groupId: parts[1],
      portId: parts[2],
    };
  }

  if (parts[0] === 'panel' && parts[1]) {
    return {
      kind: 'panel',
      side: parts[1] as TSide,
    };
  }

  return null;
}

function findSequenceTargetPort(
  groupDefinitions: NodeInputGroupDefinition[],
  dropTarget: GroupedDropTarget<string>,
  portIdFromPanel?: string | null
): NodePortDefinition | null {
  const resolvedPortId = dropTarget.kind === 'slot' ? dropTarget.portId : portIdFromPanel ?? undefined;
  if (!resolvedPortId) {
    return null;
  }

  for (const group of groupDefinitions) {
    const port = group.ports.find((item) => item.id === resolvedPortId);
    if (port) {
      return port;
    }
  }

  return null;
}

function getPanelPortId<TSide extends string>(
  dropTarget: GroupedDropTarget<TSide>,
  sidePortMap: Readonly<Partial<Record<TSide, string>>>
): string | null {
  if (dropTarget.kind !== 'panel') {
    return null;
  }

  return resolveGroupedDropPortId(dropTarget, sidePortMap) ?? null;
}

function resolveSequencePlannerState<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string,
>(
  context: NodeDropTargetContext,
  options: SequenceGroupedDropPlannerOptions<TNode, TDraggedNode, TSide>
): SequencePlannerResolution<TNode, TDraggedNode, TSide> {
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

  const dropTarget = resolveSequenceDropTarget(context, options, mode);
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

function getCurrentHandleInputs(
  inputsByHandle: Map<string, string[]>,
  groupId: string,
  portId: string
): string[] {
  return inputsByHandle.get(createGroupPortHandle(groupId, portId)) ?? [];
}

function appendSequenceToHandle(
  inputsByHandle: Map<string, string[]>,
  handle: string,
  sourceIds: string[],
  maxConnections: number | undefined
): Map<string, string[]> {
  const nextInputsByHandle = cloneGroupedDropInputsByHandle(inputsByHandle);
  const currentInputs = nextInputsByHandle.get(handle) ?? [];
  const capacity = maxConnections ?? Number.POSITIVE_INFINITY;
  nextInputsByHandle.set(handle, [...currentInputs, ...sourceIds].slice(0, capacity));
  return nextInputsByHandle;
}

function createSequenceHandlePlacements(
  handles: string[],
  inputsByHandle: Map<string, string[]>,
  maxConnections: number | undefined,
  maxAssignmentsPerHandle: number
): SequenceHandlePlacement[] {
  return handles
    .map((handle) => {
      const currentInputs = inputsByHandle.get(handle) ?? [];
      const remainingCapacity = Math.max(
        0,
        Math.min(
          Math.max(0, (maxConnections ?? Number.POSITIVE_INFINITY) - currentInputs.length),
          maxAssignmentsPerHandle
        )
      );

      return {
        handle,
        remainingCapacity,
      };
    })
    .filter((placement) => placement.remainingCapacity > 0);
}

function assignNodesToHandlePlacements<TNode extends AnyNodeData>(
  inputsByHandle: Map<string, string[]>,
  placements: SequenceHandlePlacement[],
  droppedNodes: TNode[],
  disallowHandleDuplicates: boolean
): {
  nextInputsByHandle: Map<string, string[]>;
  remainingNodes: TNode[];
} {
  const nextInputsByHandle = cloneGroupedDropInputsByHandle(inputsByHandle);
  const nextPlacements = placements.map((placement) => ({ ...placement }));
  const remainingNodes: TNode[] = [];
  let nextPlacementIndex = 0;

  droppedNodes.forEach((node) => {
    let placementIndex = -1;

    for (let offset = 0; offset < nextPlacements.length; offset += 1) {
      const candidateIndex = (nextPlacementIndex + offset) % nextPlacements.length;
      const candidate = nextPlacements[candidateIndex];

      if (candidate.remainingCapacity <= 0) {
        continue;
      }

      if (disallowHandleDuplicates) {
        const currentInputs = nextInputsByHandle.get(candidate.handle) ?? [];
        if (currentInputs.includes(node.id.value)) {
          continue;
        }
      }

      placementIndex = candidateIndex;
      break;
    }

    if (placementIndex < 0) {
      remainingNodes.push(node);
      return;
    }

    const placement = nextPlacements[placementIndex];
    const currentInputs = nextInputsByHandle.get(placement.handle) ?? [];
    nextInputsByHandle.set(placement.handle, [...currentInputs, node.id.value]);
    placement.remainingCapacity -= 1;
    nextPlacementIndex = (placementIndex + 1) % Math.max(nextPlacements.length, 1);
  });

  return {
    nextInputsByHandle,
    remainingNodes,
  };
}

function getAppendableHandlesForPort(
  groups: AIImageInputGroup[],
  groupDefinitions: NodeInputGroupDefinition[],
  inputsByHandle: Map<string, string[]>,
  portId: string,
  maxConnections: number | undefined
): string[] {
  return groups
    .map((group) => createGroupPortHandle(group.id, portId))
    .filter((handle) => {
      const currentCount = inputsByHandle.get(handle)?.length ?? 0;
      return currentCount < (maxConnections ?? Number.POSITIVE_INFINITY);
    })
    .filter((handle) => {
      const parts = handle.split(':');
      if (parts.length !== 2) {
        return false;
      }

      return groupDefinitions.some((group) =>
        group.id === parts[0] && group.ports.some((port) => port.id === parts[1])
      );
    });
}

function getCtrlSingleBroadcastHandles<TNode extends AnyNodeData>(
  appendableHandles: string[],
  inputsByHandle: Map<string, string[]>,
  droppedNode: TNode,
  disallowHandleDuplicates: boolean
): string[] {
  if (!disallowHandleDuplicates) {
    return appendableHandles;
  }

  return appendableHandles.filter((handle) => {
    const currentInputs = inputsByHandle.get(handle) ?? [];
    return !currentInputs.includes(droppedNode.id.value);
  });
}

function getShiftPlacementStrategy<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string,
>(
  options: SequenceGroupedDropPlannerOptions<TNode, TDraggedNode, TSide>
): 'fill-capacity' | 'single-per-group' {
  return options.shiftPlacementStrategy ?? 'fill-capacity';
}

function getShiftHandleAssignmentLimit(
  strategy: 'fill-capacity' | 'single-per-group',
  maxConnections: number | undefined,
  droppedNodeCount: number
): number {
  if (strategy === 'single-per-group') {
    return 1;
  }

  return maxConnections ?? Math.max(droppedNodeCount, 1);
}

export function validateSequenceGroupedDropPlan<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
>(
  context: NodeDropTargetContext,
  options: SequenceGroupedDropPlannerOptions<TNode, TDraggedNode, TSide>
): NodeDropPreview {
  const resolved = resolveSequencePlannerState(context, options);
  if (!resolved.ok) {
    return resolved.preview;
  }

  const { state } = resolved;
  const allowCtrl = options.allowCtrl ?? true;
  const allowShift = options.allowShift ?? true;
  const panelPortId = getPanelPortId(state.dropTarget, options.sidePortMap);
  const targetPort = findSequenceTargetPort(state.groupDefinitions, state.dropTarget, panelPortId);

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

    const currentInputs = getCurrentHandleInputs(
      state.inputsByHandle,
      state.dropTarget.groupId,
      state.dropTarget.portId
    );
    const duplicateNode = state.droppedNodes.find((node) => currentInputs.includes(node.id.value));
    if (duplicateNode) {
      return createInvalidDropPreview('This file is already connected to the target slot.');
    }

    const capacity = targetPort.maxConnections ?? Number.POSITIVE_INFINITY;
    if (currentInputs.length + state.droppedNodes.length > capacity) {
      return createInvalidDropPreview(`Only ${Math.max(0, capacity - currentInputs.length)} files can be appended to the target slot.`);
    }

    return createValidDropPreview();
  }

  if (state.dropTarget.kind !== 'panel' || !panelPortId) {
    return createInvalidDropPreview('Batch drag requires the input panel target.');
  }

  if (state.mode === 'ctrl') {
    if (!allowCtrl) {
      return createInvalidDropPreview('Ctrl batch fill is not enabled for this node.');
    }

    const appendableHandles = getAppendableHandlesForPort(
      state.configuredGroups,
      state.groupDefinitions,
      state.inputsByHandle,
      panelPortId,
      targetPort.maxConnections
    );
    if (appendableHandles.length === 0) {
      return createInvalidDropPreview('No existing capacity is available on the target side.');
    }

    const existingCapacity = appendableHandles.reduce((sum, handle) => {
      const currentCount = state.inputsByHandle.get(handle)?.length ?? 0;
      return sum + Math.max(0, (targetPort.maxConnections ?? Number.POSITIVE_INFINITY) - currentCount);
    }, 0);

    if (state.droppedNodes.length === 1 && options.ctrlSingleBroadcast) {
      const broadcastHandles = getCtrlSingleBroadcastHandles(
        appendableHandles,
        state.inputsByHandle,
        state.droppedNodes[0],
        options.disallowHandleDuplicates ?? false
      );

      if (broadcastHandles.length === 0) {
        return createInvalidDropPreview('The dropped file is already connected to all eligible target groups.');
      }

      return createValidDropPreview();
    }

    const existingAssignments = assignNodesToHandlePlacements(
      state.inputsByHandle,
      createSequenceHandlePlacements(
        appendableHandles,
        state.inputsByHandle,
        targetPort.maxConnections,
        state.droppedNodes.length
      ),
      state.droppedNodes,
      options.disallowHandleDuplicates ?? false
    );

    if (existingAssignments.remainingNodes.length > 0) {
      const acceptedCount = Math.max(0, state.droppedNodes.length - existingAssignments.remainingNodes.length);
      return createInvalidDropPreview(
        acceptedCount === existingCapacity
          ? `Only ${existingCapacity} files can fit in the current group capacity.`
          : `Only ${acceptedCount} files can fit in the current group capacity.`
      );
    }

    return createValidDropPreview();
  }

  if (!allowShift) {
    return createInvalidDropPreview('Shift batch expansion is not enabled for this node.');
  }

  const shiftPlacementStrategy = getShiftPlacementStrategy(options);
  const existingAssignments = assignNodesToHandlePlacements(
    state.inputsByHandle,
    createSequenceHandlePlacements(
      getAppendableHandlesForPort(
        state.configuredGroups,
        state.groupDefinitions,
        state.inputsByHandle,
        panelPortId,
        targetPort.maxConnections
      ),
      state.inputsByHandle,
      targetPort.maxConnections,
      getShiftHandleAssignmentLimit(
        shiftPlacementStrategy,
        targetPort.maxConnections,
        state.droppedNodes.length
      )
    ),
    state.droppedNodes,
    options.disallowHandleDuplicates ?? false
  );
  const missingGroups = Math.max(0, options.maxGroups - state.configuredGroups.length);
  const expansionCapacity = missingGroups * getShiftHandleAssignmentLimit(
    shiftPlacementStrategy,
    targetPort.maxConnections,
    state.droppedNodes.length
  );

  if (existingAssignments.remainingNodes.length > expansionCapacity) {
    const acceptedCount = state.droppedNodes.length - existingAssignments.remainingNodes.length + expansionCapacity;
    return createInvalidDropPreview(`Only ${acceptedCount} files can be accepted on the target side.`);
  }

  return createValidDropPreview();
}

export function buildSequenceGroupedDropPlan<
  TNode extends AINodeData,
  TDraggedNode extends AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
>(
  context: NodeDropTargetContext,
  options: SequenceGroupedDropPlannerOptions<TNode, TDraggedNode, TSide>
): NodeDropPlan | null {
  const validation = validateSequenceGroupedDropPlan(context, options);
  if (!validation.valid) {
    return null;
  }

  const resolved = resolveSequencePlannerState(context, options);
  if (!resolved.ok) {
    return null;
  }

  const { state } = resolved;
  const panelPortId = getPanelPortId(state.dropTarget, options.sidePortMap);
  const targetPort = findSequenceTargetPort(state.groupDefinitions, state.dropTarget, panelPortId);
  if (!targetPort) {
    return null;
  }

  let nextGroups = state.configuredGroups;
  let nextInputsByHandle = cloneGroupedDropInputsByHandle(state.inputsByHandle);
  const sourceIds = state.droppedNodes.map((node) => node.id.value);
  const disallowHandleDuplicates = options.disallowHandleDuplicates ?? false;

  if (state.mode === 'normal') {
    if (state.dropTarget.kind !== 'slot') {
      return null;
    }

    const handle = createGroupPortHandle(state.dropTarget.groupId, state.dropTarget.portId);
    nextInputsByHandle = appendSequenceToHandle(
      nextInputsByHandle,
      handle,
      sourceIds,
      targetPort.maxConnections
    );
  } else {
    if (state.dropTarget.kind !== 'panel' || !panelPortId) {
      return null;
    }

    const appendableHandles = getAppendableHandlesForPort(
      state.configuredGroups,
      state.groupDefinitions,
      nextInputsByHandle,
      panelPortId,
      targetPort.maxConnections
    );

    if (state.mode === 'ctrl') {
      if (state.droppedNodes.length === 1 && options.ctrlSingleBroadcast) {
        const broadcastHandles = getCtrlSingleBroadcastHandles(
          appendableHandles,
          nextInputsByHandle,
          state.droppedNodes[0],
          disallowHandleDuplicates
        );

        nextInputsByHandle = broadcastHandles.reduce((result, handle) => (
          appendSequenceToHandle(result, handle, sourceIds, targetPort.maxConnections)
        ), nextInputsByHandle);
      } else {
        nextInputsByHandle = assignNodesToHandlePlacements(
          nextInputsByHandle,
          createSequenceHandlePlacements(
            appendableHandles,
            nextInputsByHandle,
            targetPort.maxConnections,
            state.droppedNodes.length
          ),
          state.droppedNodes,
          disallowHandleDuplicates
        ).nextInputsByHandle;
      }
    } else {
      const shiftPlacementStrategy = getShiftPlacementStrategy(options);
      const shiftHandleAssignmentLimit = getShiftHandleAssignmentLimit(
        shiftPlacementStrategy,
        targetPort.maxConnections,
        state.droppedNodes.length
      );
      const existingAssignments = assignNodesToHandlePlacements(
        nextInputsByHandle,
        createSequenceHandlePlacements(
          appendableHandles,
          nextInputsByHandle,
          targetPort.maxConnections,
          shiftHandleAssignmentLimit
        ),
        state.droppedNodes,
        disallowHandleDuplicates
      );
      nextInputsByHandle = existingAssignments.nextInputsByHandle;

      const missingGroupsCount = Math.max(
        0,
        Math.ceil(
          existingAssignments.remainingNodes.length /
          Math.max(shiftHandleAssignmentLimit, 1)
        )
      );
      const appendGroupsFn = options.appendGroups ?? appendInputGroups;

      if (missingGroupsCount > 0) {
        nextGroups = appendGroupsFn(state.configuredGroups, missingGroupsCount);
      }

      if (existingAssignments.remainingNodes.length > 0) {
        const appendedGroups = nextGroups.slice(state.configuredGroups.length);
        const nextTargetNodeForGroups = updateNodeInputGroups(state.targetNode, nextGroups) as TNode;
        const nextGroupDefinitions = options.resolveInputGroups(nextTargetNodeForGroups);
        const nextHandles = getAppendableHandlesForPort(
          appendedGroups,
          nextGroupDefinitions,
          nextInputsByHandle,
          panelPortId,
          targetPort.maxConnections
        );
        nextInputsByHandle = assignNodesToHandlePlacements(
          nextInputsByHandle,
          createSequenceHandlePlacements(
            nextHandles,
            nextInputsByHandle,
            targetPort.maxConnections,
            shiftHandleAssignmentLimit
          ),
          existingAssignments.remainingNodes,
          disallowHandleDuplicates
        ).nextInputsByHandle;
      }
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
