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
function normalizeConcurrency(concurrency) {
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
        return 1;
    }
    return Math.max(1, Math.floor(concurrency));
}
export function runWithConcurrency(items, concurrency, worker) {
    return __awaiter(this, void 0, void 0, function () {
        var limit, results, cursor, claimNextIndex, runWorker;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (items.length === 0) {
                        return [2 /*return*/, []];
                    }
                    limit = Math.min(normalizeConcurrency(concurrency), items.length);
                    results = new Array(items.length);
                    cursor = 0;
                    claimNextIndex = function () {
                        var index = cursor;
                        cursor += 1;
                        return index;
                    };
                    runWorker = function () { return __awaiter(_this, void 0, void 0, function () {
                        var index, _a, _b;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    index = claimNextIndex();
                                    _c.label = 1;
                                case 1:
                                    if (!(index < items.length)) return [3 /*break*/, 4];
                                    _a = results;
                                    _b = index;
                                    return [4 /*yield*/, worker(items[index], index)];
                                case 2:
                                    _a[_b] = _c.sent();
                                    _c.label = 3;
                                case 3:
                                    index = claimNextIndex();
                                    return [3 /*break*/, 1];
                                case 4: return [2 /*return*/];
                            }
                        });
                    }); };
                    return [4 /*yield*/, Promise.all(Array.from({ length: limit }, function () { return runWorker(); }))];
                case 1:
                    _a.sent();
                    return [2 /*return*/, results];
            }
        });
    });
}
export function createAsyncTaskQueue(options) {
    var _this = this;
    var concurrency = normalizeConcurrency(options.concurrency);
    var queue = [];
    var idleResolvers = new Set();
    var activeCount = 0;
    var cancelled = false;
    var resolveIdleIfSettled = function (triggerOnIdle) {
        var _a;
        if (triggerOnIdle === void 0) { triggerOnIdle = true; }
        if (queue.length > 0 || activeCount > 0) {
            return;
        }
        idleResolvers.forEach(function (resolve) { return resolve(); });
        idleResolvers.clear();
        if (triggerOnIdle) {
            (_a = options.onIdle) === null || _a === void 0 ? void 0 : _a.call(options);
        }
    };
    var schedule = function () {
        if (cancelled) {
            resolveIdleIfSettled(false);
            return;
        }
        var _loop_1 = function () {
            var nextItem = queue.shift();
            activeCount += 1;
            void (function () { return __awaiter(_this, void 0, void 0, function () {
                var error_1, _a;
                var _b;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            _c.trys.push([0, 2, 3, 8]);
                            return [4 /*yield*/, options.worker(nextItem)];
                        case 1:
                            _c.sent();
                            return [3 /*break*/, 8];
                        case 2:
                            error_1 = _c.sent();
                            (_b = options.onTaskError) === null || _b === void 0 ? void 0 : _b.call(options, error_1, nextItem);
                            return [3 /*break*/, 8];
                        case 3:
                            activeCount = Math.max(0, activeCount - 1);
                            if (!(!cancelled && options.yieldBeforeNextTask)) return [3 /*break*/, 7];
                            _c.label = 4;
                        case 4:
                            _c.trys.push([4, 6, , 7]);
                            return [4 /*yield*/, options.yieldBeforeNextTask()];
                        case 5:
                            _c.sent();
                            return [3 /*break*/, 7];
                        case 6:
                            _a = _c.sent();
                            return [3 /*break*/, 7];
                        case 7:
                            schedule();
                            return [7 /*endfinally*/];
                        case 8: return [2 /*return*/];
                    }
                });
            }); })();
        };
        while (activeCount < concurrency && queue.length > 0) {
            _loop_1();
        }
        resolveIdleIfSettled();
    };
    return {
        enqueue: function (item) {
            if (cancelled) {
                return;
            }
            queue.push(item);
            schedule();
        },
        whenIdle: function () {
            if (queue.length === 0 && activeCount === 0) {
                return Promise.resolve();
            }
            return new Promise(function (resolve) {
                idleResolvers.add(resolve);
            });
        },
        getStats: function () {
            return {
                queued: queue.length,
                active: activeCount,
                concurrency: concurrency,
            };
        },
        cancel: function () {
            cancelled = true;
            queue.length = 0;
            resolveIdleIfSettled(false);
        },
    };
}
