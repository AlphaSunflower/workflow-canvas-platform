/**
 * AI任务状态工具
 * @module utils/ai/task
 * @description 提供任务状态判断和状态文本转换功能
 */
/**
 * 判断任务是否处于终态
 * @param status - 任务状态
 * @returns 是否终态
 */
export function isTaskTerminal(status) {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}
/**
 * 判断任务是否处于活动状态
 * @param status - 任务状态
 * @returns 是否活动状态
 */
export function isTaskActive(status) {
    return status === 'queued' || status === 'processing';
}
/**
 * 判断任务是否可以取消
 * @param status - 任务状态
 * @returns 是否可取消
 */
export function canCancelTask(status) {
    return status === 'queued' || status === 'processing';
}
/**
 * 判断任务是否可以重试
 * @param status - 任务状态
 * @returns 是否可重试
 */
export function canRetryTask(status) {
    return status === 'failed';
}
/**
 * 获取任务状态的显示文本
 * @param status - 任务状态
 * @returns 状态中文文本
 */
export function getTaskStatusText(status) {
    var _a;
    var statusMap = {
        queued: '排队中',
        processing: '处理中',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消',
    };
    return (_a = statusMap[status]) !== null && _a !== void 0 ? _a : '未知';
}
/**
 * 获取任务状态的颜色
 * @param status - 任务状态
 * @returns 颜色十六进制字符串
 */
export function getTaskStatusColor(status) {
    var _a;
    var colors = {
        queued: '#F59E0B',
        processing: '#3B82F6',
        completed: '#10B981',
        failed: '#EF4444',
        cancelled: '#6B7280',
    };
    return (_a = colors[status]) !== null && _a !== void 0 ? _a : '#6B7280';
}
