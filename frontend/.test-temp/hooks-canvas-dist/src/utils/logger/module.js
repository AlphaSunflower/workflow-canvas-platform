/**
 * 模块日志器
 * @module utils/logger/module
 * @description 提供创建模块专用日志器的功能
 */
import { Logger } from './Logger';
/** 全局日志器实例 */
export var logger = new Logger();
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
export function createModuleLogger(module) {
    return {
        debug: function (operation, message, data) {
            return logger.debug(module, operation, message, data);
        },
        info: function (operation, message, data) {
            return logger.info(module, operation, message, data);
        },
        warn: function (operation, message, data) {
            return logger.warn(module, operation, message, data);
        },
        error: function (operation, message, error, data) {
            return logger.error(module, operation, message, error, data);
        },
    };
}
