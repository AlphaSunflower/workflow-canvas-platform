import type { Node } from 'reactflow';

import type { AnyNodeData } from '@/types';
import {
  AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP,
  AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP,
  AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
  AI_IMAGE_INPAINT_MIN_HEIGHT,
  AI_IMAGE_INPAINT_MIN_WIDTH,
  resolveAIImageInpaintEditorSize,
} from '@/nodes/ai-image-inpaint/constants';

export interface CanvasNodeVisibilityRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function resolvePositiveDimension(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function resolveNodeBodyRect(node: Node<AnyNodeData>): CanvasNodeVisibilityRect {
  const dataWidth = resolvePositiveDimension(node.data.dimensions.width);
  const dataHeight = resolvePositiveDimension(node.data.dimensions.height);
  const nodeWidth = resolvePositiveDimension(node.width);
  const nodeHeight = resolvePositiveDimension(node.height);

  return {
    x: node.position.x,
    y: node.position.y,
    width: dataWidth > 0 ? dataWidth : nodeWidth,
    height: dataHeight > 0 ? dataHeight : nodeHeight,
  };
}

export function resolveCanvasNodeVisibilityRect(
  node: Node<AnyNodeData>,
): CanvasNodeVisibilityRect {
  const bodyRect = resolveNodeBodyRect(node);
  if (node.data.type !== 'aiImageInpaint') {
    return bodyRect;
  }

  const editorSize = resolveAIImageInpaintEditorSize({
    editorHeight: node.data.config.editorHeight,
    sourceWidth: node.data.config.maskSourceWidth,
    sourceHeight: node.data.config.maskSourceHeight,
  });
  const bodyWidth = Math.max(AI_IMAGE_INPAINT_MIN_WIDTH, bodyRect.width);
  const bodyHeight = Math.max(AI_IMAGE_INPAINT_MIN_HEIGHT, bodyRect.height);
  const bodyCenterX = bodyRect.x + bodyWidth / 2;
  const editorX = bodyCenterX - editorSize.width / 2;
  const left = Math.min(bodyRect.x, editorX);
  const right = Math.max(bodyRect.x + bodyWidth, editorX + editorSize.width);

  return {
    x: left,
    y: bodyRect.y
      - editorSize.totalHeight
      - AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP
      - AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP
      - AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
    width: right - left,
    height: bodyHeight
      + editorSize.totalHeight
      + AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP
      + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP
      + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
  };
}
