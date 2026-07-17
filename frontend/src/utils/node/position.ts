/**
 * 节点位置计算工具
 * @module utils/node/position
 * @description 提供节点位置、距离、碰撞检测等计算功能
 */

import type { Position } from '@/types/base.types';
import type { AnyNodeData } from '@/types/node.types';
import { REPULSION_DEFAULTS } from '@/constants/node.constants';

/**
 * 计算两点之间的距离
 * @param pos1 - 第一个位置
 * @param pos2 - 第二个位置
 * @returns 两点间距离
 */
export function calculateDistance(pos1: Position, pos2: Position): number {
  const dx = pos2.x - pos1.x;
  const dy = pos2.y - pos1.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return Number.isFinite(distance) ? distance : 0;
}

/**
 * 计算节点中心点位置
 * @param node - 节点数据
 * @returns 节点中心点坐标
 */
export function calculateNodeCenter(node: AnyNodeData): Position {
  return {
    x: node.position.x + node.dimensions.width / 2,
    y: node.position.y + node.dimensions.height / 2,
  };
}

/**
 * 判断两个节点是否重叠
 * @param node1 - 第一个节点
 * @param node2 - 第二个节点
 * @returns 是否重叠
 */
export function doNodesOverlap(node1: AnyNodeData, node2: AnyNodeData): boolean {
  return !(
    node1.position.x + node1.dimensions.width < node2.position.x ||
    node2.position.x + node2.dimensions.width < node1.position.x ||
    node1.position.y + node1.dimensions.height < node2.position.y ||
    node2.position.y + node2.dimensions.height < node1.position.y
  );
}

/**
 * 计算两个节点之间的排斥力向量
 * @param node1 - 第一个节点
 * @param node2 - 第二个节点
 * @param minDistance - 最小距离
 * @returns 排斥力向量或null（无重叠时）
 */
export function calculateRepulsion(
  node1: AnyNodeData,
  node2: AnyNodeData,
  minDistance: number = REPULSION_DEFAULTS.minDistance
): { dx: number; dy: number } | null {
  const center1 = calculateNodeCenter(node1);
  const center2 = calculateNodeCenter(node2);
  
  const combinedHalfWidth = (node1.dimensions.width + node2.dimensions.width) / 2;
  const combinedHalfHeight = (node1.dimensions.height + node2.dimensions.height) / 2;
  
  const overlapX = combinedHalfWidth - Math.abs(center2.x - center1.x);
  const overlapY = combinedHalfHeight - Math.abs(center2.y - center1.y);
  
  if (overlapX <= 0 || overlapY <= 0) {
    return null;
  }
  
  const dx = center2.x - center1.x;
  const dy = center2.y - center1.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  
  const repulsionDistance = Math.max(minDistance, Math.min(overlapX, overlapY));
  
  return {
    dx: (dx / len) * repulsionDistance,
    dy: (dy / len) * repulsionDistance,
  };
}
