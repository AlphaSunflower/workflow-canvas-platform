// ==============================================
// 🔒 LOCKED: 错误格式化
// @module utils/error/format
// 最后锁定时间：2026-03-25
// 说明：提供错误消息格式化功能
// 依赖层：types, common-utils
// ==============================================
import { safeStringify } from '../common';
/**
 * 获取错误消息
 * @description 格式化错误为简短消息
 * @param error - 应用错误
 * @returns 格式化的错误消息
 *
 * @example
 * const message = getErrorMessage(error);
 * // "[module-name] operation-name: Error message"
 */
export function getErrorMessage(error) {
    return "[".concat(error.module, "] ").concat(error.operation, ": ").concat(error.message);
}
/**
 * 格式化错误用于显示
 * @description 格式化错误为用户友好的显示文本
 * @param error - 应用错误
 * @returns 格式化的显示文本
 *
 * @example
 * const displayText = formatErrorForDisplay(error);
 * // "Error message\nInput: {...}\nCode: VALIDATION_ERROR"
 */
export function formatErrorForDisplay(error) {
    var _a;
    var parts = [error.message];
    if ((_a = error.context) === null || _a === void 0 ? void 0 : _a.input) {
        parts.push("Input: ".concat(safeStringify(error.context.input)));
    }
    if (error.code) {
        parts.push("Code: ".concat(error.code));
    }
    return parts.join('\n');
}
/**
 * 格式化错误用于日志
 * @description 格式化错误为详细的日志文本
 * @param error - 应用错误
 * @returns 格式化的日志文本
 */
export function formatErrorForLog(error) {
    var lines = [
        "[".concat(error.timestamp, "] ").concat(error.code),
        "Module: ".concat(error.module),
        "Operation: ".concat(error.operation),
        "Message: ".concat(error.message),
    ];
    if (error.stack) {
        lines.push("Stack: ".concat(error.stack));
    }
    if (error.context) {
        lines.push("Context: ".concat(safeStringify(error.context)));
    }
    return lines.join('\n');
}
/**
 * 格式化错误用于API响应
 * @description 格式化错误为API响应格式
 * @param error - 应用错误
 * @returns API响应格式的错误对象
 */
export function formatErrorForAPI(error) {
    return {
        code: error.code,
        message: error.message,
        details: error.context,
    };
}
