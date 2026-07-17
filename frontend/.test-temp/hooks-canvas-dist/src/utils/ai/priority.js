/**
 * AI优先级工具
 * @module utils/ai/priority
 * @description 提供任务优先级比较和排序功能
 */
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
/**
 * 获取优先级数值
 * @param priority - 优先级
 * @returns 优先级数值（越大越高）
 */
export function getPriorityValue(priority) {
    var values = { high: 3, normal: 2, low: 1 };
    return values[priority];
}
/**
 * 比较两个任务的优先级
 * @param a - 任务A
 * @param b - 任务B
 * @returns 比较结果（正数表示A优先级更高）
 */
export function compareTaskPriority(a, b) {
    var _a, _b;
    var priorityA = getPriorityValue((_a = a.priority) !== null && _a !== void 0 ? _a : 'normal');
    var priorityB = getPriorityValue((_b = b.priority) !== null && _b !== void 0 ? _b : 'normal');
    return priorityB - priorityA;
}
/**
 * 按优先级排序任务
 * @param tasks - 任务列表
 * @returns 排序后的任务列表
 */
export function sortTasksByPriority(tasks) {
    return __spreadArray([], tasks, true).sort(compareTaskPriority);
}
