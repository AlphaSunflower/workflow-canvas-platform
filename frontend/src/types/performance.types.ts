// ==============================================
// 🔒 LOCKED: 性能类型定义
// @module types/performance.types
// 最后锁定时间：2026-03-25
// 说明：定义性能相关的类型，包括性能指标、防抖节流、记忆化等
// 依赖层：无
// ==============================================

/**
 * 性能类型定义
 * @module types/performance.types
 * @description 定义性能相关的类型，包括性能指标、防抖节流、记忆化等
 */

/**
 * 性能指标
 * @description 单次性能测量的数据结构
 */
export interface PerformanceMetric {
  /** 指标名称 */
  name: string;
  /** 开始时间戳 */
  startTime: number;
  /** 结束时间戳 */
  endTime?: number;
  /** 持续时间（毫秒） */
  duration?: number;
}

/**
 * 性能追踪器配置
 * @description 配置性能追踪器的行为
 */
export interface PerformanceTrackerConfig {
  /** 最大保留的已完成指标数 */
  maxCompletedMetrics: number;
  /** 自动清理间隔（毫秒） */
  autoCleanupInterval: number;
}

/**
 * 防抖函数
 * @description 带有取消和立即执行功能的防抖函数
 */
export interface DebouncedFunction<T extends (...args: unknown[]) => unknown> {
  /** 防抖后的函数 */
  (...args: Parameters<T>): void;
  /** 取消待执行的调用 */
  cancel: () => void;
  /** 立即执行待执行的调用 */
  flush: () => void;
}

/**
 * 节流函数
 * @description 带有取消和立即执行功能的节流函数
 */
export interface ThrottledFunction<T extends (...args: unknown[]) => unknown> {
  /** 节流后的函数 */
  (...args: Parameters<T>): void;
  /** 取消待执行的调用 */
  cancel: () => void;
  /** 立即执行待执行的调用 */
  flush: () => void;
}

/**
 * 记忆化函数
 * @description 带有缓存清除功能的记忆化函数
 */
export interface MemoizedFunction<T extends (...args: unknown[]) => unknown> {
  /** 记忆化后的函数 */
  (...args: Parameters<T>): ReturnType<T>;
  /** 清除缓存 */
  clearCache: () => void;
}

/**
 * 记忆化配置
 * @description 配置记忆化函数的行为
 */
export interface MemoizeOptions {
  /** 缓存键生成函数 */
  resolver?: (...args: unknown[]) => string;
  /** 最大缓存数量（LRU淘汰） */
  maxCacheSize?: number;
}
