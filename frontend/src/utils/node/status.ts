/**
 * 节点状态工具
 * @module utils/node/status
 * @description 提供节点状态判断和状态文本转换功能
 */

import type { NodeStatus } from '@/types/base.types';
import type { AnyNodeData } from '@/types/node.types';

/**
 * 判断节点是否被锁定
 * @param node - 节点数据
 * @returns 是否被锁定
 */
export function isNodeLocked(node: AnyNodeData): boolean {
  return node.locked;
}

/**
 * 判断节点是否正在处理中
 * @param node - 节点数据
 * @returns 是否正在处理
 */
export function isNodeProcessing(node: AnyNodeData): boolean {
  return node.status === 'processing' || node.status === 'pending';
}

/**
 * 判断节点是否已完成
 * @param node - 节点数据
 * @returns 是否已完成
 */
export function isNodeCompleted(node: AnyNodeData): boolean {
  return node.status === 'completed';
}

/**
 * 判断节点是否处于错误状态
 * @param node - 节点数据
 * @returns 是否错误
 */
export function isNodeError(node: AnyNodeData): boolean {
  return node.status === 'error';
}

/**
 * 判断节点是否空闲
 * @param node - 节点数据
 * @returns 是否空闲
 */
export function isNodeIdle(node: AnyNodeData): boolean {
  return node.status === 'idle';
}

/**
 * 获取节点状态的中文显示文本
 * @param status - 节点状态
 * @returns 状态中文文本
 */
export function getNodeStatusText(status: NodeStatus): string {
  const statusMap: Record<NodeStatus, string> = {
    idle: '空闲',
    pending: '等待中',
    processing: '处理中',
    completed: '已完成',
    error: '错误',
  };
  return statusMap[status] ?? '未知';
}
