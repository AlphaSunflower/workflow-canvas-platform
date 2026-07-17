// ==============================================
// 🔒 LOCKED: 错误检查
// @module utils/error/check
// 最后锁定时间：2026-03-25
// 说明：提供错误类型判断功能
// 依赖层：types
// ==============================================
import { getErrorInfo } from './create';
/**
 * 判断是否可恢复
 * @description 检查错误是否可以恢复
 * @param error - 应用错误
 * @returns 是否可恢复
 */
export function isRecoverable(error) {
    var info = getErrorInfo(error.code);
    return info.recoverable;
}
/**
 * 判断是否可重试
 * @description 检查错误是否可以重试
 * @param error - 应用错误
 * @returns 是否可重试
 */
export function isRetryableError(error) {
    var info = getErrorInfo(error.code);
    return info.retryable;
}
/**
 * 判断是否为网络错误
 * @description 检查错误是否为网络相关错误
 * @param error - 应用错误
 * @returns 是否为网络错误
 */
export function isNetworkError(error) {
    return error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT_ERROR';
}
/**
 * 判断是否为验证错误
 * @description 检查错误是否为数据验证错误
 * @param error - 应用错误
 * @returns 是否为验证错误
 */
export function isValidationError(error) {
    return error.code === 'VALIDATION_ERROR';
}
/**
 * 判断是否为认证错误
 * @description 检查错误是否为认证授权错误
 * @param error - 应用错误
 * @returns 是否为认证错误
 */
export function isAuthError(error) {
    return error.code === 'AUTH_ERROR' || error.code === 'PERMISSION_ERROR';
}
/**
 * 判断是否为文件错误
 * @description 检查错误是否为文件相关错误
 * @param error - 应用错误
 * @returns 是否为文件错误
 */
export function isFileError(error) {
    var fileCodes = [
        'FILE_TYPE_ERROR',
        'FILE_SIZE_ERROR',
        'FILE_CORRUPTED',
        'UPLOAD_ERROR',
        'DOWNLOAD_ERROR',
    ];
    return fileCodes.includes(error.code);
}
/**
 * 判断是否为AI任务错误
 * @description 检查错误是否为AI任务相关错误
 * @param error - 应用错误
 * @returns 是否为AI任务错误
 */
export function isAITaskError(error) {
    var aiCodes = [
        'AI_TASK_ERROR',
        'AI_TASK_TIMEOUT',
        'AI_TASK_CANCELLED',
        'AI_PROVIDER_ERROR',
        'AI_RATE_LIMIT',
    ];
    return aiCodes.includes(error.code);
}
