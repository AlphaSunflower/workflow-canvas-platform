import type { AINodeData, AnyNodeData } from '@/types';
import type { NodeCustomDropCapability } from '../../types';
import type { GroupedDropPanelSide } from './types';
import {
  createDefaultGroupedDropAcceptDraggedNodes,
  createPlannerBackedDropCapability,
} from './capability';
import {
  buildSequenceGroupedDropPlan,
  type SequenceGroupedDropPlannerOptions,
  validateSequenceGroupedDropPlan,
} from './sequence-planner';

export interface SequenceGroupedDropCapabilityOptions<
  TNode extends AINodeData = AINodeData,
  TDraggedNode extends AnyNodeData = AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
> extends SequenceGroupedDropPlannerOptions<TNode, TDraggedNode, TSide> {
  acceptDraggedNodes?: (nodes: AnyNodeData[]) => boolean;
}

export function createSequenceGroupedDropCapability<
  TNode extends AINodeData = AINodeData,
  TDraggedNode extends AnyNodeData = AnyNodeData,
  TSide extends string = GroupedDropPanelSide,
>(
  options: SequenceGroupedDropCapabilityOptions<TNode, TDraggedNode, TSide>
): NodeCustomDropCapability {
  return createPlannerBackedDropCapability({
    options,
    normalizeDraggedNodes: options.normalizeDraggedNodes,
    acceptDraggedNodes: options.acceptDraggedNodes ??
      createDefaultGroupedDropAcceptDraggedNodes(options.normalizeDraggedNodes),
    validateTarget: validateSequenceGroupedDropPlan,
    buildPlan: buildSequenceGroupedDropPlan,
  });
}
