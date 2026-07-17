// ==============================================
// 🔒 LOCKED: 对象操作工具
// @module utils/common/object
// 最后锁定时间：2026-03-25
// 说明：提供深拷贝、深比较、对象操作等功能
// 依赖层：无
// ==============================================
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
/** 最大递归深度 */
export var MAX_RECURSION_DEPTH = 100;
/**
 * 深拷贝错误
 */
var DeepCloneError = /** @class */ (function (_super) {
    __extends(DeepCloneError, _super);
    function DeepCloneError(message) {
        var _this = _super.call(this, message) || this;
        _this.name = 'DeepCloneError';
        return _this;
    }
    return DeepCloneError;
}(Error));
export { DeepCloneError };
/**
 * 深拷贝
 * @description 深度克隆对象，支持循环引用检测
 * @template T - 值类型
 * @param value - 要克隆的值
 * @param options - 克隆选项
 * @returns 克隆后的值
 *
 * @example
 * const original = { a: 1, b: { c: 2 } };
 * const cloned = deepClone(original);
 * // cloned 是完全独立的副本
 */
export function deepClone(value, options) {
    var _a;
    var maxDepth = (_a = options === null || options === void 0 ? void 0 : options.maxDepth) !== null && _a !== void 0 ? _a : MAX_RECURSION_DEPTH;
    var clone = function (val, depth, visited) {
        // 深度检查
        if (depth > maxDepth) {
            throw new DeepCloneError("Maximum recursion depth (".concat(maxDepth, ") exceeded in deepClone"));
        }
        // 基本类型直接返回
        if (val === null || typeof val !== 'object') {
            return val;
        }
        // 循环引用检查
        if (visited.has(val)) {
            return visited.get(val);
        }
        // 数组处理
        if (Array.isArray(val)) {
            var cloned_1 = [];
            visited.set(val, cloned_1);
            for (var i = 0; i < val.length; i++) {
                cloned_1[i] = clone(val[i], depth + 1, visited);
            }
            return cloned_1;
        }
        // Date处理
        if (val instanceof Date) {
            return new Date(val.getTime());
        }
        // Map处理
        if (val instanceof Map) {
            var cloned_2 = new Map();
            visited.set(val, cloned_2);
            val.forEach(function (v, k) {
                cloned_2.set(clone(k, depth + 1, visited), clone(v, depth + 1, visited));
            });
            return cloned_2;
        }
        // Set处理
        if (val instanceof Set) {
            var cloned_3 = new Set();
            visited.set(val, cloned_3);
            val.forEach(function (v) {
                cloned_3.add(clone(v, depth + 1, visited));
            });
            return cloned_3;
        }
        // RegExp处理
        if (val instanceof RegExp) {
            return new RegExp(val.source, val.flags);
        }
        // Error处理
        if (val instanceof Error) {
            var cloned_4 = new val.constructor(val.message);
            cloned_4.stack = val.stack;
            cloned_4.name = val.name;
            return cloned_4;
        }
        // ArrayBuffer处理
        if (typeof ArrayBuffer !== 'undefined' && val instanceof ArrayBuffer) {
            return val.slice(0);
        }
        // DataView处理
        if (typeof DataView !== 'undefined' && val instanceof DataView) {
            return new DataView(val.buffer.slice(0), val.byteOffset, val.byteLength);
        }
        // TypedArray处理
        if (ArrayBuffer.isView(val) && !(val instanceof DataView)) {
            var TypedArrayConstructor = val.constructor;
            return new TypedArrayConstructor(val);
        }
        // 普通对象处理
        var cloned = {};
        visited.set(val, cloned);
        for (var key in val) {
            if (Object.prototype.hasOwnProperty.call(val, key)) {
                cloned[key] = clone(val[key], depth + 1, visited);
            }
        }
        return cloned;
    };
    return clone(value, 0, new Map());
}
/**
 * 深比较
 * @description 深度比较两个值是否相等
 * @param a - 第一个值
 * @param b - 第二个值
 * @param options - 比较选项
 * @returns 是否相等
 *
 * @example
 * deepEqual({ a: 1 }, { a: 1 }); // true
 * deepEqual([1, 2], [1, 2]); // true
 */
