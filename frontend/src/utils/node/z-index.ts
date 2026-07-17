/**
 * 节点层级管理工具
 * @module utils/node/z-index
 * @description 提供节点z-index排序和层级调整功能
 */

import type { Position } from '@/types/base.types';
import type { AnyNodeData } from '@/types/node.types';

/**
 * 按z-index排序节点
 * @param nodes - 节点数组
 * @returns 排序后的节点数组（新数组）
 */
export function sortNodesByZIndex(nodes: AnyNodeData[]): AnyNodeData[] {
  return [...nodes].sort((a, b) => a.zIndex - b.zIndex);
}

/**
 * 将指定节点移到最前
 * @param nodes - 节点数组
 * @param targetId - 目标节点ID值
 * @returns 更新后的节点数组
 */
export function bringToFront(nodes: AnyNodeData[], targetId: string): AnyNodeData[] {
  const maxZ = Math.max(...nodes.map(n => n.zIndex), 0);
  return nodes.map(node => 
    node.id.value === targetId 
      ? { ...node, zIndex: maxZ + 1 } 
      : node
  );
}

/**
 * 将指定节点移到最后
 * @param nodes - 节点数组
 * @param targetId - 目标节点ID值
 * @returns 更新后的节点数组
 */
export function sendToBack(nodes: AnyNodeData[], targetId: string): AnyNodeData[] {
  const minZ = Math.min(...nodes.map(n => n.zIndex), 0);
  return nodes.map(node => 
    node.id.value === targetId 
      ? { ...node, zIndex: minZ - 1 } 
      : node
  );
}

/**
 * 获取选择框内的节点
 * @param nodes - 节点数组
 * @param selectionBox - 选择框（起点和终点）
 * @returns 选择框内的节点数组
 */
export function getNodesInSelection(
  nodes: AnyNodeData[],
  selectionBox: { start: Position; end: Position }
): AnyNodeData[] {
  const minX = Math.min(selectionBox.start.x, selectionBox.end.x);
  const maxX = Math.max(selectionBox.start.x, selectionBox.end.x);
  const minY = Math.min(selectionBox.start.y, selectionBox.end.y);
  const maxY = Math.max(selectionBox.start.y, selectionBox.end.y);
  
  return nodes.filter(node => {
    const nodeMinX = node.position.x;
    const nodeMaxX = node.position.x + node.dimensions.width;
    const nodeMinY = node.position.y;
    const nodeMaxY = node.position.y + node.dimensions.height;
    
    return nodeMinX >= minX && nodeMaxX <= maxX && 
           nodeMinY >= minY && nodeMaxY <= maxY;
  });
}
