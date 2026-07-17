// ==============================================
// 🔒 LOCKED: AI任务管理 Hook
// @module hooks/ai/useAITask
// 最后锁定时间：2026-03-25
// 说明：提供AI任务的创建、状态管理、取消等功能
// 依赖层：types (import type), constants, utils
// ==============================================

import { useCallback, useMemo, useState } from 'react';
import type { 
  AITask, 
  TaskStatus, 
  AITaskType,
  AIProvider,
  AIModelType,
  UUID,
  AITaskError,
} from '@/types';
import { 
  createModuleLogger,
  generateUUID,
} from '@/utils';

/** 模块日志器 */
const log = createModuleLogger('useAITask');

/**
 * AI任务管理 Hook 配置选项
 * @description 配置任务管理行为和回调
 */
export interface UseAITaskOptions {
  /** 最大并发任务数 */
  maxConcurrentTasks?: number;
  /** 任务创建回调 */
  onTaskCreated?: (task: AITask) => void;
  /** 任务状态变更回调 */
  onTaskStatusChange?: (taskId: string, status: TaskStatus) => void;
  /** 任务进度回调 */
  onTaskProgress?: (taskId: string, progress: number) => void;
  /** 任务完成回调 */
  onTaskCompleted?: (taskId: string, result: unknown) => void;
  /** 任务错误回调 */
  onTaskError?: (taskId: string, error: string) => void;
}

/**
 * AI任务管理 Hook 返回值
 * @description 提供任务状态和操作方法
 */
export interface UseAITaskReturn {
  /** 所有任务 */
  tasks: Map<string, AITask>;
  /** 活跃任务列表 */
  activeTasks: AITask[];
  /** 待处理任务列表 */
  pendingTasks: AITask[];
  /** 已完成任务列表 */
  completedTasks: AITask[];
  /** 失败任务列表 */
  failedTasks: AITask[];
  /** 是否有活跃任务 */
  hasActiveTasks: boolean;
  /** 活跃任务数量 */
  activeCount: number;
  /** 创建任务 */
  createTask: (type: AITaskType, config: Record<string, unknown>, provider?: AIProvider, model?: AIModelType) => AITask;
  /** 取消任务 */
  cancelTask: (taskId: string) => void;
  /** 取消所有任务 */
  cancelAllTasks: () => void;
  /** 重试任务 */
  retryTask: (taskId: string) => void;
  /** 获取任务 */
  getTask: (taskId: string) => AITask | undefined;
  /** 更新任务状态 */
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  /** 更新任务进度 */
  updateTaskProgress: (taskId: string, progress: number) => void;
  /** 完成任务 */
  completeTask: (taskId: string, result: unknown) => void;
  /** 任务失败 */
  failTask: (taskId: string, error: string) => void;
  /** 清除已完成任务 */
  clearCompletedTasks: () => void;
  /** 清除失败任务 */
  clearFailedTasks: () => void;
}

/**
 * AI任务管理 Hook
 * @description 提供AI任务的创建、状态管理、取消等功能
 * @param options - Hook 配置选项
 * @returns 任务状态和操作方法
 */
