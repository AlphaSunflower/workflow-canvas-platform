import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import { generateUUID, isAINodeData, isFileNodeData } from '@/utils';
import type {
  NodeCustomDropCapability,
  NodeDropPlan,
  NodeDropPreview,
  NodeDropTargetContext,
} from '../types';
import {
  createInvalidDropPreview,
  createValidDropPreview,
  replaceNodeConnections,
} from '../shared/drop';
import { normalizeDraggedImageNodes } from '../shared/drop-config-builder';
import {
  createAIImageInpaintInputGroup,
  getAIImageInpaintInputHandle,
  getAIImageInpaintOutputHandle,
  normalizeAIImageInpaintNode,
} from './groups';

function isImageNode(node: AnyNodeData): node is FileNodeData {
  return isFileNodeData(node) && node.type === 'image';
}

function getTargetNode(context: NodeDropTargetContext): AINodeData | null {
  const node = context.workflow.nodes[context.target.nodeId];
  if (!node || !isAINodeData(node) || node.type !== 'aiImageInpaint') {
    return null;
  }

  return node;
}

function getDroppedImageNodes(nodes: AnyNodeData[]): FileNodeData[] {
  return normalizeDraggedImageNodes(nodes).filter(isImageNode);
}

function validateAIImageInpaintDrop(
  context: NodeDropTargetContext,
): NodeDropPreview {
  const targetNode = getTargetNode(context);
  if (!targetNode) {
    return createInvalidDropPreview('当前节点不支持图片局部重绘挂载。');
  }

  const imageNodes = getDroppedImageNodes(context.draggedNodes);
  if (
    imageNodes.length === 0 ||
    imageNodes.length !== context.draggedNodes.length
  ) {
    return createInvalidDropPreview('图片局部重绘只接受图片节点。');
  }

  if (imageNodes.length !== 1) {
    return createInvalidDropPreview('图片局部重绘一次只能拖入 1 张原图。');
  }

  return createValidDropPreview();
}

function buildAIImageInpaintDropPlan(
  context: NodeDropTargetContext,
): NodeDropPlan | null {
  const validation = validateAIImageInpaintDrop(context);
  if (!validation.valid) {
    return null;
  }

  const targetNode = getTargetNode(context);
  const imageNode = getDroppedImageNodes(context.draggedNodes)[0];
  if (!targetNode || !imageNode) {
    return null;
  }

  const normalizedTargetNode = normalizeAIImageInpaintNode(targetNode);
  const nextTargetNode = {
    ...normalizedTargetNode,
    config: {
      ...targetNode.config,
      ...normalizedTargetNode.config,
      hasMaskMarks: false,
      maskStrokes: [],
      maskSourceFileId: undefined,
      maskSourceWidth: undefined,
      maskSourceHeight: undefined,
      inputGroups: createAIImageInpaintInputGroup(),
    },
    outputs: [],
    timestamp: {
      ...targetNode.timestamp,
      updated: Date.now(),
    },
  };

  const nextInputConnection = {
    id: generateUUID(),
    type: 'file-reference' as const,
    sourceId: imageNode.id.value,
    targetId: nextTargetNode.id.value,
    targetHandle: getAIImageInpaintInputHandle(),
    order: 0,
  };

  return {
    nextTargetNode,
    nextConnections: replaceNodeConnections(
      context.workflow,
      nextTargetNode.id.value,
      [nextInputConnection],
    ).filter((connection) => !(
      connection.type === 'output-link' &&
      connection.sourceId === nextTargetNode.id.value &&
      connection.sourceHandle === getAIImageInpaintOutputHandle()
    )),
  };
}

export const aiImageInpaintDrop: NodeCustomDropCapability = {
  mode: 'custom',
  acceptDraggedNodes: (nodes) => {
    const imageNodes = getDroppedImageNodes(nodes);
    return imageNodes.length === 1 && imageNodes.length === nodes.length;
  },
  validateTarget: validateAIImageInpaintDrop,
  buildPlan: buildAIImageInpaintDropPlan,
};
