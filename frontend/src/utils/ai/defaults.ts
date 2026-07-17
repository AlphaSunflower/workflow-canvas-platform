/**
 * AI默认值工具
 * @module utils/ai/defaults
 * @description 提供AI任务默认超时、优先级等配置
 */

import type { AITaskType } from '@/types/ai.types';
import { AI_TASK_DEFAULTS } from '@/constants/ai.constants';

/**
 * 获取任务类型的默认超时时间
 * @param taskType - AI任务类型
 * @returns 默认超时时间（毫秒）
 */
export function getDefaultTimeout(taskType: AITaskType): number {
  return AI_TASK_DEFAULTS.timeout[taskType];
}

/**
 * 获取任务类型的默认优先级
 * @param taskType - AI任务类型
 * @returns 默认优先级
 */
export function getDefaultPriority(taskType: AITaskType): 'high' | 'normal' | 'low' {
  return AI_TASK_DEFAULTS.priority[taskType];
}

/**
 * 获取默认最大重试次数
 * @returns 默认最大重试次数
 */
export function getDefaultMaxRetries(): number {
  return AI_TASK_DEFAULTS.maxRetries;
}

/**
 * 计算带缓冲的超时时间
 * @param taskType - AI任务类型
 * @param bufferPercent - 缓冲百分比（默认20%）
 * @returns 带缓冲的超时时间（毫秒）
 */
export function calculateTimeoutWithBuffer(
  taskType: AITaskType,
  bufferPercent: number = 0.2
): number {
  const baseTimeout = getDefaultTimeout(taskType);
  return Math.round(baseTimeout * (1 + bufferPercent));
}
