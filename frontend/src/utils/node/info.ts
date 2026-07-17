import type { NodeType } from '@/types/base.types';
import type { NodeTypeInfo } from '@/types/node.types';
import { NODE_TYPE_INFO } from '@/constants/node.constants';

export function getNodeTypeInfo(type: NodeType): NodeTypeInfo {
  return NODE_TYPE_INFO[type];
}

export function getNodeDisplayName(type: NodeType): string {
  return NODE_TYPE_INFO[type]?.displayName ?? '未知节点';
}

export function getNodeIcon(type: NodeType): string {
  return NODE_TYPE_INFO[type]?.icon ?? 'NODE';
}

export function getNodeColor(type: NodeType): string {
  return NODE_TYPE_INFO[type]?.color ?? '#6B7280';
}

export function getNodeCategory(type: NodeType): 'file' | 'ai' | 'group' {
  return NODE_TYPE_INFO[type]?.category ?? 'file';
}
