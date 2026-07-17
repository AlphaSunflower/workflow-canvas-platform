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
export function calculateProgress(
  currentStep: number,
  totalSteps: number
): number {
  if (totalSteps <= 0) return 0;
  return Math.min(100, Math.round((currentStep / totalSteps) * 100));
}

/**
 * 估算剩余时间
 * @param progress - 当前进度百分比
 * @param elapsedMs - 已消耗时间（毫秒）
 * @returns 预计剩余时间（毫秒）
 */
export function estimateRemainingTime(
  progress: number,
  elapsedMs: number
): number {
  if (progress <= 0) return 0;
  const progressRatio = progress / 100;
  const totalEstimatedMs = elapsedMs / progressRatio;
  return Math.round(totalEstimatedMs - elapsedMs);
}

/**
 * 格式化剩余时间显示
 * @param ms - 剩余时间（毫秒）
 * @returns 格式化的时间字符串
 */
export function formatRemainingTime(ms: number): string {
  if (ms <= 0) return '即将完成';
  
  const seconds = Math.round(ms / 1000);
  
  if (seconds < 60) {
    return `约${seconds}秒`;
  }
  
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `约${minutes}分钟`;
  }
  
  const hours = Math.round(minutes / 60);
  return `约${hours}小时`;
}
