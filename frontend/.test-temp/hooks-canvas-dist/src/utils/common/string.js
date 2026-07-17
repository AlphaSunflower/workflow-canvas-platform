// ==============================================
// 🔒 LOCKED: 字符串处理工具
// @module utils/common/string
// 最后锁定时间：2026-03-25
// 说明：提供字符串格式化、转换、截断等功能
// 依赖层：无
// ==============================================
/**
 * 安全的JSON序列化
 * @description 处理循环引用，不会抛出错误
 * @param obj - 要序列化的对象
 * @param space - 缩进空格数
 * @returns JSON字符串
 *
 * @example
 * const obj = { a: 1 };
 * obj.self = obj; // 循环引用
 * const json = safeStringify(obj);
 * // 不会抛出错误
 */
export function safeStringify(obj, space) {
    var seen = new WeakSet();
    return JSON.stringify(obj, function (_key, value) {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular]';
            }
            seen.add(value);
        }
        return value;
    }, space);
}
/**
 * 安全的JSON解析
 * @description 解析失败时返回默认值
 * @template T - 返回值类型
 * @param json - JSON字符串
 * @param defaultValue - 默认值
 * @returns 解析结果或默认值
 *
 * @example
 * const data = safeParse('{"a":1}', { a: 0 });
 * // data: { a: 1 }
 *
 * const fallback = safeParse('invalid json', { a: 0 });
 * // fallback: { a: 0 }
 */
export function safeParse(json, defaultValue) {
    try {
        return JSON.parse(json);
    }
    catch (_a) {
        return defaultValue;
    }
}
/**
 * 截断字符串
 * @description 截断字符串到指定长度，添加后缀
 * @param str - 原字符串
 * @param maxLength - 最大长度
 * @param suffix - 后缀，默认 "..."
 * @returns 截断后的字符串
 *
 * @example
 * truncate('这是一个很长的字符串', 5);
 * // "这是一个很..."
 */
export function truncate(str, maxLength, suffix) {
    if (suffix === void 0) { suffix = '...'; }
    if (str.length <= maxLength)
        return str;
    return str.slice(0, maxLength - suffix.length) + suffix;
}
/**
 * 首字母大写
 * @description 将字符串首字母转换为大写
 * @param str - 原字符串
 * @returns 首字母大写的字符串
 *
 * @example
 * capitalize('hello');
 * // "Hello"
 */
export function capitalize(str) {
    if (str.length === 0)
        return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}
/**
 * 驼峰转下划线
 * @description 将驼峰命名转换为下划线命名
 * @param str - 驼峰字符串
 * @returns 下划线字符串
 *
 * @example
 * camelToSnake('userName');
 * // "user_name"
 */
export function camelToSnake(str) {
    return str.replace(/[A-Z]/g, function (letter) { return "_".concat(letter.toLowerCase()); });
}
/**
 * 下划线转驼峰
 * @description 将下划线命名转换为驼峰命名
 * @param str - 下划线字符串
 * @returns 驼峰字符串
 *
 * @example
 * snakeToCamel('user_name');
 * // "userName"
 */
export function snakeToCamel(str) {
    return str.replace(/_([a-z])/g, function (_, letter) { return letter.toUpperCase(); });
}
/**
 * 驼峰转短横线
 * @description 将驼峰命名转换为短横线命名
 * @param str - 驼峰字符串
 * @returns 短横线字符串
 */
export function camelToKebab(str) {
    return str.replace(/[A-Z]/g, function (letter) { return "-".concat(letter.toLowerCase()); });
}
/**
 * 短横线转驼峰
 * @description 将短横线命名转换为驼峰命名
 * @param str - 短横线字符串
 * @returns 驼峰字符串
 */
export function kebabToCamel(str) {
    return str.replace(/-([a-z])/g, function (_, letter) { return letter.toUpperCase(); });
}
/**
 * 判断是否为空字符串
 * @description 检查字符串是否为空或只包含空白字符
 * @param str - 字符串
 * @returns 是否为空
 */
export function isEmptyString(str) {
    return str.trim().length === 0;
}
/**
 * 生成随机字符串
 * @description 生成指定长度的随机字符串
 * @param length - 长度
 * @param chars - 字符集
 * @returns 随机字符串
 */
export function randomString(length, chars) {
    if (chars === void 0) { chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; }
    var result = '';
    for (var i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
/**
 * 转义HTML
 * @description 转义HTML特殊字符
 * @param str - 原字符串
 * @returns 转义后的字符串
 */
export function escapeHtml(str) {
    var escapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };
    return str.replace(/[&<>"']/g, function (char) { return escapeMap[char]; });
}
/**
 * 反转义HTML
 * @description 反转义HTML特殊字符
 * @param str - 转义后的字符串
 * @returns 原字符串
 */
export function unescapeHtml(str) {
    var unescapeMap = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
    };
    return str.replace(/&(amp|lt|gt|quot|#39);/g, function (entity) { return unescapeMap[entity] || entity; });
}
/**
 * 模板字符串替换
 * @description 使用对象替换模板中的占位符
 * @param template - 模板字符串
 * @param data - 替换数据
 * @returns 替换后的字符串
 *
 * @example
 * template('Hello, {name}!', { name: 'World' });
 * // "Hello, World!"
 */
export function template(template, data) {
    return template.replace(/\{(\w+)\}/g, function (_, key) {
        var _a;
        return String((_a = data[key]) !== null && _a !== void 0 ? _a : '');
    });
}
