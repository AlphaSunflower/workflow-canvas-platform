// ==============================================
// 🔒 LOCKED: 日志类型定义
// @module types/logger.types
// 最后锁定时间：2026-03-25
// 说明：定义日志相关的类型，包括日志级别、日志条目、配置等
// 依赖层：无
// ==============================================

/**
 * 日志类型定义
 * @module types/logger.types
 * @description 定义日志相关的类型，包括日志级别、日志条目、配置等
 */

/**
 * 日志级别
 * @description 支持的日志级别，按严重程度递增
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志条目
 * @description 单条日志记录的数据结构
 */
export interface LogEntry {
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 日志级别 */
  level: LogLevel;
  /** 模块名 */
  module: string;
  /** 操作名 */
  operation: string;
  /** 日志消息 */
  message: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
  /** 错误信息 */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * 日志器配置
 * @description 配置日志器的行为
 */
export interface LoggerConfig {
  /** 日志级别 */
  level: LogLevel;
  /** 是否启用控制台输出 */
  enableConsole: boolean;
  /** 是否启用存储 */
  enableStorage: boolean;
  /** 最大存储条目数 */
  maxStorageSize: number;
  /** 过滤的模块列表 */
  modules?: string[];
}

/**
 * 模块日志器接口
 * @description 为特定模块创建的日志器接口
 */
export interface ModuleLogger {
  /** 调试日志 */
  debug: (operation: string, message: string, data?: Record<string, unknown>) => void;
  /** 信息日志 */
  info: (operation: string, message: string, data?: Record<string, unknown>) => void;
  /** 警告日志 */
  warn: (operation: string, message: string, data?: Record<string, unknown>) => void;
  /** 错误日志 */
  error: (operation: string, message: string, error?: Error, data?: Record<string, unknown>) => void;
}

/** 日志级别数值映射 */
export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
