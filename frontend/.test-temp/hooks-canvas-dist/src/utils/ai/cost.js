/**
 * AI成本计算工具
 * @module utils/ai/cost
 * @description 提供Token计数和成本计算功能
 */
/**
 * 格式化Token数量显示
 * @param count - Token数量
 * @returns 格式化的字符串
 */
export function formatTokenCount(count) {
    if (count >= 1000000) {
        return "".concat((count / 1000000).toFixed(1), "M");
    }
    if (count >= 1000) {
        return "".concat((count / 1000).toFixed(1), "K");
    }
    return String(count);
}
/**
 * 计算API调用成本
 * @param promptTokens - 提示Token数
 * @param completionTokens - 完成Token数
 * @param costPerPromptToken - 每个提示Token的成本
 * @param costPerCompletionToken - 每个完成Token的成本
 * @returns 总成本
 */
export function calculateCost(promptTokens, completionTokens, costPerPromptToken, costPerCompletionToken) {
    return (promptTokens * costPerPromptToken) + (completionTokens * costPerCompletionToken);
}
/**
 * 格式化成本显示
 * @param cost - 成本金额
 * @returns 格式化的字符串
 */
export function formatCost(cost) {
    if (cost < 0.01) {
        return "$".concat(cost.toFixed(4));
    }
    if (cost < 1) {
        return "$".concat(cost.toFixed(3));
    }
    return "$".concat(cost.toFixed(2));
}
