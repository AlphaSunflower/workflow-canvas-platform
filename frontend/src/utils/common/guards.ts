// ==============================================
// LOCKED: 类型守卫
// @module utils/common/guards
// ==============================================

import type { Position, Dimensions, BoundingBox, NodeType, NodeStatus, TaskStatus } from '@/types/base.types';
import type { AnyNodeData, FileNodeData, AINodeData } from '@/types/node.types';

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

export function isNull(value: unknown): value is null {
  return value === null;
}

export function isUndefined(value: unknown): value is undefined {
  return value === undefined;
}

export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function isEmpty(value: unknown): boolean {
  if (isNullOrUndefined(value)) return true;
  if (isString(value)) return value.length === 0;
  if (isArray(value)) return value.length === 0;
  if (isObject(value)) return Object.keys(value).length === 0;
  return false;
}

export function isPosition(value: unknown): value is Position {
  return isObject(value) && isNumber(value.x) && isNumber(value.y);
}

export function isDimensions(value: unknown): value is Dimensions {
  return isObject(value) && isNumber(value.width) && isNumber(value.height);
}

export function isBoundingBox(value: unknown): value is BoundingBox {
  return isPosition(value) && isDimensions(value);
}

export function isFileNodeData(node: AnyNodeData): node is FileNodeData {
  return node.type === 'image' || node.type === 'video' || node.type === 'ply';
}

export function isAINodeData(node: AnyNodeData): node is AINodeData {
  return (
    node.type === 'aiImageGen' ||
    node.type === 'aiImageInpaint' ||
    node.type === 'aiVideoGen' ||
    node.type === 'aiImageToPly' ||
    node.type === 'aiStoryboard' ||
    node.type === 'aiMultiViewRestore' ||
    node.type === 'aiModelRenderTransfer' ||
    node.type === 'aiImageHd' ||
    node.type === 'aiFloorplanColorize'
  );
}

export function isValidNodeType(value: unknown): value is NodeType {
  const validTypes: NodeType[] = [
    'image',
    'video',
    'ply',
    'aiImageGen',
    'aiImageInpaint',
    'aiVideoGen',
    'aiImageToPly',
    'aiStoryboard',
    'aiMultiViewRestore',
    'aiModelRenderTransfer',
    'aiImageHd',
    'aiFloorplanColorize',
  ];
  return isString(value) && validTypes.includes(value as NodeType);
}

export function isValidNodeStatus(value: unknown): value is NodeStatus {
  const validStatuses: NodeStatus[] = ['idle', 'pending', 'processing', 'completed', 'error'];
  return isString(value) && validStatuses.includes(value as NodeStatus);
}

export function isValidTaskStatus(value: unknown): value is TaskStatus {
  const validStatuses: TaskStatus[] = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
  return isString(value) && validStatuses.includes(value as TaskStatus);
}