export function useAITask(options: UseAITaskOptions = {}): UseAITaskReturn {
  // 解构配置选项
  const {
    onTaskCreated,
    onTaskStatusChange,
    onTaskProgress,
    onTaskCompleted,
    onTaskError,
  } = options;

  /** 任务Map */
  const [tasks, setTasks] = useState<Map<string, AITask>>(new Map());

  /**
   * 更新任务
   * @description 更新指定任务的属性
   * @param taskId - 任务ID
   * @param updates - 要更新的属性
   */
  const updateTask = useCallback((taskId: string, updates: Partial<AITask>) => {
    setTasks(prev => {
      const newMap = new Map(prev);
      const task = newMap.get(taskId);
      if (task) {
        newMap.set(taskId, { ...task, ...updates });
      }
      return newMap;
    });
  }, []);

  /**
   * 创建任务
   * @description 创建新的AI任务
   * @param type - 任务类型
   * @param config - 任务配置
   * @param provider - AI提供商
   * @param model - AI模型
   * @returns 创建的任务
   */
  const createTask = useCallback((
    type: AITaskType,
    config: Record<string, unknown>,
    provider?: AIProvider,
    model?: AIModelType
  ): AITask => {
    /** 当前时间戳 */
    const now = Date.now();
    /** 新任务对象 */
    const task: AITask = {
      id: generateUUID() as UUID,
      type,
      status: 'queued',
      input: {
        files: [],
        config: config as AITask['input']['config'],
        references: [],
      },
      provider: provider ?? 'openai',
      model: model ?? 'gpt-4',
      progress: 0,
      nodeId: '',
      projectId: '' as UUID,
      timestamp: {
        created: now,
        updated: now,
      },
    };

    setTasks(prev => new Map(prev).set(task.id, task));
    onTaskCreated?.(task);
    log.info('createTask', `Created AI task: ${task.id} (${type})`);

    return task;
  }, [onTaskCreated]);

  /**
   * 取消任务
   * @description 取消指定任务
   * @param taskId - 任务ID
   */
  const cancelTask = useCallback((taskId: string) => {
    /** 当前时间戳 */
    const now = Date.now();
    updateTask(taskId, { 
      status: 'cancelled',
      timestamp: { 
        created: tasks.get(taskId)?.timestamp.created ?? now,
        updated: now,
      },
      completedAt: now,
    });
    onTaskStatusChange?.(taskId, 'cancelled');
    log.debug('cancelTask', `Cancelled task: ${taskId}`);
  }, [updateTask, tasks, onTaskStatusChange]);

  /**
   * 取消所有任务
   * @description 取消所有活跃任务
   */
  const cancelAllTasks = useCallback(() => {
    setTasks(prev => {
      const newMap = new Map(prev);
      newMap.forEach((task, id) => {
        if (task.status === 'queued' || task.status === 'processing') {
          newMap.set(id, { ...task, status: 'cancelled' });
          onTaskStatusChange?.(id, 'cancelled');
        }
      });
      return newMap;
    });
    log.debug('cancelAllTasks', 'Cancelled all active tasks');
  }, [onTaskStatusChange]);

  /**
   * 重试任务
   * @description 重试失败的任务
   * @param taskId - 任务ID
   */
  const retryTask = useCallback((taskId: string) => {
    const task = tasks.get(taskId);
    if (!task || task.status !== 'failed') return;

    /** 当前时间戳 */
    const now = Date.now();
    /** 重试任务对象 */
    const retriedTask: AITask = {
      ...task,
      id: generateUUID() as UUID,
      status: 'queued',
      error: undefined,
      output: undefined,
      timestamp: { created: now, updated: now },
    };

    setTasks(prev => {
      const newMap = new Map(prev);
      newMap.delete(taskId);
      newMap.set(retriedTask.id, retriedTask);
      return newMap;
    });
    
    onTaskCreated?.(retriedTask);
    log.debug('retryTask', `Retried task: ${taskId} -> ${retriedTask.id}`);
  }, [tasks, onTaskCreated]);

  /**
   * 获取任务
   * @description 获取指定ID的任务
   * @param taskId - 任务ID
   * @returns 任务对象
   */
  const getTask = useCallback((taskId: string): AITask | undefined => {
    return tasks.get(taskId);
  }, [tasks]);

  /**
   * 更新任务状态
   * @description 更新任务的状态
   * @param taskId - 任务ID
   * @param status - 新状态
   */
  const updateTaskStatus = useCallback((taskId: string, status: TaskStatus) => {
    /** 当前时间戳 */
    const now = Date.now();
    updateTask(taskId, { 
      status,
      timestamp: { 
        created: tasks.get(taskId)?.timestamp.created ?? now,
        updated: now,
      },
    });
    onTaskStatusChange?.(taskId, status);
    log.debug('updateTaskStatus', `Task ${taskId} status: ${status}`);
  }, [updateTask, tasks, onTaskStatusChange]);

  /**
   * 更新任务进度
   * @description 更新任务的进度
   * @param taskId - 任务ID
   * @param progress - 进度值
   */
  const updateTaskProgress = useCallback((taskId: string, progress: number) => {
    updateTask(taskId, { progress });
    onTaskProgress?.(taskId, progress);
  }, [updateTask, onTaskProgress]);

  /**
   * 完成任务
   * @description 标记任务为已完成
   * @param taskId - 任务ID
   * @param result - 任务结果
   */
  const completeTask = useCallback((taskId: string, result: unknown) => {
    /** 当前时间戳 */
    const now = Date.now();
    updateTask(taskId, { 
      status: 'completed',
      output: result as AITask['output'],
      progress: 100,
      timestamp: { 
        created: tasks.get(taskId)?.timestamp.created ?? now,
        updated: now,
      },
      completedAt: now,
    });
    onTaskStatusChange?.(taskId, 'completed');
    onTaskCompleted?.(taskId, result);
    log.info('completeTask', `Task ${taskId} completed`);
  }, [updateTask, tasks, onTaskStatusChange, onTaskCompleted]);

  /**
   * 任务失败
   * @description 标记任务为失败
   * @param taskId - 任务ID
   * @param error - 错误信息
   */
  const failTask = useCallback((taskId: string, error: string) => {
    /** 当前时间戳 */
    const now = Date.now();
    /** 任务错误对象 */
    const taskError: AITaskError = {
      code: 'TASK_ERROR',
      message: error,
      retryable: true,
    };
    updateTask(taskId, { 
      status: 'failed',
      error: taskError,
      timestamp: { 
        created: tasks.get(taskId)?.timestamp.created ?? now,
        updated: now,
      },
      completedAt: now,
    });
    onTaskStatusChange?.(taskId, 'failed');
    onTaskError?.(taskId, error);
    log.error('failTask', `Task ${taskId} failed: ${error}`);
  }, [updateTask, tasks, onTaskStatusChange, onTaskError]);

  /**
   * 清除已完成任务
   * @description 移除所有已完成的任务
   */
  const clearCompletedTasks = useCallback(() => {
    setTasks(prev => {
      const newMap = new Map(prev);
      Array.from(newMap.entries())
        .filter(([, task]) => task.status === 'completed')
        .forEach(([id]) => newMap.delete(id));
      return newMap;
    });
    log.debug('clearCompletedTasks', 'Cleared completed tasks');
  }, []);

  /**
   * 清除失败任务
   * @description 移除所有失败的任务
   */
  const clearFailedTasks = useCallback(() => {
    setTasks(prev => {
      const newMap = new Map(prev);
      Array.from(newMap.entries())
        .filter(([, task]) => task.status === 'failed')
        .forEach(([id]) => newMap.delete(id));
      return newMap;
    });
    log.debug('clearFailedTasks', 'Cleared failed tasks');
  }, []);

  /** 活跃任务列表 */
  const activeTasks = useMemo(() => {
    return Array.from(tasks.values()).filter(
      task => task.status === 'processing'
    );
  }, [tasks]);

  /** 待处理任务列表 */
  const pendingTasks = useMemo(() => {
    return Array.from(tasks.values()).filter(
      task => task.status === 'queued'
    );
  }, [tasks]);

  /** 已完成任务列表 */
  const completedTasks = useMemo(() => {
    return Array.from(tasks.values()).filter(
      task => task.status === 'completed'
    );
  }, [tasks]);

  /** 失败任务列表 */
  const failedTasks = useMemo(() => {
    return Array.from(tasks.values()).filter(
      task => task.status === 'failed'
    );
  }, [tasks]);

  // 返回所有状态和方法
  return useMemo(() => ({
    tasks,
    activeTasks,
    pendingTasks,
    completedTasks,
    failedTasks,
    hasActiveTasks: activeTasks.length > 0,
    activeCount: activeTasks.length,
    createTask,
    cancelTask,
    cancelAllTasks,
    retryTask,
    getTask,
    updateTaskStatus,
    updateTaskProgress,
    completeTask,
    failTask,
    clearCompletedTasks,
    clearFailedTasks,
  }), [
    tasks,
    activeTasks,
    pendingTasks,
    completedTasks,
    failedTasks,
    createTask,
    cancelTask,
    cancelAllTasks,
    retryTask,
    getTask,
    updateTaskStatus,
    updateTaskProgress,
    completeTask,
    failTask,
    clearCompletedTasks,
    clearFailedTasks,
  ]);
}
