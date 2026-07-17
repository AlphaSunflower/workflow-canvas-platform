import type { AINodeData, AnyNodeData } from '@/types';
import type {
  NodeCustomDropCapability,
  NodeDropPlan,
  NodeDropPreview,
  NodeDropTargetContext,
} from '../../types';
import {
  buildGroupedDropPlan,
  type GroupedDropPlannerOptions,
  validateGroupedDropPlan,
} from './planner';
import type { GroupedDropPanelSide } from './types';

export interface GroupedDropCapabilityOptions<
  TNode extends AINodeData = AINodeData,
  TDraggedNode extends AnyNodeData = AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
> extends GroupedDropPlannerOptions<TNode, TDraggedNode, TSide> {
  acceptDraggedNodes?: (nodes: AnyNodeData[]) => boolean;
}

export function createDefaultGroupedDropAcceptDraggedNodes<
  TDraggedNode extends AnyNodeData = AnyNodeData,
>(
  normalizeDraggedNodes: (nodes: AnyNodeData[]) => TDraggedNode[]
): (nodes: AnyNodeData[]) => boolean {
  return (nodes: AnyNodeData[]) => {
    const normalizedNodes = normalizeDraggedNodes(nodes);
    return normalizedNodes.length > 0 && normalizedNodes.length === nodes.length;
  };
}

export interface PlannerBackedDropCapabilityOptions<
  TOptions,
  TDraggedNode extends AnyNodeData = AnyNodeData,
> {
  options: TOptions;
  normalizeDraggedNodes: (nodes: AnyNodeData[]) => TDraggedNode[];
  acceptDraggedNodes?: (nodes: AnyNodeData[]) => boolean;
  validateTarget: (context: NodeDropTargetContext, options: TOptions) => NodeDropPreview;
  buildPlan: (context: NodeDropTargetContext, options: TOptions) => NodeDropPlan | null;
}

export function createPlannerBackedDropCapability<
  TOptions,
  TDraggedNode extends AnyNodeData = AnyNodeData,
>(
  config: PlannerBackedDropCapabilityOptions<TOptions, TDraggedNode>
): NodeCustomDropCapability {
  return {
    mode: 'custom',
    acceptDraggedNodes: config.acceptDraggedNodes ??
      createDefaultGroupedDropAcceptDraggedNodes(config.normalizeDraggedNodes),
    validateTarget: (context) => config.validateTarget(context, config.options),
    buildPlan: (context) => config.buildPlan(context, config.options),
  };
}

export function createGroupedDropCapability<
  TNode extends AINodeData = AINodeData,
  TDraggedNode extends AnyNodeData = AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
>(
  options: GroupedDropCapabilityOptions<TNode, TDraggedNode, TSide>
): NodeCustomDropCapability {
  return createPlannerBackedDropCapability({
    options,
    normalizeDraggedNodes: options.normalizeDraggedNodes,
    acceptDraggedNodes: options.acceptDraggedNodes,
    validateTarget: validateGroupedDropPlan,
    buildPlan: buildGroupedDropPlan,
  });
}
