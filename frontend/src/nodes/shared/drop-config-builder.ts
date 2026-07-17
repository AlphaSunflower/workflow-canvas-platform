import type { AINodeData, AnyNodeData, Workflow } from '@/types';
import { isAINodeData, isFileNodeData } from '@/utils';
import type { GroupedDropPlannerOptions } from './grouped-drop/planner';
import type { SequenceGroupedDropPlannerOptions } from './grouped-drop/sequence-planner';

const DUPLICATE_DRAGGED_IMAGE_NODES_MESSAGE =
  'Duplicate images are not allowed in the same drop action.';

function sortNodesByCanvasPosition<TNode extends Pick<AnyNodeData, 'position' | 'id'>>(
  nodes: readonly TNode[]
): TNode[] {
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

export function normalizeDraggedImageNodes(nodes: AnyNodeData[]): AnyNodeData[] {
  return sortNodesByCanvasPosition(
    nodes.filter((node): node is AnyNodeData => isFileNodeData(node) && node.type === 'image')
  );
}

export function validateUniqueDraggedImageNodes(nodes: readonly Pick<AnyNodeData, 'id'>[]): string | null {
  const uniqueNodeIds = new Set(nodes.map((node) => node.id.value));
  return uniqueNodeIds.size === nodes.length
    ? null
    : DUPLICATE_DRAGGED_IMAGE_NODES_MESSAGE;
}

export function createAINodeTargetResolver<TNodeType extends AINodeData['type']>(nodeType: TNodeType) {
  return (workflow: Workflow, nodeId: string): (AINodeData & { type: TNodeType }) | null => {
    const node = workflow.nodes[nodeId];
    if (!node || !isAINodeData(node) || node.type !== nodeType) {
      return null;
    }

    return node as AINodeData & { type: TNodeType };
  };
}

type SharedImageDropConfig<
  TOptions extends { normalizeDraggedNodes: (nodes: AnyNodeData[]) => AnyNodeData[] },
> = Omit<TOptions, 'normalizeDraggedNodes'>;

export function buildGroupedImageDropConfig<
  TNode extends AINodeData,
  TSide extends string,
>(
  config: SharedImageDropConfig<GroupedDropPlannerOptions<TNode, AnyNodeData, TSide>>
): GroupedDropPlannerOptions<TNode, AnyNodeData, TSide> {
  return {
    ...config,
    normalizeDraggedNodes: normalizeDraggedImageNodes,
  };
}

export function buildSequenceImageDropConfig<
  TNode extends AINodeData,
  TSide extends string,
>(
  config: SharedImageDropConfig<SequenceGroupedDropPlannerOptions<TNode, AnyNodeData, TSide>>
): SequenceGroupedDropPlannerOptions<TNode, AnyNodeData, TSide> {
  return {
    ...config,
    normalizeDraggedNodes: normalizeDraggedImageNodes,
  };
}
