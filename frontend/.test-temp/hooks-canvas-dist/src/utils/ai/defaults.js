/**
 * AI默认值工具
 * @module utils/ai/defaults
 * @description 提供AI任务默认超时、优先级等配置
 */
import { AI_TASK_DEFAULTS } from '@/constants/ai.constants';
/**
 * 获取任务类型的默认超时时间
 * @param taskType - AI任务类型
 * @returns 默认超时时间（毫秒）
 */
export function getDefaultTimeout(taskType) {
    return AI_TASK_DEFAULTS.timeout[taskType];
}
/**
 * 获取任务类型的默认优先级
 * @param taskType - AI任务类型
 * @returns 默认优先级
 */
export function getDefaultPriority(taskType) {
    return AI_TASK_DEFAULTS.priority[taskType];
}
/**
 * 获取默认最大重试次数
 * @returns 默认最大重试次数
 */
export function getDefaultMaxRetries() {
    return AI_TASK_DEFAULTS.maxRetries;
}
/**
 * 计算带缓冲的超时时间
 * @param taskType - AI任务类型
 * @param bufferPercent - 缓冲百分比（默认20%）
 * @returns 带缓冲的超时时间（毫秒）
 */
export function calculateTimeoutWithBuffer(taskType, bufferPercent) {
    if (bufferPercent === void 0) { bufferPercent = 0.2; }
    var baseTimeout = getDefaultTimeout(taskType);
    return Math.round(baseTimeout * (1 + bufferPercent));
}
