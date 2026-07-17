// ==============================================
// 🔒 LOCKED: ID生成工具
// @module utils/common/id
// 最后锁定时间：2026-03-25
// 说明：提供UUID、短ID、数字ID生成功能
// 依赖层：无
// ==============================================
/**
 * 生成UUID v4
 * @description 生成符合RFC 4122标准的UUID v4
 * @returns UUID字符串
 *
 * @example
 * const id = generateUUID();
 * // "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateUUID() {
    // 优先使用原生crypto.randomUUID
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try {
            return crypto.randomUUID();
        }
        catch (_a) {
            // 回退到polyfill
        }
    }
    // 使用crypto.getRandomValues polyfill
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        return generateUUIDv4Polyfill();
    }
    // 最终回退方案
    return generateUUIDv4Fallback();
}
/**
 * UUID v4 Polyfill（使用crypto.getRandomValues）
 */
function generateUUIDv4Polyfill() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // 设置版本号和变体
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hexDigits = '0123456789abcdef';
    var uuid = '';
    for (var i = 0; i < 16; i++) {
        if (i === 4 || i === 6 || i === 8 || i === 10) {
            uuid += '-';
        }
        uuid += hexDigits[bytes[i] >> 4] + hexDigits[bytes[i] & 0x0f];
    }
    return uuid;
}
/**
 * UUID v4 回退方案（使用Math.random）
 */
function generateUUIDv4Fallback() {
    var timestamp = Date.now().toString(16).padStart(12, '0').slice(-12);
    var randomPart = Math.random().toString(16).padStart(16, '0').slice(2, 16);
    var hex = timestamp + randomPart;
    return "".concat(hex.slice(0, 8), "-").concat(hex.slice(8, 12), "-4").concat(hex.slice(13, 15), "-").concat(((Math.random() * 4) | 8).toString(16)).concat(hex.slice(16, 18), "-").concat(hex.slice(18, 30));
}
/**
 * 生成短ID
 * @description 生成指定长度的随机字符串ID
 * @param length - ID长度，默认8
 * @returns 短ID字符串
 *
 * @example
 * const shortId = generateShortId();
 * // "a1B2c3D4"
 */
export function generateShortId(length) {
    if (length === void 0) { length = 8; }
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var result = '';
    for (var i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
/**
 * 生成数字ID
 * @description 基于时间戳和随机数生成唯一ID
 * @returns 数字ID字符串
 *
 * @example
 * const numericId = generateNumericId();
 * // "lz1a2b3c4d"
 */
export function generateNumericId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}
/**
 * 创建单次执行函数
 * @description 确保函数只执行一次
 * @template T - 函数类型
 * @param fn - 原函数
 * @returns 只执行一次的函数
 *
 * @example
 * const initOnce = once(() => {
 *   console.log('初始化');
 * });
 *
 * initOnce(); // 输出: 初始化
 * initOnce(); // 不输出
 */
export function once(fn) {
    var called = false;
    var result;
    return (function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (!called) {
            called = true;
            result = fn.apply(void 0, args);
        }
        return result;
    });
}
