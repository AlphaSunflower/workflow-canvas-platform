/**
 * AI优先级工具
 * @module utils/ai/priority
 * @description 提供任务优先级比较和排序功能
 */

/**
 * 获取优先级数值
 * @param priority - 优先级
 * @returns 优先级数值（越大越高）
 */
export function getPriorityValue(priority: 'high' | 'normal' | 'low'): number {
  const values = { high: 3, normal: 2, low: 1 };
  return values[priority];
}

/**
 * 比较两个任务的优先级
 * @param a - 任务A
 * @param b - 任务B
 * @returns 比较结果（正数表示A优先级更高）
 */
export function compareTaskPriority(
  a: { priority?: 'high' | 'normal' | 'low' },
  b: { priority?: 'high' | 'normal' | 'low' }
): number {
  const priorityA = getPriorityValue(a.priority ?? 'normal');
  const priorityB = getPriorityValue(b.priority ?? 'normal');
  return priorityB - priorityA;
}

/**
 * 按优先级排序任务
 * @param tasks - 任务列表
 * @returns 排序后的任务列表
 */
export function sortTasksByPriority<T extends { priority?: 'high' | 'normal' | 'low' }>(tasks: T[]): T[] {
  return [...tasks].sort(compareTaskPriority);
}
