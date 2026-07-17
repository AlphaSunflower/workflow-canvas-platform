/**
 * 模块日志器
 * @module utils/logger/module
 * @description 提供创建模块专用日志器的功能
 */

import type { ModuleLogger } from './types';
import { Logger } from './Logger';

/** 全局日志器实例 */
export const logger = new Logger();

/**
 * 创建模块日志器
 * @description 为特定模块创建专用的日志器实例
 * @param module - 模块名
 * @returns 模块日志器
 * 
 * @example
 * const log = createModuleLogger('my-module');
 * log.info('operation', 'Operation completed');
 * log.error('operation', 'Operation failed', new Error('...'));
 */
export function createModuleLogger(module: string): ModuleLogger {
  return {
    debug: (operation: string, message: string, data?: Record<string, unknown>) => 
      logger.debug(module, operation, message, data),
    info: (operation: string, message: string, data?: Record<string, unknown>) => 
      logger.info(module, operation, message, data),
    warn: (operation: string, message: string, data?: Record<string, unknown>) => 
      logger.warn(module, operation, message, data),
    error: (operation: string, message: string, error?: Error, data?: Record<string, unknown>) => 
      logger.error(module, operation, message, error, data),
  };
}
