import type { AINodeData, AnyNodeData, Workflow } from '@/types';
import { isAINodeData, isFileNodeData } from '@/utils/node';
import { createSequenceGroupedDropCapability } from '../shared/grouped-drop/sequence-capability';
import type { SequenceGroupedDropPlannerOptions } from '../shared/grouped-drop/sequence-planner';
import {
  AI_VIDEO_GEN_INPUT_PORT_ID,
  AI_VIDEO_GEN_MAX_GROUPS,
  resolveAIVideoGenInputGroups,
} from './groups';

export type AIVideoGenDropSide = 'input';

function sortNodesByCanvasPosition<T extends Pick<AnyNodeData, 'position' | 'id'>>(nodes: T[]): T[] {
  return [...nodes].sort((left, right) => {
    if (left.position.y !== right.position.y) {
      return left.position.y - right.position.y;
    }

    if (left.position.x !== right.position.x) {
      return left.position.x - right.position.x;
    }

    return left.id.value.localeCompare(right.id.value);
  });
}

function normalizeDraggedImageNodes(nodes: AnyNodeData[]): AnyNodeData[] {
  return sortNodesByCanvasPosition(
    nodes.filter((node): node is AnyNodeData => isFileNodeData(node) && node.type === 'image')
  );
}

function getTargetNode(workflow: Workflow, nodeId: string): AINodeData | null {
  const node = workflow.nodes[nodeId];
  if (!node || !isAINodeData(node) || node.type !== 'aiVideoGen') {
    return null;
  }

  return node;
}

export const aiVideoGenDropConfig: SequenceGroupedDropPlannerOptions<
  AINodeData,
  AnyNodeData,
  AIVideoGenDropSide
> = {
  getTargetNode,
  resolveInputGroups: resolveAIVideoGenInputGroups,
  normalizeDraggedNodes: normalizeDraggedImageNodes,
  validateDraggedNodes: (nodes) => {
    const uniqueNodeIds = new Set(nodes.map((node) => node.id.value));
    return uniqueNodeIds.size === nodes.length
      ? null
      : '同一次拖放不能包含重复图片。';
  },
  sidePortMap: Object.freeze({
    input: AI_VIDEO_GEN_INPUT_PORT_ID,
  }),
  maxGroups: AI_VIDEO_GEN_MAX_GROUPS,
  allowCtrl: true,
  allowShift: true,
  ctrlSingleBroadcast: true,
  shiftPlacementStrategy: 'fill-capacity',
  disallowHandleDuplicates: true,
  resolveDropTarget: (context, mode) => {
    if (context.target.nodeType !== 'group' || !context.target.groupId) {
      return null;
    }

    const parts = context.target.groupId.split('|');
    if (mode === 'normal') {
      if (parts[0] !== 'slot' || !parts[1] || !parts[2]) {
        return null;
      }

      return {
        kind: 'slot',
        groupId: parts[1],
        portId: parts[2],
      };
    }

    if (parts[0] !== 'panel' || !parts[1]) {
      return null;
    }

    return {
      kind: 'panel',
      side: parts[1] as AIVideoGenDropSide,
    };
  },
};

export const aiVideoGenGroupedDrop = createSequenceGroupedDropCapability(aiVideoGenDropConfig);
