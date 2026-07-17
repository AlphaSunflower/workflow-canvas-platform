/**
 * AI队列工具
 * @module utils/ai/queue
 * @description 提供任务队列统计和位置计算功能
 */

import type { TaskStatus } from '@/types/base.types';
import { sortTasksByPriority, getPriorityValue } from './priority';
import { isTaskTerminal } from './task';

/**
 * 获取任务在队列中的位置
 * @param task - 目标任务
 * @param queue - 任务队列
 * @returns 队列位置（0表示不在队列中）
 */
export function getTaskQueuePosition(
  task: { status: TaskStatus; priority?: 'high' | 'normal' | 'low' },
  queue: Array<{ status: TaskStatus; priority?: 'high' | 'normal' | 'low' }>
): number {
  if (task.status !== 'queued') {
    return 0;
  }
  
  const queuedTasks = queue.filter(t => t.status === 'queued');
  const sorted = sortTasksByPriority(queuedTasks);
  
  const taskPriority = getPriorityValue(task.priority ?? 'normal');
  const position = sorted.findIndex(t => 
    getPriorityValue(t.priority ?? 'normal') === taskPriority
  );
  
  return position + 1;
}

/**
 * 获取正在处理的任务数量
 * @param tasks - 任务列表
 * @returns 处理中任务数量
 */
export function getActiveTaskCount(tasks: Array<{ status: TaskStatus }>): number {
  return tasks.filter(t => t.status === 'processing').length;
}

/**
 * 获取排队中的任务数量
 * @param tasks - 任务列表
 * @returns 排队中任务数量
 */
export function getQueuedTaskCount(tasks: Array<{ status: TaskStatus }>): number {
  return tasks.filter(t => t.status === 'queued').length;
}

/**
 * 获取已完成的任务数量
 * @param tasks - 任务列表
 * @returns 已完成任务数量
 */
export function getCompletedTaskCount(tasks: Array<{ status: TaskStatus }>): number {
  return tasks.filter(t => t.status === 'completed').length;
}

/**
 * 获取失败的任务数量
 * @param tasks - 任务列表
 * @returns 失败任务数量
 */
export function getFailedTaskCount(tasks: Array<{ status: TaskStatus }>): number {
  return tasks.filter(t => t.status === 'failed').length;
}

/**
 * 获取任务成功率
 * @param tasks - 任务列表
 * @returns 成功率百分比（0-100）
 */
export function getTaskSuccessRate(tasks: Array<{ status: TaskStatus }>): number {
  const terminal = tasks.filter(t => isTaskTerminal(t.status));
  if (terminal.length === 0) return 0;
  
  const completed = terminal.filter(t => t.status === 'completed').length;
  return Math.round((completed / terminal.length) * 100);
}
