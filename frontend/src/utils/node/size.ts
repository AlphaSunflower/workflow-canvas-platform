/**
 * 节点尺寸计算工具
 * @module utils/node/size
 * @description 提供节点尺寸计算和缩放功能
 */

import type { Dimensions } from '@/types/base.types';
import { PREVIEW_SIZE_1080P, MIN_NODE_SIZE } from '@/constants/file.constants';

/**
 * 根据原始尺寸计算节点显示尺寸
 * @param originalWidth - 原始宽度
 * @param originalHeight - 原始高度
 * @param baseWidth - 基准宽度（默认1080P宽度）
 * @returns 计算后的尺寸
 */
export function calculateNodeSize(
  originalWidth: number,
  originalHeight: number,
  baseWidth: number = PREVIEW_SIZE_1080P.width
): Dimensions {
  const aspectRatio = originalWidth / originalHeight;
  const width = baseWidth;
  const height = Math.round(width / aspectRatio);
  return { width, height };
}

/**
 * 缩放节点尺寸
 * @param baseSize - 基础尺寸
 * @param scale - 缩放比例
 * @param minSize - 最小尺寸限制
 * @returns 缩放后的尺寸
 */
export function scaleNodeSize(
  baseSize: Dimensions,
  scale: number,
  minSize: number = MIN_NODE_SIZE
): Dimensions {
  const width = Math.max(minSize, Math.round(baseSize.width * scale));
  const height = Math.max(minSize, Math.round(baseSize.height * scale));
  return { width, height };
}

/**
 * 限制节点缩放比例在有效范围内
 * @param scale - 原始缩放比例
 * @param minScale - 最小缩放比例
 * @param maxScale - 最大缩放比例
 * @returns 限制后的缩放比例
 */
export function clampNodeScale(
  scale: number,
  minScale: number = 0.1,
  maxScale: number = 10
): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return minScale;
  }
  return Math.max(minScale, Math.min(maxScale, scale));
}

/**
 * 标准化旋转角度到0-360度范围
 * @param rotation - 原始旋转角度
 * @returns 标准化后的角度（0-360）
 */
export function normalizeRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) {
    return 0;
  }
  return ((rotation % 360) + 360) % 360;
}
