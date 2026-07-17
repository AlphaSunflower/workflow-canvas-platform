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
function createAbortError() {
    if (typeof DOMException !== 'undefined') {
        return new DOMException('The operation was aborted.', 'AbortError');
    }
    var error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}
export function isAbortLikeError(error) {
    return error instanceof DOMException && error.name === 'AbortError'
        || (error instanceof Error && error.name === 'AbortError');
}
export function isTimeoutLikeError(error) {
    var _a;
    if (!error) {
        return false;
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
        return true;
    }
    var code = typeof error === 'object' && 'code' in error
        ? String((_a = error.code) !== null && _a !== void 0 ? _a : '')
        : '';
    var message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return code === 'TIMEOUT_ERROR'
        || code === 'TASK_QUERY_FAILED'
        || message.includes('timeout')
        || message.includes('timed out')
        || message.includes('network')
        || message.includes('fetch failed')
        || message.includes('failed to fetch');
}
export function classifyRetryableError(error) {
    if (isAbortLikeError(error)) {
        return 'abort';
    }
    if (isTimeoutLikeError(error)) {
        return 'timeout';
    }
    var retryable = typeof error === 'object' && error !== null && 'retryable' in error
        ? error.retryable
        : undefined;
    if (retryable === true) {
        return 'recoverable';
    }
    return 'fatal';
}
export function normalizeRetryPolicy(policy) {
    var maxAttempts = Number.isFinite(policy.maxAttempts)
        ? Math.max(1, Math.floor(policy.maxAttempts))
        : 1;
    var delaysMs = policy.delaysMs
        .slice(0, Math.max(0, maxAttempts - 1))
        .map(function (delayMs) { return (Number.isFinite(delayMs) ? Math.max(0, Math.floor(delayMs)) : 0); });
    return {
        maxAttempts: maxAttempts,
        delaysMs: delaysMs,
        attemptTimeoutMs: typeof policy.attemptTimeoutMs === 'number' && Number.isFinite(policy.attemptTimeoutMs)
            ? Math.max(1, Math.floor(policy.attemptTimeoutMs))
            : undefined,
    };
}
export function createRetryDecision(params) {
    var _a;
    var policy = normalizeRetryPolicy(params.policy);
    var exhausted = params.attemptNo >= policy.maxAttempts;
    var retry = (!exhausted
        && params.failureKind !== 'abort'
        && params.failureKind !== 'fatal');
    return {
        retry: retry,
        failureKind: params.failureKind,
        attemptNo: params.attemptNo,
        nextAttemptNo: retry ? params.attemptNo + 1 : null,
        delayMs: retry ? (_a = policy.delaysMs[params.attemptNo - 1]) !== null && _a !== void 0 ? _a : 0 : null,
        exhausted: exhausted,
    };
}
export function sleepWithAbort(delayMs, signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        return Promise.reject(createAbortError());
    }
    return new Promise(function (resolve, reject) {
        var handleAbort = function () {
            clearTimeout(timeoutId);
            signal === null || signal === void 0 ? void 0 : signal.removeEventListener('abort', handleAbort);
            reject(createAbortError());
        };
        var timeoutId = setTimeout(function () {
            signal === null || signal === void 0 ? void 0 : signal.removeEventListener('abort', handleAbort);
            resolve();
        }, delayMs);
        signal === null || signal === void 0 ? void 0 : signal.addEventListener('abort', handleAbort, { once: true });
    });
}
export function withTimeout(operation, timeoutMs, parentSignal) {
    return __awaiter(this, void 0, void 0, function () {
        var controller, timeoutId, handleAbort;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (parentSignal === null || parentSignal === void 0 ? void 0 : parentSignal.aborted) {
                        throw createAbortError();
                    }
                    controller = new AbortController();
                    timeoutId = setTimeout(function () {
                        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
                    }, timeoutMs);
                    handleAbort = function () {
                        controller.abort(createAbortError());
                    };
                    parentSignal === null || parentSignal === void 0 ? void 0 : parentSignal.addEventListener('abort', handleAbort, { once: true });
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 3, 4]);
                    return [4 /*yield*/, operation(controller.signal)];
                case 2: return [2 /*return*/, _a.sent()];
                case 3:
                    clearTimeout(timeoutId);
                    parentSignal === null || parentSignal === void 0 ? void 0 : parentSignal.removeEventListener('abort', handleAbort);
                    return [7 /*endfinally*/];
                case 4: return [2 /*return*/];
            }
        });
    });
}
export function runWithRetry(options) {
    return __awaiter(this, void 0, void 0, function () {
        var policy, classifyError, wait, _loop_1, attemptNo, state_1;
        var _a, _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    policy = normalizeRetryPolicy(options.policy);
                    classifyError = (_a = options.classifyError) !== null && _a !== void 0 ? _a : classifyRetryableError;
                    wait = (_b = options.wait) !== null && _b !== void 0 ? _b : sleepWithAbort;
                    _loop_1 = function (attemptNo) {
                        var _g, _h, error_1, decision, _j;
                        return __generator(this, function (_k) {
                            switch (_k.label) {
                                case 0:
                                    _k.trys.push([0, 4, , 9]);
                                    if (!policy.attemptTimeoutMs) return [3 /*break*/, 2];
                                    _g = {};
                                    return [4 /*yield*/, withTimeout(function (attemptSignal) { return options.run({
                                            attemptNo: attemptNo,
                                            maxAttempts: policy.maxAttempts,
                                            signal: attemptSignal,
                                        }); }, policy.attemptTimeoutMs, options.signal)];
                                case 1: return [2 /*return*/, (_g.value = _k.sent(), _g)];
                                case 2:
                                    _h = {};
                                    return [4 /*yield*/, options.run({
                                            attemptNo: attemptNo,
                                            maxAttempts: policy.maxAttempts,
                                            signal: options.signal,
                                        })];
                                case 3: return [2 /*return*/, (_h.value = _k.sent(), _h)];
                                case 4:
                                    error_1 = _k.sent();
                                    decision = createRetryDecision({
                                        policy: policy,
                                        attemptNo: attemptNo,
                                        failureKind: classifyError(error_1),
                                    });
                                    return [4 /*yield*/, ((_c = options.onFailure) === null || _c === void 0 ? void 0 : _c.call(options, { error: error_1, decision: decision }))];
                                case 5:
                                    _k.sent();
                                    _j = !decision.retry;
                                    if (_j) return [3 /*break*/, 7];
                                    return [4 /*yield*/, ((_d = options.shouldStopAfterFailure) === null || _d === void 0 ? void 0 : _d.call(options, { error: error_1, decision: decision }))];
                                case 6:
                                    _j = (_k.sent());
                                    _k.label = 7;
                                case 7:
                                    if (_j) {
                                        throw error_1;
                                    }
                                    return [4 /*yield*/, wait((_e = decision.delayMs) !== null && _e !== void 0 ? _e : 0, options.signal)];
                                case 8:
                                    _k.sent();
                                    return [3 /*break*/, 9];
                                case 9: return [2 /*return*/];
                            }
                        });
                    };
                    attemptNo = 1;
                    _f.label = 1;
                case 1:
                    if (!(attemptNo <= policy.maxAttempts)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1(attemptNo)];
                case 2:
                    state_1 = _f.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    _f.label = 3;
                case 3:
                    attemptNo += 1;
                    return [3 /*break*/, 1];
                case 4: throw new Error('Retry policy exhausted without a terminal result.');
            }
        });
    });
}
