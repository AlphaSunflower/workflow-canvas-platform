// ==============================================
// 🔒 LOCKED: 性能追踪器
// @module utils/performance/PerformanceTracker
// 最后锁定时间：2026-03-25
// 说明：提供性能测量、统计、自动清理功能
// 依赖层：types, logger
// ==============================================
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
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
import { createModuleLogger } from '../logger';
var log = createModuleLogger('performance');
/** 默认配置 */
var DEFAULT_CONFIG = {
    maxCompletedMetrics: 100,
    autoCleanupInterval: 60000,
};
/**
 * 性能追踪器
 * @description 用于测量和记录代码执行性能
 */
var PerformanceTracker = /** @class */ (function () {
    function PerformanceTracker(config) {
        if (config === void 0) { config = {}; }
        /** 活跃的性能指标 */
        this.metrics = new Map();
        /** 已完成的性能指标 */
        this.completedMetrics = [];
        /** 清理定时器 */
        this.cleanupTimer = null;
        this.config = __assign(__assign({}, DEFAULT_CONFIG), config);
        this.startAutoCleanup();
    }
    /**
     * 启动自动清理
     */
    PerformanceTracker.prototype.startAutoCleanup = function () {
        var _this = this;
        if (this.config.autoCleanupInterval > 0) {
            this.cleanupTimer = setInterval(function () {
                _this.pruneOldMetrics();
            }, this.config.autoCleanupInterval);
            // In Node-based test environments, do not keep the process alive only for metric cleanup.
            var cleanupTimerWithUnref = this.cleanupTimer;
            if (typeof (cleanupTimerWithUnref === null || cleanupTimerWithUnref === void 0 ? void 0 : cleanupTimerWithUnref.unref) === 'function') {
                cleanupTimerWithUnref.unref();
            }
        }
    };
    /**
     * 清理旧指标
     */
    PerformanceTracker.prototype.pruneOldMetrics = function () {
        if (this.completedMetrics.length > this.config.maxCompletedMetrics) {
            var excess = this.completedMetrics.length - this.config.maxCompletedMetrics;
            this.completedMetrics.splice(0, excess);
            log.debug('pruneOldMetrics', "Pruned ".concat(excess, " old metrics"));
        }
    };
    /**
     * 添加已完成的指标
     */
    PerformanceTracker.prototype.addCompletedMetric = function (metric) {
        this.completedMetrics.push(metric);
        if (this.completedMetrics.length > this.config.maxCompletedMetrics * 1.2) {
            this.pruneOldMetrics();
        }
    };
    /**
     * 开始测量
     * @param name - 指标名称
     */
    PerformanceTracker.prototype.start = function (name) {
        var metric = {
            name: name,
            startTime: performance.now(),
        };
        this.metrics.set(name, metric);
        log.debug('start', "Started measuring: ".concat(name));
    };
    /**
     * 结束测量
     * @param name - 指标名称
     * @returns 持续时间（毫秒）
     */
    PerformanceTracker.prototype.end = function (name) {
        var metric = this.metrics.get(name);
        if (!metric) {
            log.warn('end', "No metric found for: ".concat(name));
            return null;
        }
        metric.endTime = performance.now();
        metric.duration = metric.endTime - metric.startTime;
        this.metrics.delete(name);
        this.addCompletedMetric(metric);
        log.debug('end', "Completed: ".concat(name), { duration: "".concat(metric.duration.toFixed(2), "ms") });
        return metric.duration;
    };
    /**
     * 测量同步函数
     * @param name - 指标名称
     * @param fn - 要测量的函数
     * @returns 函数返回值
     */
    PerformanceTracker.prototype.measure = function (name, fn) {
        this.start(name);
        try {
            var result = fn();
            this.end(name);
            return result;
        }
        catch (error) {
            this.end(name);
            throw error;
        }
    };
    /**
     * 测量异步函数
     * @param name - 指标名称
     * @param fn - 要测量的异步函数
     * @returns 函数返回值
     */
    PerformanceTracker.prototype.measureAsync = function (name, fn) {
        return __awaiter(this, void 0, void 0, function () {
            var result, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.start(name);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, fn()];
                    case 2:
                        result = _a.sent();
                        this.end(name);
                        return [2 /*return*/, result];
                    case 3:
                        error_1 = _a.sent();
                        this.end(name);
                        throw error_1;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * 获取所有已完成的指标
     * @returns 指标列表
     */
    PerformanceTracker.prototype.getMetrics = function () {
        return __spreadArray([], this.completedMetrics, true);
    };
    /**
     * 获取指定指标的平均耗时
     * @param name - 指标名称
     * @returns 平均耗时（毫秒）
     */
    PerformanceTracker.prototype.getAverageDuration = function (name) {
        var matching = this.completedMetrics.filter(function (m) { return m.name === name; });
        if (matching.length === 0)
            return null;
        var total = matching.reduce(function (sum, m) { var _a; return sum + ((_a = m.duration) !== null && _a !== void 0 ? _a : 0); }, 0);
        return total / matching.length;
    };
    /**
     * 清除所有指标
     */
    PerformanceTracker.prototype.clear = function () {
        this.metrics.clear();
        this.completedMetrics = [];
    };
    /**
     * 销毁追踪器
     */
    PerformanceTracker.prototype.destroy = function () {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.clear();
    };
    /**
     * 获取统计信息
     * @returns 统计信息
     */
    PerformanceTracker.prototype.getStats = function () {
        return {
            active: this.metrics.size,
            completed: this.completedMetrics.length,
            maxCompleted: this.config.maxCompletedMetrics,
        };
    };
    return PerformanceTracker;
}());
export { PerformanceTracker };
/** 全局性能追踪器实例 */
export var performanceTracker = new PerformanceTracker();
