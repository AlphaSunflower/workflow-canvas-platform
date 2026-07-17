import { safeStringify } from '../common';
export function memoize(fn, keyGenerator, options) {
    var _a;
    var maxSize = (_a = options === null || options === void 0 ? void 0 : options.maxCacheSize) !== null && _a !== void 0 ? _a : 100;
    var cache = new Map();
    var accessOrder = [];
    var evictLRU = function () {
        if (accessOrder.length > 0) {
            var oldestKey = accessOrder.shift();
            if (oldestKey) {
                cache.delete(oldestKey);
            }
        }
    };
    var updateAccessOrder = function (key) {
        var index = accessOrder.indexOf(key);
        if (index !== -1) {
            accessOrder.splice(index, 1);
        }
        accessOrder.push(key);
    };
    var memoized = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        var key;
        try {
            key = keyGenerator ? keyGenerator.apply(void 0, args) : safeStringify(args);
        }
        catch (_a) {
            return fn.apply(void 0, args);
        }
        var cached = cache.get(key);
        if (cached) {
            updateAccessOrder(key);
            return cached.value;
        }
        var result = fn.apply(void 0, args);
        if (cache.size >= maxSize) {
            evictLRU();
        }
        cache.set(key, { value: result, timestamp: Date.now() });
        accessOrder.push(key);
        return result;
    };
    memoized.clearCache = function () {
        cache.clear();
        accessOrder.length = 0;
    };
    return memoized;
}
