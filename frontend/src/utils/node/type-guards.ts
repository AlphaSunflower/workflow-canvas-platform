/**
 * 节点类型判断工具
 * @module utils/node/type-guards
 */

import type { NodeType } from '@/types/base.types';
import type { AnyNodeData, FileNodeData, AINodeData } from '@/types/node.types';

export function isFileNodeType(type: NodeType): boolean {
  return type === 'image' || type === 'video' || type === 'ply';
}

export function isAINodeType(type: NodeType): boolean {
  return (
    type === 'aiImageGen' ||
    type === 'aiImageInpaint' ||
    type === 'aiVideoGen' ||
    type === 'aiImageToPly' ||
    type === 'aiStoryboard' ||
    type === 'aiMultiViewRestore' ||
    type === 'aiModelRenderTransfer' ||
    type === 'aiImageHd' ||
    type === 'aiFloorplanColorize'
  );
}

export function isFileNodeData(node: AnyNodeData): node is FileNodeData {
  return isFileNodeType(node.type);
}

export function isAINodeData(node: AnyNodeData): node is AINodeData {
  return isAINodeType(node.type);
}