export function deepEqual(a, b, options) {
    var _a;
    var maxDepth = (_a = options === null || options === void 0 ? void 0 : options.maxDepth) !== null && _a !== void 0 ? _a : MAX_RECURSION_DEPTH;
    var equal = function (x, y, depth, visited) {
        // 深度检查
        if (depth > maxDepth) {
            console.warn("Maximum recursion depth (".concat(maxDepth, ") exceeded in deepEqual, returning false"));
            return false;
        }
        // 引用相等
        if (x === y)
            return true;
        // 类型不同
        if (typeof x !== typeof y)
            return false;
        // null检查
        if (x === null || y === null)
            return x === y;
        // 基本类型
        if (typeof x !== 'object' || typeof y !== 'object') {
            return x === y;
        }
        // 循环引用检查
        var visitedX = visited.get(x);
        if (visitedX) {
            if (visitedX.has(y)) {
                return true;
            }
        }
        else {
            visited.set(x, new Map([[y, true]]));
        }
        // 数组比较
        if (Array.isArray(x) && Array.isArray(y)) {
            if (x.length !== y.length)
                return false;
            for (var i = 0; i < x.length; i++) {
                if (!equal(x[i], y[i], depth + 1, visited)) {
                    return false;
                }
            }
            return true;
        }
        // Date比较
        if (x instanceof Date && y instanceof Date) {
            return x.getTime() === y.getTime();
        }
        // RegExp比较
        if (x instanceof RegExp && y instanceof RegExp) {
            return x.source === y.source && x.flags === y.flags;
        }
        // Map比较
        if (x instanceof Map && y instanceof Map) {
            if (x.size !== y.size)
                return false;
            for (var _i = 0, x_1 = x; _i < x_1.length; _i++) {
                var _a = x_1[_i], key = _a[0], value = _a[1];
                if (!y.has(key) || !equal(value, y.get(key), depth + 1, visited)) {
                    return false;
                }
            }
            return true;
        }
        // Set比较
        if (x instanceof Set && y instanceof Set) {
            if (x.size !== y.size)
                return false;
            for (var _b = 0, x_2 = x; _b < x_2.length; _b++) {
                var value = x_2[_b];
                if (!y.has(value)) {
                    return false;
                }
            }
            return true;
        }
        // TypedArray比较
        if (ArrayBuffer.isView(x) && ArrayBuffer.isView(y)) {
            if (x.byteLength !== y.byteLength)
                return false;
            var viewX = new DataView(x.buffer, x.byteOffset, x.byteLength);
            var viewY = new DataView(y.buffer, y.byteOffset, y.byteLength);
            for (var i = 0; i < x.byteLength; i++) {
                if (viewX.getUint8(i) !== viewY.getUint8(i)) {
                    return false;
                }
            }
            return true;
        }
        // 对象键比较
        var keysX = Object.keys(x);
        var keysY = Object.keys(y);
        if (keysX.length !== keysY.length)
            return false;
        for (var _c = 0, keysX_1 = keysX; _c < keysX_1.length; _c++) {
            var key = keysX_1[_c];
            if (!Object.prototype.hasOwnProperty.call(y, key)) {
                return false;
            }
            if (!equal(x[key], y[key], depth + 1, visited)) {
                return false;
            }
        }
        return true;
    };
    return equal(a, b, 0, new Map());
}
/**
 * 提取对象属性
 * @description 从对象中提取指定的属性
 * @template T - 对象类型
 * @template K - 属性键类型
 * @param obj - 源对象
 * @param keys - 要提取的属性键数组
 * @returns 包含指定属性的新对象
 */
export function pick(obj, keys) {
    var result = {};
    for (var _i = 0, keys_1 = keys; _i < keys_1.length; _i++) {
        var key = keys_1[_i];
        if (key in obj) {
            result[key] = obj[key];
        }
    }
    return result;
}
/**
 * 排除对象属性
 * @description 从对象中排除指定的属性
 * @template T - 对象类型
 * @template K - 属性键类型
 * @param obj - 源对象
 * @param keys - 要排除的属性键数组
 * @returns 排除指定属性后的新对象
 */
export function omit(obj, keys) {
    var result = __assign({}, obj);
    for (var _i = 0, keys_2 = keys; _i < keys_2.length; _i++) {
        var key = keys_2[_i];
        delete result[key];
    }
    return result;
}
/**
 * 合并对象
 * @description 浅合并多个对象
 * @template T - 对象类型
 * @param target - 目标对象
 * @param sources - 源对象列表
 * @returns 合并后的对象
 */
export function merge(target) {
    var sources = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        sources[_i - 1] = arguments[_i];
    }
    var result = __assign({}, target);
    for (var _a = 0, sources_1 = sources; _a < sources_1.length; _a++) {
        var source = sources_1[_a];
        for (var key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                result[key] = source[key];
            }
        }
    }
    return result;
}
