/**
 * AI进度计算工具
 * @module utils/ai/progress
 * @description 提供任务进度计算和时间估算功能
 */
/**
 * 计算进度百分比
 * @param currentStep - 当前步骤
 * @param totalSteps - 总步骤数
 * @returns 进度百分比（0-100）
 */
export function calculateProgress(currentStep, totalSteps) {
    if (totalSteps <= 0)
        return 0;
    return Math.min(100, Math.round((currentStep / totalSteps) * 100));
}
/**
 * 估算剩余时间
 * @param progress - 当前进度百分比
 * @param elapsedMs - 已消耗时间（毫秒）
 * @returns 预计剩余时间（毫秒）
 */
export function estimateRemainingTime(progress, elapsedMs) {
    if (progress <= 0)
        return 0;
    var progressRatio = progress / 100;
    var totalEstimatedMs = elapsedMs / progressRatio;
    return Math.round(totalEstimatedMs - elapsedMs);
}
/**
 * 格式化剩余时间显示
 * @param ms - 剩余时间（毫秒）
 * @returns 格式化的时间字符串
 */
export function formatRemainingTime(ms) {
    if (ms <= 0)
        return '即将完成';
    var seconds = Math.round(ms / 1000);
    if (seconds < 60) {
        return "\u7EA6".concat(seconds, "\u79D2");
    }
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return "\u7EA6".concat(minutes, "\u5206\u949F");
    }
    var hours = Math.round(minutes / 60);
    return "\u7EA6".concat(hours, "\u5C0F\u65F6");
}
