// ==============================================
// 🔒 LOCKED: 错误创建
// @module utils/error/create
// 最后锁定时间：2026-03-25
// 说明：提供错误对象创建功能
// 依赖层：types, constants
// ==============================================
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
import { ERROR_INFO_MAP } from '@/constants/error.constants';
/**
 * 创建应用错误对象
 * @description 根据错误码和上下文创建标准化的错误对象
 * @param code - 错误码
 * @param message - 错误消息
 * @param context - 错误上下文
 * @returns 应用错误对象
 *
 * @example
 * const error = createError('VALIDATION_ERROR', '文件格式不支持', {
 *   module: 'file-upload',
 *   operation: 'validateFile',
 *   timestamp: Date.now(),
 * });
 */
export function createError(code, message, context) {
    var _a;
    return {
        code: code,
        message: message,
        module: context.module,
        operation: context.operation,
        timestamp: context.timestamp,
        stack: context.stack,
        context: __assign({ input: context.input, cause: (_a = context.cause) === null || _a === void 0 ? void 0 : _a.message }, context.context),
    };
}
/**
 * 判断是否为应用错误
 * @description 类型守卫，判断对象是否为AppError类型
 * @param result - 要检查的对象
 * @returns 是否为AppError
 */
export function isError(result) {
    return typeof result === 'object' && result !== null && 'code' in result && 'message' in result;
}
/**
 * 获取错误信息
 * @description 根据错误码获取预定义的错误信息
 * @param code - 错误码
 * @returns 错误信息
 */
export function getErrorInfo(code) {
    return ERROR_INFO_MAP[code] || ERROR_INFO_MAP.UNKNOWN_ERROR;
}
