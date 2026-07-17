/**
 * 鏃ュ織鍣ㄧ被
 * @module utils/logger/Logger
 * @description 鎻愪緵鏃ュ織璁板綍銆佸瓨鍌ㄣ€佽繃婊ゅ姛鑳? */
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { LOG_LEVELS } from './types';
/**
 * 鏃ュ織鍣? * @description 鐢ㄤ簬璁板綍鍜岀鐞嗘棩蹇楃殑鏍稿績绫? */
var Logger = /** @class */ (function () {
    /**
     * 鍒涘缓鏃ュ織鍣ㄥ疄渚?   * @param config - 閮ㄥ垎閰嶇疆
     */
    function Logger(config) {
        if (config === void 0) { config = {}; }
        var _a, _b, _c, _d;
        /** 鏃ュ織瀛樺偍 */
        this.storage = [];
        this.config = {
            level: (_a = config.level) !== null && _a !== void 0 ? _a : 'info',
            enableConsole: (_b = config.enableConsole) !== null && _b !== void 0 ? _b : true,
            enableStorage: (_c = config.enableStorage) !== null && _c !== void 0 ? _c : true,
            maxStorageSize: (_d = config.maxStorageSize) !== null && _d !== void 0 ? _d : 1000,
            modules: config.modules,
        };
    }
    /**
     * 鍒ゆ柇鏄惁搴旇璁板綍鏃ュ織
     * @param level - 鏃ュ織绾у埆
     * @param module - 妯″潡鍚?   * @returns 鏄惁搴旇璁板綍
     */
    Logger.prototype.shouldLog = function (level, module) {
        if (this.config.modules && !this.config.modules.includes(module)) {
            return false;
        }
        return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
    };
    /**
     * 鏍煎紡鍖栨椂闂存埑
     * @param timestamp - 鏃堕棿鎴?   * @returns ISO鏍煎紡瀛楃涓?   */
    Logger.prototype.formatTimestamp = function (timestamp) {
        var date = new Date(timestamp);
        return date.toISOString();
    };
    /**
     * 鍒涘缓鏃ュ織鏉＄洰
     * @param level - 鏃ュ織绾у埆
     * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
     * @param data - 闄勫姞鏁版嵁
     * @param error - 閿欒瀵硅薄
     * @returns 鏃ュ織鏉＄洰
     */
    Logger.prototype.createEntry = function (level, module, operation, message, data, error) {
        var entry = {
            timestamp: Date.now(),
            level: level,
            module: module,
            operation: operation,
            message: message,
        };
        if (data) {
            entry.data = data;
        }
        if (error) {
            entry.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        }
        return entry;
    };
    /**
     * 璁板綍鏃ュ織
     * @param entry - 鏃ュ織鏉＄洰
     */
    Logger.prototype.log = function (entry) {
        var _a, _b;
        if (!this.shouldLog(entry.level, entry.module)) {
            return;
        }
        if (this.config.enableConsole) {
            var prefix = "[".concat(this.formatTimestamp(entry.timestamp), "][").concat(entry.module, "][").concat(entry.operation, "]");
            var consoleMethod = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log';
            if (entry.error) {
                // eslint-disable-next-line no-console
                console[consoleMethod](prefix, entry.message, (_a = entry.data) !== null && _a !== void 0 ? _a : '', entry.error);
            }
            else {
                // eslint-disable-next-line no-console
                console[consoleMethod](prefix, entry.message, (_b = entry.data) !== null && _b !== void 0 ? _b : '');
            }
        }
        if (this.config.enableStorage) {
            this.storage.push(entry);
            if (this.storage.length > this.config.maxStorageSize) {
                this.storage.shift();
            }
        }
    };
    /**
     * 璁板綍璋冭瘯鏃ュ織
     * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
     * @param data - 闄勫姞鏁版嵁
     */
    Logger.prototype.debug = function (module, operation, message, data) {
        this.log(this.createEntry('debug', module, operation, message, data));
    };
    /**
     * 璁板綍淇℃伅鏃ュ織
     * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
     * @param data - 闄勫姞鏁版嵁
     */
    Logger.prototype.info = function (module, operation, message, data) {
        this.log(this.createEntry('info', module, operation, message, data));
    };
    /**
     * 璁板綍璀﹀憡鏃ュ織
     * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
     * @param data - 闄勫姞鏁版嵁
     */
    Logger.prototype.warn = function (module, operation, message, data) {
        this.log(this.createEntry('warn', module, operation, message, data));
    };
    /**
     * 璁板綍閿欒鏃ュ織
     * @param module - 妯″潡鍚?   * @param operation - 鎿嶄綔鍚?   * @param message - 娑堟伅
     * @param error - 閿欒瀵硅薄
     * @param data - 闄勫姞鏁版嵁
     */
    Logger.prototype.error = function (module, operation, message, error, data) {
        this.log(this.createEntry('error', module, operation, message, data, error));
    };
    /**
     * 鑾峰彇瀛樺偍鐨勬棩蹇?   * @returns 鏃ュ織鏉＄洰鏁扮粍
     */
    Logger.prototype.getStorage = function () {
        return __spreadArray([], this.storage, true);
    };
    /**
     * 娓呯┖瀛樺偍鐨勬棩蹇?   */
    Logger.prototype.clearStorage = function () {
        this.storage = [];
    };
    /**
     * 璁剧疆鏃ュ織绾у埆
     * @param level - 鏃ュ織绾у埆
     */
    Logger.prototype.setLevel = function (level) {
        this.config.level = level;
    };
    /**
     * 鏇存柊閰嶇疆
     * @param config - 閮ㄥ垎閰嶇疆
     */
    Logger.prototype.setConfig = function (config) {
        this.config = __assign(__assign({}, this.config), config);
    };
    return Logger;
}());
export { Logger };
