// ==============================================
// 🔒 LOCKED: 性能追踪器
// @module utils/performance/PerformanceTracker
// 最后锁定时间：2026-03-25
// 说明：提供性能测量、统计、自动清理功能
// 依赖层：types, logger
// ==============================================

import type { PerformanceMetric, PerformanceTrackerConfig } from '@/types';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('performance');

/** 默认配置 */
const DEFAULT_CONFIG: PerformanceTrackerConfig = {
  maxCompletedMetrics: 100,
  autoCleanupInterval: 60000,
};

/**
 * 性能追踪器
 * @description 用于测量和记录代码执行性能
 */
export class PerformanceTracker {
  /** 活跃的性能指标 */
  private metrics: Map<string, PerformanceMetric> = new Map();
  /** 已完成的性能指标 */
  private completedMetrics: PerformanceMetric[] = [];
  /** 配置 */
  private config: PerformanceTrackerConfig;
  /** 清理定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<PerformanceTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startAutoCleanup();
  }

  /**
   * 启动自动清理
   */
  private startAutoCleanup(): void {
    if (this.config.autoCleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.pruneOldMetrics();
      }, this.config.autoCleanupInterval);

      // In Node-based test environments, do not keep the process alive only for metric cleanup.
      const cleanupTimerWithUnref = this.cleanupTimer as { unref?: () => void } | null;
      if (typeof cleanupTimerWithUnref?.unref === 'function') {
        cleanupTimerWithUnref.unref();
      }
    }
  }

  /**
   * 清理旧指标
   */
  private pruneOldMetrics(): void {
    if (this.completedMetrics.length > this.config.maxCompletedMetrics) {
      const excess = this.completedMetrics.length - this.config.maxCompletedMetrics;
      this.completedMetrics.splice(0, excess);
      log.debug('pruneOldMetrics', `Pruned ${excess} old metrics`);
    }
  }

  /**
   * 添加已完成的指标
   */
  private addCompletedMetric(metric: PerformanceMetric): void {
    this.completedMetrics.push(metric);
    if (this.completedMetrics.length > this.config.maxCompletedMetrics * 1.2) {
      this.pruneOldMetrics();
    }
  }

  /**
   * 开始测量
   * @param name - 指标名称
   */
  start(name: string): void {
    const metric: PerformanceMetric = {
      name,
      startTime: performance.now(),
    };
    this.metrics.set(name, metric);
    log.debug('start', `Started measuring: ${name}`);
  }

  /**
   * 结束测量
   * @param name - 指标名称
   * @returns 持续时间（毫秒）
   */
  end(name: string): number | null {
    const metric = this.metrics.get(name);
    if (!metric) {
      log.warn('end', `No metric found for: ${name}`);
      return null;
    }

    metric.endTime = performance.now();
    metric.duration = metric.endTime - metric.startTime;
    
    this.metrics.delete(name);
    this.addCompletedMetric(metric);
    
    log.debug('end', `Completed: ${name}`, { duration: `${metric.duration.toFixed(2)}ms` });
    
    return metric.duration;
  }

  /**
   * 测量同步函数
   * @param name - 指标名称
   * @param fn - 要测量的函数
   * @returns 函数返回值
   */
  measure<T>(name: string, fn: () => T): T {
    this.start(name);
    try {
      const result = fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
   * 测量异步函数
   * @param name - 指标名称
   * @param fn - 要测量的异步函数
   * @returns 函数返回值
   */
  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      const result = await fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
   * 获取所有已完成的指标
   * @returns 指标列表
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.completedMetrics];
  }

  /**
   * 获取指定指标的平均耗时
   * @param name - 指标名称
   * @returns 平均耗时（毫秒）
   */
  getAverageDuration(name: string): number | null {
    const matching = this.completedMetrics.filter((m) => m.name === name);
    if (matching.length === 0) return null;
    
    const total = matching.reduce((sum, m) => sum + (m.duration ?? 0), 0);
    return total / matching.length;
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics.clear();
    this.completedMetrics = [];
  }

  /**
   * 销毁追踪器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }

  /**
   * 获取统计信息
   * @returns 统计信息
   */
  getStats(): { active: number; completed: number; maxCompleted: number } {
    return {
      active: this.metrics.size,
      completed: this.completedMetrics.length,
      maxCompleted: this.config.maxCompletedMetrics,
    };
  }
}

/** 全局性能追踪器实例 */
export const performanceTracker = new PerformanceTracker();
