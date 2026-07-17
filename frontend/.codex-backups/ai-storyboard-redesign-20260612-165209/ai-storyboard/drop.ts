import type { AINodeData, AnyNodeData, Workflow } from '@/types';
import {
  buildSequenceImageDropConfig,
  createAINodeTargetResolver,
  validateUniqueDraggedImageNodes,
} from '../shared/drop-config-builder';
import { createSequenceGroupedDropCapability } from '../shared/grouped-drop/sequence-capability';
import type { SequenceGroupedDropPlannerOptions } from '../shared/grouped-drop/sequence-planner';
import { resolveAIStoryboardInputGroups } from './groups';
import {
  AI_STORYBOARD_INPUT_PORT_ID,
  AI_STORYBOARD_MAX_GROUPS,
} from './constants';

export type AIStoryboardDropSide = 'input';

const resolveStoryboardTargetNode = createAINodeTargetResolver('aiStoryboard');

function getTargetNode(workflow: Workflow, nodeId: string): AINodeData | null {
  return resolveStoryboardTargetNode(workflow, nodeId);
}

function resolveSingleStoryboardInputSlot(
  workflow: Workflow,
  nodeId: string,
): { kind: 'slot'; groupId: string; portId: string } | null {
  const targetNode = getTargetNode(workflow, nodeId);
  if (!targetNode) {
    return null;
  }

  const groups = resolveAIStoryboardInputGroups(targetNode);
  if (groups.length !== 1) {
    return null;
  }

  return {
    kind: 'slot',
    groupId: groups[0].id,
    portId: AI_STORYBOARD_INPUT_PORT_ID,
  };
}

export const aiStoryboardDropConfig: SequenceGroupedDropPlannerOptions<
  AINodeData,
  AnyNodeData,
  AIStoryboardDropSide
> = buildSequenceImageDropConfig({
  getTargetNode,
  resolveInputGroups: resolveAIStoryboardInputGroups,
  validateDraggedNodes: validateUniqueDraggedImageNodes,
  sidePortMap: Object.freeze({
    input: AI_STORYBOARD_INPUT_PORT_ID,
  }),
  maxGroups: AI_STORYBOARD_MAX_GROUPS,
  allowCtrl: true,
  allowShift: false,
  ctrlSingleBroadcast: false,
  shiftPlacementStrategy: 'fill-capacity',
  disallowHandleDuplicates: true,
  resolveDropTarget: (context, mode) => {
    if (context.target.nodeType === 'body') {
      if (mode === 'normal') {
        return resolveSingleStoryboardInputSlot(
          context.workflow,
          context.target.nodeId,
        );
      }

      if (mode === 'ctrl') {
        return {
          kind: 'panel',
          side: 'input',
        };
      }

      return null;
    }

    if (context.target.nodeType !== 'group' || !context.target.groupId) {
      return null;
    }

    const parts = context.target.groupId.split('|');
    if (mode === 'normal' || mode === 'ctrl') {
      if (parts[0] === 'slot' && parts[1] && parts[2]) {
        return {
          kind: 'slot',
          groupId: parts[1],
          portId: parts[2],
        };
      }

      if (parts[0] === 'panel' && parts[1]) {
        if (mode === 'normal' && parts[1] === 'input') {
          const singleSlotTarget = resolveSingleStoryboardInputSlot(
            context.workflow,
            context.target.nodeId,
          );

          if (singleSlotTarget) {
            return singleSlotTarget;
          }
        }

        return {
          kind: 'panel',
          side: parts[1] as AIStoryboardDropSide,
        };
      }
    }

    return null;
  },
});

export const aiStoryboardDrop = createSequenceGroupedDropCapability(aiStoryboardDropConfig);
