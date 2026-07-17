// ==============================================
// 🔒 LOCKED: 空闲回调
// @module utils/performance/idle-callback
// 最后锁定时间：2026-03-25
// 说明：提供requestIdleCallback的polyfill实现
// 依赖层：无
// ==============================================
/**
 * 请求空闲回调
 * @description 在浏览器空闲时执行回调，带polyfill
 * @param callback - 空闲时执行的回调
 * @param options - 选项
 * @returns 回调ID
 *
 * @example
 * const id = requestIdleCallback((deadline) => {
 *   while (deadline.timeRemaining() > 0) {
 *     // 执行低优先级任务
 *   }
 * });
 *
 * cancelIdleCallback(id);
 */
export function requestIdleCallback(callback, options) {
    // 浏览器原生支持
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        return window.requestIdleCallback(callback, options);
    }
    // Polyfill：使用setTimeout模拟
    return setTimeout(function () {
        var start = Date.now();
        callback({
            didTimeout: false,
            timeRemaining: function () { return Math.max(0, 50 - (Date.now() - start)); },
        });
    }, 1);
}
/**
 * 取消空闲回调
 * @description 取消之前请求的空闲回调
 * @param id - 回调ID
 */
export function cancelIdleCallback(id) {
    // 浏览器原生支持
    if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(id);
    }
    else {
        // Polyfill：使用clearTimeout
        clearTimeout(id);
    }
}
