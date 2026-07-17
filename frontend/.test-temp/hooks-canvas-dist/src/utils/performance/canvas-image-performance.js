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
var _a;
import { createModuleLogger } from '../logger';
var log = createModuleLogger('canvas-image-performance');
function toPublicLifecycleStats(stats) {
    return {
        nodeId: stats.nodeId,
        mode: stats.mode,
        fileName: stats.fileName,
        totalEvents: stats.totalEvents,
        registerCount: stats.registerCount,
        requestStartedCount: stats.requestStartedCount,
        loadSucceededCount: stats.loadSucceededCount,
        releaseCount: stats.releaseCount,
        loadFailedCount: stats.loadFailedCount,
        currentRequestKey: stats.currentRequestKey,
        lastEventKind: stats.lastEventKind,
        lastRequestKey: stats.lastRequestKey,
        lastSwitchReason: stats.lastSwitchReason,
        lastAttemptedUrl: stats.lastAttemptedUrl,
        lastResourcePhase: stats.lastResourcePhase,
        lastRecordedAt: stats.lastRecordedAt,
        requestAfterReleaseCount: stats.requestAfterReleaseCount,
        readyReleaseRequestLoopCount: stats.readyReleaseRequestLoopCount,
    };
}
var MAX_LONG_TASKS = 100;
var MAX_IMPORT_BATCHES = 20;
var MAX_IMPORT_STAGE_EVENTS_PER_BATCH = 600;
var MAX_FILE_NODE_METRICS = 400;
var MAX_FILE_NODE_RENDER_METRICS = 400;
var MAX_LIFECYCLE_EVENTS = 2000;
var MAX_RUNTIME_SYNC_METRICS = 300;
var MAX_DRAG_VISIBILITY_METRICS = 300;
var MAX_MEMORY_SAMPLES = 120;
var MAX_IMAGE_THUMBNAIL_WORKER_QUEUE_EVENTS = 200;
var READY_RELEASE_REQUEST_WINDOW_MS = 10000;
var REMOTE_PROTECTED_IMAGE_BASELINE_COUNT = 55;
var CANVAS_IMAGE_DIAGNOSTICS_STORAGE_KEY = 'canvas.image.performance.enabled';
var CANVAS_IMAGE_VERBOSE_STORAGE_KEY = 'canvas.image.performance.verbose';
var CANVAS_IMAGE_AUTO_REPORT_STORAGE_KEY = 'canvas.image.performance.autoReport';
var CANVAS_IMAGE_QUERY_KEYS = ['canvasImagePerf', 'canvasImageDebug'];
var CANVAS_IMAGE_VERBOSE_QUERY_KEYS = ['canvasImagePerfVerbose', 'canvasImageDebugVerbose'];
var CANVAS_IMAGE_AUTO_REPORT_QUERY_KEYS = ['canvasImagePerfReport', 'canvasImageDebugReport'];
var DRAG_VISIBILITY_DETAIL_SAMPLE_INTERVAL = 12;
var DRAG_VISIBILITY_SLOW_DETAIL_THRESHOLD_MS = 12;
var FILE_NODE_COMMIT_DIAGNOSTIC_THROTTLE_MS = 750;
var SESSION_SNAPSHOT_DIAGNOSTIC_THROTTLE_MS = 1000;
var SUMMARY_REPORT_THROTTLE_MS = 5000;
var fileNodeDiagnosticCommits = new Map();
var lastSessionSnapshotDiagnosticAt = 0;
function isDevelopmentEnvironment() {
    var _a;
    return Boolean((_a = import.meta.env) === null || _a === void 0 ? void 0 : _a.DEV);
}
function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}
var IMAGE_THUMBNAIL_FAILURE_CODES = [
    'worker-unavailable',
    'worker-timeout',
    'worker-crashed',
    'worker-message-failure',
    'bitmap-unsupported',
    'offscreen-unsupported',
    'decode-failed',
    'canvas-context-failed',
    'blob-convert-failed',
    'unknown',
];
var IMAGE_THUMBNAIL_FAILURE_STAGES = [
    'pipeline-gate',
    'queue-wait',
    'worker-execute',
    'result-apply',
];
function isImageThumbnailFailureCodeValue(value) {
    return typeof value === 'string' && IMAGE_THUMBNAIL_FAILURE_CODES.includes(value);
}
function isImageThumbnailFailureStageValue(value) {
    return typeof value === 'string' && IMAGE_THUMBNAIL_FAILURE_STAGES.includes(value);
}
function buildThumbnailFailureAggregate(values) {
    var counts = new Map();
    values.forEach(function (value) {
        var _a;
        counts.set(value, ((_a = counts.get(value)) !== null && _a !== void 0 ? _a : 0) + 1);
    });
    return Array.from(counts.entries())
        .map(function (_a) {
        var key = _a[0], count = _a[1];
        return ({ key: key, count: count });
    })
        .sort(function (left, right) { return right.count - left.count || left.key.localeCompare(right.key); });
}
function parseBooleanFlag(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    switch (value.trim().toLowerCase()) {
        case '1':
        case 'true':
        case 'yes':
        case 'on':
            return true;
        case '0':
        case 'false':
        case 'no':
        case 'off':
            return false;
        default:
            return undefined;
    }
}
function readLocalStorageFlag(key) {
    var _a;
    if (typeof window === 'undefined') {
        return undefined;
    }
    try {
        return parseBooleanFlag((_a = window.localStorage) === null || _a === void 0 ? void 0 : _a.getItem(key));
    }
    catch (_b) {
        return undefined;
    }
}
function writeLocalStorageFlag(key, value) {
    var _a, _b;
    if (typeof window === 'undefined') {
        return;
    }
    try {
        if (typeof value === 'boolean') {
            (_a = window.localStorage) === null || _a === void 0 ? void 0 : _a.setItem(key, value ? '1' : '0');
        }
        else {
            (_b = window.localStorage) === null || _b === void 0 ? void 0 : _b.removeItem(key);
        }
    }
    catch (_c) {
        // Ignore storage failures in private browsing or locked-down environments.
    }
}
function readQueryFlag(keys) {
    var _a, _b;
    if (typeof window === 'undefined') {
        return undefined;
    }
    try {
        var params = new URLSearchParams(window.location.search);
        for (var _i = 0, keys_1 = keys; _i < keys_1.length; _i++) {
            var key = keys_1[_i];
            if (params.has(key)) {
                return (_b = parseBooleanFlag((_a = params.get(key)) !== null && _a !== void 0 ? _a : '1')) !== null && _b !== void 0 ? _b : true;
            }
        }
    }
    catch (_c) {
        return undefined;
    }
    return undefined;
}
function resolveCanvasImageDiagnosticsConfig() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!isDevelopmentEnvironment()) {
        return {
            enabled: false,
            verbose: false,
            autoReport: false,
            dragDetailSampleInterval: DRAG_VISIBILITY_DETAIL_SAMPLE_INTERVAL,
            fileNodeCommitThrottleMs: FILE_NODE_COMMIT_DIAGNOSTIC_THROTTLE_MS,
            sessionSnapshotThrottleMs: SESSION_SNAPSHOT_DIAGNOSTIC_THROTTLE_MS,
            summaryReportThrottleMs: SUMMARY_REPORT_THROTTLE_MS,
        };
    }
    var globalWindow = typeof window === 'undefined' ? undefined : window;
    var enabled = (_c = (_b = (_a = parseBooleanFlag(globalWindow === null || globalWindow === void 0 ? void 0 : globalWindow.__CANVAS_IMAGE_PERF_ENABLED__)) !== null && _a !== void 0 ? _a : readQueryFlag(CANVAS_IMAGE_QUERY_KEYS)) !== null && _b !== void 0 ? _b : readLocalStorageFlag(CANVAS_IMAGE_DIAGNOSTICS_STORAGE_KEY)) !== null && _c !== void 0 ? _c : false;
    var verbose = enabled && Boolean((_f = (_e = (_d = parseBooleanFlag(globalWindow === null || globalWindow === void 0 ? void 0 : globalWindow.__CANVAS_IMAGE_PERF_VERBOSE__)) !== null && _d !== void 0 ? _d : readQueryFlag(CANVAS_IMAGE_VERBOSE_QUERY_KEYS)) !== null && _e !== void 0 ? _e : readLocalStorageFlag(CANVAS_IMAGE_VERBOSE_STORAGE_KEY)) !== null && _f !== void 0 ? _f : false);
    var autoReport = enabled && Boolean((_j = (_h = (_g = parseBooleanFlag(globalWindow === null || globalWindow === void 0 ? void 0 : globalWindow.__CANVAS_IMAGE_PERF_AUTO_REPORT__)) !== null && _g !== void 0 ? _g : readQueryFlag(CANVAS_IMAGE_AUTO_REPORT_QUERY_KEYS)) !== null && _h !== void 0 ? _h : readLocalStorageFlag(CANVAS_IMAGE_AUTO_REPORT_STORAGE_KEY)) !== null && _j !== void 0 ? _j : false);
    return {
        enabled: enabled,
        verbose: verbose,
        autoReport: autoReport,
        dragDetailSampleInterval: verbose ? 1 : DRAG_VISIBILITY_DETAIL_SAMPLE_INTERVAL,
        fileNodeCommitThrottleMs: verbose ? 0 : FILE_NODE_COMMIT_DIAGNOSTIC_THROTTLE_MS,
        sessionSnapshotThrottleMs: verbose ? 0 : SESSION_SNAPSHOT_DIAGNOSTIC_THROTTLE_MS,
        summaryReportThrottleMs: SUMMARY_REPORT_THROTTLE_MS,
    };
}
function normalizeLifecycleEventKind(value) {
    switch (value) {
        case 'register':
        case 'request-queued':
        case 'request-started':
        case 'load-succeeded':
        case 'load-failed':
        case 'release':
        case 'visibility-updated':
        case 'cooldown-released':
        case 'retry-scheduled':
            return value;
        default:
            return undefined;
    }
}
function resolveImageManagerDebugSnapshot(snapshot) {
    var _a;
    if (snapshot) {
        return snapshot;
    }
    if (typeof window === 'undefined') {
        return undefined;
    }
    return (_a = window.__IMAGE_MANAGER_DEBUG__) === null || _a === void 0 ? void 0 : _a.call(window);
}
function buildCacheDebugSummary(snapshot) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25;
    var stats = (_a = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _a === void 0 ? void 0 : _a.stats;
    if (!stats) {
        return undefined;
    }
    return {
        entryCount: (_b = stats.entryCount) !== null && _b !== void 0 ? _b : 0,
        resourceEntryCount: (_c = stats.resourceEntryCount) !== null && _c !== void 0 ? _c : 0,
        objectUrlEntryCount: (_d = stats.objectUrlEntryCount) !== null && _d !== void 0 ? _d : 0,
        canvasResourceEntryCount: (_e = stats.canvasResourceEntryCount) !== null && _e !== void 0 ? _e : 0,
        originalEntryCount: (_f = stats.originalEntryCount) !== null && _f !== void 0 ? _f : 0,
        visibleEntryCount: (_g = stats.visibleEntryCount) !== null && _g !== void 0 ? _g : 0,
        nearViewportEntryCount: (_h = stats.nearViewportEntryCount) !== null && _h !== void 0 ? _h : 0,
        thumbnailEntryCount: (_j = stats.thumbnailEntryCount) !== null && _j !== void 0 ? _j : 0,
        inflightRequestCount: (_l = (_k = snapshot === null || snapshot === void 0 ? void 0 : snapshot.inflightRequests) === null || _k === void 0 ? void 0 : _k.length) !== null && _l !== void 0 ? _l : 0,
        subscriptionCount: (_o = (_m = snapshot === null || snapshot === void 0 ? void 0 : snapshot.subscriptions) === null || _m === void 0 ? void 0 : _m.total) !== null && _o !== void 0 ? _o : 0,
        canvasSubscriptionCount: (_q = (_p = snapshot === null || snapshot === void 0 ? void 0 : snapshot.subscriptions) === null || _p === void 0 ? void 0 : _p.canvas) !== null && _q !== void 0 ? _q : 0,
        originalSubscriptionCount: (_s = (_r = snapshot === null || snapshot === void 0 ? void 0 : snapshot.subscriptions) === null || _r === void 0 ? void 0 : _r.original) !== null && _s !== void 0 ? _s : 0,
        nodesWithSubscribers: (_u = (_t = snapshot === null || snapshot === void 0 ? void 0 : snapshot.subscriptions) === null || _t === void 0 ? void 0 : _t.nodesWithSubscribers) !== null && _u !== void 0 ? _u : 0,
        evictionCount: (_v = stats.evictionCount) !== null && _v !== void 0 ? _v : 0,
        revocationCount: (_w = stats.revocationCount) !== null && _w !== void 0 ? _w : 0,
        decodedReleaseCount: (_x = stats.decodedReleaseCount) !== null && _x !== void 0 ? _x : 0,
        hitCount: stats.hitCount,
        missCount: stats.missCount,
        retryAttemptCount: stats.retryAttemptCount,
        retrySuppressedCount: stats.retrySuppressedCount,
        retryRecoveredCount: stats.retryRecoveredCount,
        thumbnailEntryLimit: (_z = (_y = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _y === void 0 ? void 0 : _y.policy) === null || _z === void 0 ? void 0 : _z.maxThumbnailEntries,
        resourceEntryLimit: (_1 = (_0 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _0 === void 0 ? void 0 : _0.policy) === null || _1 === void 0 ? void 0 : _1.maxResourceEntries,
        originalEntryLimit: (_3 = (_2 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _2 === void 0 ? void 0 : _2.policy) === null || _3 === void 0 ? void 0 : _3.maxOriginalEntries,
        thumbnailBytes: stats.thumbnailBytes,
        canvasBytes: stats.canvasBytes,
        originalBytes: stats.originalBytes,
        totalBytes: stats.totalBytes,
        maxCanvasBytes: (_5 = (_4 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _4 === void 0 ? void 0 : _4.policy) === null || _5 === void 0 ? void 0 : _5.maxCanvasBytes,
        maxOriginalBytes: (_7 = (_6 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _6 === void 0 ? void 0 : _6.policy) === null || _7 === void 0 ? void 0 : _7.maxOriginalBytes,
        maxThumbnailBytes: (_9 = (_8 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _8 === void 0 ? void 0 : _8.policy) === null || _9 === void 0 ? void 0 : _9.maxThumbnailBytes,
        canvasByteUsageRatio: (_11 = (_10 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _10 === void 0 ? void 0 : _10.budget) === null || _11 === void 0 ? void 0 : _11.canvasByteUsageRatio,
        originalByteUsageRatio: (_13 = (_12 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _12 === void 0 ? void 0 : _12.budget) === null || _13 === void 0 ? void 0 : _13.originalByteUsageRatio,
        thumbnailByteUsageRatio: (_15 = (_14 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cache) === null || _14 === void 0 ? void 0 : _14.budget) === null || _15 === void 0 ? void 0 : _15.thumbnailByteUsageRatio,
        budgetScene: (_17 = (_16 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cacheBudget) === null || _16 === void 0 ? void 0 : _16.profile) === null || _17 === void 0 ? void 0 : _17.scene,
        budgetTier: (_19 = (_18 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cacheBudget) === null || _18 === void 0 ? void 0 : _18.profile) === null || _19 === void 0 ? void 0 : _19.tier,
        budgetDensity: (_21 = (_20 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cacheBudget) === null || _20 === void 0 ? void 0 : _20.profile) === null || _21 === void 0 ? void 0 : _21.density,
        budgetImageNodeCount: (_23 = (_22 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cacheBudget) === null || _22 === void 0 ? void 0 : _22.profile) === null || _23 === void 0 ? void 0 : _23.imageNodeCount,
        budgetImportingNodeCount: (_25 = (_24 = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cacheBudget) === null || _24 === void 0 ? void 0 : _24.profile) === null || _25 === void 0 ? void 0 : _25.importingNodeCount,
    };
}
var CanvasImagePerformanceMonitor = /** @class */ (function () {
    function CanvasImagePerformanceMonitor() {
        this.longTasks = [];
        this.importBatches = new Map();
        this.importBatchOrder = [];
        this.importedNodes = new Map();
        this.runtimeSyncs = [];
        this.dragVisibilityCommits = [];
        this.fileNodeCommits = new Map();
        this.fileNodeRenderMetrics = new Map();
        this.lifecycleEvents = [];
        this.lifecycleStats = new Map();
        this.memorySamples = [];
        this.imageThumbnailWorkerQueueEvents = [];
        this.dragVisibilityAggregate = {
            totalComputations: 0,
            totalBatchCommits: 0,
            totalDurationMs: 0,
        };
        this.subscriptionSummaryState = {
            totalSubscriptions: 0,
            peakSubscriptions: 0,
            canvasSubscriptions: 0,
            originalSubscriptions: 0,
            totalSubscribeCalls: 0,
            totalUnsubscribeCalls: 0,
            uniqueSubscribedNodes: new Set(),
            activeNodesWithSubscriptions: 0,
            canvasSubscribeCalls: 0,
            originalSubscribeCalls: 0,
            uploadSnapshotReadCount: 0,
            uploadNodesObserved: new Set(),
        };
        this.observerActive = false;
        this.lifecycleEventSequence = 0;
        this.runtimeSyncSequence = 0;
        this.dragVisibilitySequence = 0;
        this.imageThumbnailWorkerQueueEventSequence = 0;
        this.lastSummaryReportAt = 0;
        this.lastLongTaskCountAtMemorySample = 0;
        this.lastLongTaskDurationAtMemorySample = 0;
        this.ensureLongTaskObserver();
        this.ensureMemorySampler();
    }
    CanvasImagePerformanceMonitor.prototype.startImportBatch = function (batchId, total, startedAt) {
        if (startedAt === void 0) { startedAt = this.now(); }
        this.importBatches.set(batchId, {
            batchId: batchId,
            total: total,
            thumbnailReadyTargetCount: 0,
            completed: 0,
            failed: 0,
            startedAt: startedAt,
            pendingEnhancements: 0,
            enhancedNodes: 0,
            thumbnailReadyNodes: 0,
            stages: [],
            stageSummary: new Map(),
            thumbnailReadyNodeIds: new Set(),
            runtimeSyncCount: 0,
            runtimeSyncTotalMs: 0,
        });
        this.touchImportBatch(batchId);
    };
    CanvasImagePerformanceMonitor.prototype.registerImportNodes = function (batchId, nodes) {
        var _this = this;
        if (!this.importBatches.has(batchId)) {
            return;
        }
        nodes.forEach(function (node) {
            if (node.nodeType === 'image') {
                var batch = _this.importBatches.get(batchId);
                if (batch) {
                    batch.thumbnailReadyTargetCount += 1;
                }
            }
            _this.importedNodes.set(node.nodeId, __assign(__assign({}, node), { batchId: batchId }));
        });
        this.touchImportBatch(batchId);
    };
    CanvasImagePerformanceMonitor.prototype.recordImportStage = function (payload) {
        var _a, _b, _c;
        var batch = this.importBatches.get(payload.batchId);
        if (!batch) {
            return;
        }
        var completedAt = (_a = payload.completedAt) !== null && _a !== void 0 ? _a : this.now();
        var durationMs = Math.max(0, (_b = payload.durationMs) !== null && _b !== void 0 ? _b : completedAt - payload.startedAt);
        var stage = {
            stage: payload.stage,
            startedAt: payload.startedAt,
            completedAt: completedAt,
            durationMs: durationMs,
            status: (_c = payload.status) !== null && _c !== void 0 ? _c : 'completed',
            nodeId: payload.nodeId,
            nodeType: payload.nodeType,
            fileName: payload.fileName,
            itemCount: payload.itemCount,
            detail: payload.detail,
        };
        batch.stages.push(stage);
        if (batch.stages.length > MAX_IMPORT_STAGE_EVENTS_PER_BATCH) {
            batch.stages.splice(0, batch.stages.length - MAX_IMPORT_STAGE_EVENTS_PER_BATCH);
        }
        this.reduceImportStageSummary(batch, stage);
        this.touchImportBatch(payload.batchId);
    };
    CanvasImagePerformanceMonitor.prototype.markImportPlaceholdersReady = function (batchId) {
        var batch = this.importBatches.get(batchId);
        if (!batch || batch.placeholdersReadyAt) {
            return;
        }
        batch.placeholdersReadyAt = this.now();
        batch.responseMs = batch.placeholdersReadyAt - batch.startedAt;
        this.touchImportBatch(batchId);
    };
    CanvasImagePerformanceMonitor.prototype.markImportEnhancementStarted = function (batchId) {
        var batch = this.importBatches.get(batchId);
        if (!batch) {
            return;
        }
        batch.pendingEnhancements += 1;
        if (!batch.enhancementStartedAt) {
            batch.enhancementStartedAt = this.now();
        }
        this.touchImportBatch(batchId);
    };
    CanvasImagePerformanceMonitor.prototype.markImportEnhancementSettled = function (batchId) {
        var batch = this.importBatches.get(batchId);
        if (!batch) {
            return;
        }
        batch.pendingEnhancements = Math.max(0, batch.pendingEnhancements - 1);
        batch.enhancedNodes += 1;
        if (batch.pendingEnhancements === 0) {
            batch.enhancementSettledAt = this.now();
            if (batch.enhancementStartedAt) {
                batch.enhancementMs = batch.enhancementSettledAt - batch.enhancementStartedAt;
            }
        }
        this.touchImportBatch(batchId);
    };
    CanvasImagePerformanceMonitor.prototype.completeImportBatch = function (batchId, completed, failed) {
        var batch = this.importBatches.get(batchId);
        if (!batch) {
            return;
        }
        batch.completed = completed;
        batch.failed = failed;
        batch.batchCompletedAt = this.now();
        batch.totalMs = batch.batchCompletedAt - batch.startedAt;
        this.touchImportBatch(batchId);
    };
    CanvasImagePerformanceMonitor.prototype.recordRuntimeSync = function (payload) {
        var _a, _b, _c, _d;
        var recordedAt = (_a = payload.recordedAt) !== null && _a !== void 0 ? _a : this.now();
        var sync = {
            syncId: this.runtimeSyncSequence + 1,
            batchId: payload.batchId,
            reason: (_b = payload.reason) !== null && _b !== void 0 ? _b : 'canvas-sync',
            nodeCount: payload.nodeCount,
            connectionCount: payload.connectionCount,
            durationMs: Math.max(0, payload.durationMs),
            snapshotBuildMs: payload.snapshotBuildMs,
            metadataNormalizeMs: payload.metadataNormalizeMs,
            actionCommitMs: payload.actionCommitMs,
            recordedAt: recordedAt,
        };
        this.runtimeSyncSequence = sync.syncId;
        this.runtimeSyncs.push(sync);
        if (this.runtimeSyncs.length > MAX_RUNTIME_SYNC_METRICS) {
            this.runtimeSyncs.splice(0, this.runtimeSyncs.length - MAX_RUNTIME_SYNC_METRICS);
        }
        if (payload.batchId) {
            var batch = this.importBatches.get(payload.batchId);
            if (batch) {
                batch.runtimeSyncCount += 1;
                batch.runtimeSyncTotalMs += sync.durationMs;
                batch.runtimeSyncMaxMs = Math.max((_c = batch.runtimeSyncMaxMs) !== null && _c !== void 0 ? _c : 0, sync.durationMs);
                batch.firstRuntimeSyncAt = (_d = batch.firstRuntimeSyncAt) !== null && _d !== void 0 ? _d : recordedAt;
                batch.lastRuntimeSyncAt = recordedAt;
                this.touchImportBatch(payload.batchId);
            }
        }
    };
    CanvasImagePerformanceMonitor.prototype.recordDragVisibility = function (payload) {
        var _a, _b;
        var recordedAt = (_a = payload.recordedAt) !== null && _a !== void 0 ? _a : this.now();
        var metric = {
            commitId: this.dragVisibilitySequence + 1,
            reason: (_b = payload.reason) !== null && _b !== void 0 ? _b : 'frame',
            nodeCount: payload.nodeCount,
            visibleNodeCount: payload.visibleNodeCount,
            nearViewportNodeCount: payload.nearViewportNodeCount,
            durationMs: Math.max(0, payload.durationMs),
            computeMs: Math.max(0, payload.computeMs),
            applyMs: Math.max(0, payload.applyMs),
            recordedAt: recordedAt,
        };
        this.dragVisibilitySequence = metric.commitId;
        this.reduceDragVisibilityAggregate(metric);
        var config = this.getDiagnosticsConfig();
        if (this.shouldStoreDragVisibilityDetail(metric, config)) {
            this.dragVisibilityCommits.push(metric);
            if (this.dragVisibilityCommits.length > MAX_DRAG_VISIBILITY_METRICS) {
                this.dragVisibilityCommits.splice(0, this.dragVisibilityCommits.length - MAX_DRAG_VISIBILITY_METRICS);
            }
        }
        this.maybeReportSummary(config, metric.recordedAt);
    };
    CanvasImagePerformanceMonitor.prototype.recordCanvasSession = function (payload) {
        this.sessionSnapshot = __assign(__assign({}, payload), { recordedAt: this.now() });
    };
    CanvasImagePerformanceMonitor.prototype.recordFileNodeCommit = function (payload) {
        var _a;
        var committedAt = this.now();
        var current = this.fileNodeCommits.get(payload.nodeId);
        var next = {
            nodeId: payload.nodeId,
            nodeType: payload.nodeType,
            fileName: payload.fileName,
            commits: ((_a = current === null || current === void 0 ? void 0 : current.commits) !== null && _a !== void 0 ? _a : 0) + 1,
            selected: payload.selected,
            dragging: payload.dragging,
            status: payload.status,
            placeholder: payload.placeholder,
            activeVariantKind: payload.activeVariantKind,
            viewerStatus: payload.viewerStatus,
            resourceStatus: payload.resourceStatus,
            resourcePhase: payload.resourcePhase,
            requestKey: payload.requestKey,
            requestEventKind: payload.requestEventKind,
            requestEventClassification: payload.requestEventClassification,
            requestEventReason: payload.requestEventReason,
            requestSwitchReason: payload.requestSwitchReason,
            attemptedUrl: payload.attemptedUrl,
            src: payload.src,
            isVisible: payload.isVisible,
            isNearViewport: payload.isNearViewport,
            displayWidth: payload.displayWidth,
            displayHeight: payload.displayHeight,
            lastCommittedAt: committedAt,
        };
        this.fileNodeCommits.set(payload.nodeId, next);
        this.recordImportPreviewReadyFromCommit(next, committedAt);
        this.recordLifecycleEventFromCommit(next, committedAt);
        this.pruneFileNodeMetrics();
    };
    CanvasImagePerformanceMonitor.prototype.recordPreviewLifecycle = function (payload) {
        var _a, _b, _c, _d;
        if (!((_a = import.meta.env) === null || _a === void 0 ? void 0 : _a.DEV)) {
            return;
        }
        var recordedAt = this.now();
        var event = {
            eventId: this.lifecycleEventSequence + 1,
            nodeId: payload.nodeId,
            mode: 'canvas',
            fileName: (_c = (_b = payload.fileName) !== null && _b !== void 0 ? _b : payload.fileId) !== null && _c !== void 0 ? _c : payload.nodeId,
            eventKind: payload.eventKind,
            eventReason: (_d = payload.error) !== null && _d !== void 0 ? _d : payload.sessionId,
            requestKey: payload.sessionId,
            attemptedUrl: payload.fileId,
            placeholder: payload.placeholder,
            detail: payload.detail ? __assign({}, payload.detail) : undefined,
            recordedAt: recordedAt,
        };
        this.lifecycleEventSequence = event.eventId;
        this.lifecycleEvents.push(event);
        if (this.lifecycleEvents.length > MAX_LIFECYCLE_EVENTS) {
            this.lifecycleEvents.splice(0, this.lifecycleEvents.length - MAX_LIFECYCLE_EVENTS);
        }
    };
    CanvasImagePerformanceMonitor.prototype.recordImageThumbnailWorkerQueueEvent = function (payload) {
        var _a, _b;
        if (!((_a = import.meta.env) === null || _a === void 0 ? void 0 : _a.DEV)) {
            return;
        }
        var event = {
            eventId: this.imageThumbnailWorkerQueueEventSequence + 1,
            eventKind: payload.eventKind,
            taskId: payload.taskId,
            activeTaskId: payload.activeTaskId,
            queuedTaskCount: Math.max(0, payload.queuedTaskCount),
            activeTaskCount: payload.activeTaskCount,
            totalTaskCount: Math.max(0, payload.totalTaskCount),
            restartCount: Math.max(0, payload.restartCount),
            timeoutCount: Math.max(0, payload.timeoutCount),
            errorCount: Math.max(0, payload.errorCount),
            detail: payload.detail,
            recordedAt: (_b = payload.recordedAt) !== null && _b !== void 0 ? _b : this.now(),
        };
        this.imageThumbnailWorkerQueueEventSequence = event.eventId;
        this.imageThumbnailWorkerQueueEvents.push(event);
        if (this.imageThumbnailWorkerQueueEvents.length > MAX_IMAGE_THUMBNAIL_WORKER_QUEUE_EVENTS) {
            this.imageThumbnailWorkerQueueEvents.splice(0, this.imageThumbnailWorkerQueueEvents.length - MAX_IMAGE_THUMBNAIL_WORKER_QUEUE_EVENTS);
        }
    };
    CanvasImagePerformanceMonitor.prototype.recordFileNodeRender = function (payload) {
        var _a;
        var recordedAt = (_a = payload.recordedAt) !== null && _a !== void 0 ? _a : this.now();
        var current = this.fileNodeRenderMetrics.get(payload.nodeId);
        var next = current
            ? __assign({}, current) : {
            nodeId: payload.nodeId,
            fileName: payload.fileName,
            nodeType: payload.nodeType,
            renderCount: 0,
            commitCount: 0,
            dragCommitCount: 0,
            totalCommitMs: 0,
            averageCommitMs: 0,
            maxCommitMs: 0,
            firstRecordedAt: recordedAt,
            lastRecordedAt: recordedAt,
        };
        next.fileName = payload.fileName;
        next.nodeType = payload.nodeType;
        next.renderCount += 1;
        next.commitCount += 1;
        next.totalCommitMs += Math.max(0, payload.commitDurationMs);
        next.averageCommitMs = next.totalCommitMs / Math.max(1, next.commitCount);
        next.maxCommitMs = Math.max(next.maxCommitMs, payload.commitDurationMs);
        next.lastRecordedAt = recordedAt;
        if (payload.dragging) {
            next.dragCommitCount += 1;
        }
        next.commitsPerSecond = this.calculateFrequencyPerSecond(next.commitCount, next.firstRecordedAt, next.lastRecordedAt);
        this.fileNodeRenderMetrics.set(payload.nodeId, next);
        this.pruneFileNodeRenderMetrics();
    };
    CanvasImagePerformanceMonitor.prototype.recordImageResourceSubscription = function (payload) {
        var summary = this.subscriptionSummaryState;
        var delta = payload.phase === 'subscribe' ? 1 : -1;
        summary.totalSubscriptions = Math.max(0, summary.totalSubscriptions + delta);
        summary.peakSubscriptions = Math.max(summary.peakSubscriptions, summary.totalSubscriptions);
        if (payload.mode === 'canvas') {
            summary.canvasSubscriptions = Math.max(0, summary.canvasSubscriptions + delta);
            if (payload.phase === 'subscribe') {
                summary.canvasSubscribeCalls += 1;
            }
        }
        else {
            summary.originalSubscriptions = Math.max(0, summary.originalSubscriptions + delta);
            if (payload.phase === 'subscribe') {
                summary.originalSubscribeCalls += 1;
            }
        }
        if (payload.phase === 'subscribe') {
            summary.totalSubscribeCalls += 1;
            summary.uniqueSubscribedNodes.add(payload.nodeId);
        }
        else {
            summary.totalUnsubscribeCalls += 1;
        }
        summary.activeNodesWithSubscriptions = Math.max(0, payload.activeNodesWithSubscriptions);
    };
    CanvasImagePerformanceMonitor.prototype.recordUploadSnapshotRead = function (nodeId) {
        var summary = this.subscriptionSummaryState;
        summary.uploadSnapshotReadCount += 1;
        summary.uploadNodesObserved.add(nodeId);
    };
    CanvasImagePerformanceMonitor.prototype.getSnapshot = function () {
        var _this = this;
        var recordedAt = this.now();
        var imageThumbnailWorkerQueueEvents = this.imageThumbnailWorkerQueueEvents
            .slice()
            .sort(function (left, right) { return right.eventId - left.eventId; })
            .map(function (event) { return (__assign({}, event)); });
        return {
            observerActive: this.observerActive,
            recordedAt: recordedAt,
            diagnostics: this.getDiagnosticsConfig(),
            longTasks: __spreadArray([], this.longTasks, true),
            longTaskSummary: this.buildLongTaskSummary(this.longTasks),
            importBatches: this.importBatchOrder
                .map(function (batchId) { return _this.importBatches.get(batchId); })
                .filter(function (batch) { return Boolean(batch); })
                .map(function (batch) { return _this.buildImportBatchSnapshot(batch, recordedAt); }),
            runtimeSyncs: this.runtimeSyncs
                .slice()
                .sort(function (left, right) { return right.syncId - left.syncId; })
                .map(function (sync) { return (__assign({}, sync)); }),
            runtimeSyncSummary: this.buildRuntimeSyncSummary(),
            dragVisibilityCommits: this.dragVisibilityCommits
                .slice()
                .sort(function (left, right) { return right.commitId - left.commitId; })
                .map(function (metric) { return (__assign({}, metric)); }),
            dragVisibilitySummary: this.buildDragVisibilitySummary(),
            fileNodeCommits: Array.from(this.fileNodeCommits.values())
                .sort(function (left, right) { return right.lastCommittedAt - left.lastCommittedAt; })
                .map(function (metric) { return (__assign({}, metric)); }),
            fileNodeRenderSummary: this.getFileNodeRenderSummary(),
            subscriptionSummary: this.getSubscriptionSummary(),
            memorySamples: this.memorySamples.slice().sort(function (left, right) { return right.sampledAt - left.sampledAt; }),
            memorySummary: this.buildMemorySummary(),
            canvasSession: this.sessionSnapshot ? __assign({}, this.sessionSnapshot) : undefined,
            lifecycleEvents: this.getLifecycleEvents(),
            nodeLifecycleStats: this.getNodeLifecycleStats(),
            suspectedLoops: this.getSuspectedLoops(),
            imageThumbnailWorkerQueueEvents: imageThumbnailWorkerQueueEvents,
            imageThumbnailWorkerQueueSummary: this.buildImageThumbnailWorkerQueueSummary(imageThumbnailWorkerQueueEvents),
        };
    };
    CanvasImagePerformanceMonitor.prototype.getSummary = function (imageManagerSnapshot) {
        var resolvedImageManagerSnapshot = resolveImageManagerDebugSnapshot(imageManagerSnapshot);
        var snapshot = this.getSnapshot();
        var latestDragVisibilityCommit = snapshot.dragVisibilityCommits[0];
        return {
            recordedAt: snapshot.recordedAt,
            diagnostics: snapshot.diagnostics,
            longTaskSummary: snapshot.longTaskSummary,
            runtimeSyncSummary: snapshot.runtimeSyncSummary,
            dragVisibilitySummary: snapshot.dragVisibilitySummary,
            latestDragVisibilityCommit: latestDragVisibilityCommit,
            fileNodeRenderSummary: snapshot.fileNodeRenderSummary,
            subscriptionSummary: snapshot.subscriptionSummary,
            memorySummary: snapshot.memorySummary,
            canvasSession: snapshot.canvasSession,
            cache: buildCacheDebugSummary(resolvedImageManagerSnapshot),
            imageThumbnailWorkerQueue: snapshot.imageThumbnailWorkerQueueSummary,
            thumbnailFailureSummary: this.buildThumbnailFailureSummary(snapshot),
        };
    };
    CanvasImagePerformanceMonitor.prototype.getFlickerDebugSnapshot = function (imageManagerSnapshot) {
        var resolvedImageManagerSnapshot = resolveImageManagerDebugSnapshot(imageManagerSnapshot);
        var performanceSnapshot = this.getSnapshot();
        var cache = buildCacheDebugSummary(resolvedImageManagerSnapshot);
        return {
            recordedAt: this.now(),
            baseline: {
                name: '55 remote protected image workflow',
                expectedRemoteProtectedImageCount: REMOTE_PROTECTED_IMAGE_BASELINE_COUNT,
                maxThumbnailEntriesAtReportTime: cache === null || cache === void 0 ? void 0 : cache.thumbnailEntryLimit,
            },
            session: this.sessionSnapshot ? __assign({}, this.sessionSnapshot) : undefined,
            cache: cache,
            lifecycleEvents: performanceSnapshot.lifecycleEvents,
            nodeLifecycleStats: performanceSnapshot.nodeLifecycleStats,
            suspectedLoops: performanceSnapshot.suspectedLoops,
            performance: performanceSnapshot,
        };
    };
    CanvasImagePerformanceMonitor.prototype.reset = function () {
        this.longTasks.length = 0;
        this.importBatches.clear();
        this.importBatchOrder.length = 0;
        this.importedNodes.clear();
        this.runtimeSyncs.length = 0;
        this.dragVisibilityCommits.length = 0;
        this.fileNodeCommits.clear();
        this.fileNodeRenderMetrics.clear();
        this.lifecycleEvents.length = 0;
        this.lifecycleStats.clear();
        this.memorySamples.length = 0;
        this.imageThumbnailWorkerQueueEvents.length = 0;
        this.dragVisibilityAggregate = {
            totalComputations: 0,
            totalBatchCommits: 0,
            totalDurationMs: 0,
        };
        this.subscriptionSummaryState.totalSubscriptions = 0;
        this.subscriptionSummaryState.peakSubscriptions = 0;
        this.subscriptionSummaryState.canvasSubscriptions = 0;
        this.subscriptionSummaryState.originalSubscriptions = 0;
        this.subscriptionSummaryState.totalSubscribeCalls = 0;
        this.subscriptionSummaryState.totalUnsubscribeCalls = 0;
        this.subscriptionSummaryState.uniqueSubscribedNodes.clear();
        this.subscriptionSummaryState.activeNodesWithSubscriptions = 0;
        this.subscriptionSummaryState.canvasSubscribeCalls = 0;
        this.subscriptionSummaryState.originalSubscribeCalls = 0;
        this.subscriptionSummaryState.uploadSnapshotReadCount = 0;
        this.subscriptionSummaryState.uploadNodesObserved.clear();
        this.sessionSnapshot = undefined;
        this.lifecycleEventSequence = 0;
        this.runtimeSyncSequence = 0;
        this.dragVisibilitySequence = 0;
        this.imageThumbnailWorkerQueueEventSequence = 0;
        this.lastSummaryReportAt = 0;
        this.lastLongTaskCountAtMemorySample = 0;
        this.lastLongTaskDurationAtMemorySample = 0;
        fileNodeDiagnosticCommits.clear();
        lastSessionSnapshotDiagnosticAt = 0;
    };
    CanvasImagePerformanceMonitor.prototype.reduceImportStageSummary = function (batch, stage) {
        var current = batch.stageSummary.get(stage.stage);
        if (!current) {
            batch.stageSummary.set(stage.stage, {
                stage: stage.stage,
                count: 1,
                failed: stage.status === 'failed' ? 1 : 0,
                totalMs: stage.durationMs,
                maxMs: stage.durationMs,
                minMs: stage.durationMs,
                averageMs: stage.durationMs,
                firstStartedAt: stage.startedAt,
                lastCompletedAt: stage.completedAt,
            });
            return;
        }
        current.count += 1;
        current.failed += stage.status === 'failed' ? 1 : 0;
        current.totalMs += stage.durationMs;
        current.maxMs = Math.max(current.maxMs, stage.durationMs);
        current.minMs = Math.min(current.minMs, stage.durationMs);
        current.averageMs = current.totalMs / current.count;
        current.firstStartedAt = Math.min(current.firstStartedAt, stage.startedAt);
        current.lastCompletedAt = Math.max(current.lastCompletedAt, stage.completedAt);
    };
    CanvasImagePerformanceMonitor.prototype.recordImportPreviewReadyFromCommit = function (commit, committedAt) {
        var _a;
        var importedNode = this.importedNodes.get(commit.nodeId);
        if (!importedNode || importedNode.nodeType !== 'image') {
            return;
        }
        var batch = this.importBatches.get(importedNode.batchId);
        if (!batch || batch.thumbnailReadyNodeIds.has(commit.nodeId)) {
            return;
        }
        var isPreviewReady = commit.requestEventKind === 'load-succeeded'
            || commit.placeholder === 'ready'
            || commit.resourceStatus === 'ready'
            || commit.viewerStatus === 'ready';
        if (!isPreviewReady) {
            return;
        }
        batch.thumbnailReadyNodeIds.add(commit.nodeId);
        batch.thumbnailReadyNodes = batch.thumbnailReadyNodeIds.size;
        batch.firstCanvasThumbnailReadyAt = (_a = batch.firstCanvasThumbnailReadyAt) !== null && _a !== void 0 ? _a : committedAt;
        batch.firstCanvasThumbnailReadyMs = batch.firstCanvasThumbnailReadyAt - batch.startedAt;
        if (batch.thumbnailReadyTargetCount > 0 && batch.thumbnailReadyNodes >= batch.thumbnailReadyTargetCount) {
            batch.allCanvasThumbnailReadyAt = committedAt;
            batch.allCanvasThumbnailReadyMs = committedAt - batch.startedAt;
        }
        this.recordImportStage({
            batchId: importedNode.batchId,
            stage: 'canvas-thumbnail-ready',
            startedAt: batch.startedAt,
            completedAt: committedAt,
            durationMs: committedAt - batch.startedAt,
            nodeId: commit.nodeId,
            nodeType: importedNode.nodeType,
            fileName: importedNode.fileName,
            detail: {
                requestEventKind: commit.requestEventKind,
                resourceStatus: commit.resourceStatus,
                placeholder: commit.placeholder,
            },
        });
    };
    CanvasImagePerformanceMonitor.prototype.buildImportBatchSnapshot = function (batch, recordedAt) {
        var longTaskSummary = this.buildLongTaskSummary(this.getLongTasksForBatch(batch, recordedAt));
        var runtimeSyncWritesPerSecond = this.calculateFrequencyPerSecond(batch.runtimeSyncCount, batch.firstRuntimeSyncAt, batch.lastRuntimeSyncAt);
        return {
            batchId: batch.batchId,
            total: batch.total,
            thumbnailReadyTargetCount: batch.thumbnailReadyTargetCount,
            completed: batch.completed,
            failed: batch.failed,
            startedAt: batch.startedAt,
            placeholdersReadyAt: batch.placeholdersReadyAt,
            batchCompletedAt: batch.batchCompletedAt,
            enhancementStartedAt: batch.enhancementStartedAt,
            enhancementSettledAt: batch.enhancementSettledAt,
            responseMs: batch.responseMs,
            totalMs: batch.totalMs,
            enhancementMs: batch.enhancementMs,
            pendingEnhancements: batch.pendingEnhancements,
            enhancedNodes: batch.enhancedNodes,
            thumbnailReadyNodes: batch.thumbnailReadyNodes,
            firstCanvasThumbnailReadyAt: batch.firstCanvasThumbnailReadyAt,
            allCanvasThumbnailReadyAt: batch.allCanvasThumbnailReadyAt,
            firstCanvasThumbnailReadyMs: batch.firstCanvasThumbnailReadyMs,
            allCanvasThumbnailReadyMs: batch.allCanvasThumbnailReadyMs,
            stages: batch.stages.map(function (stage) { return (__assign(__assign({}, stage), { detail: stage.detail ? __assign({}, stage.detail) : undefined })); }),
            stageSummary: Array.from(batch.stageSummary.values())
                .sort(function (left, right) { return left.firstStartedAt - right.firstStartedAt; })
                .map(function (summary) { return (__assign({}, summary)); }),
            longTaskCount: longTaskSummary.count,
            longTaskTotalMs: longTaskSummary.totalDurationMs,
            maxLongTaskMs: longTaskSummary.maxDurationMs,
            runtimeSyncCount: batch.runtimeSyncCount,
            runtimeSyncWritesPerSecond: runtimeSyncWritesPerSecond,
            runtimeSyncTotalMs: batch.runtimeSyncTotalMs,
            runtimeSyncMaxMs: batch.runtimeSyncMaxMs,
            lastRuntimeSyncAt: batch.lastRuntimeSyncAt,
        };
    };
    CanvasImagePerformanceMonitor.prototype.getLongTasksForBatch = function (batch, recordedAt) {
        var _a, _b, _c;
        var batchEnd = (_c = (_b = (_a = batch.allCanvasThumbnailReadyAt) !== null && _a !== void 0 ? _a : batch.enhancementSettledAt) !== null && _b !== void 0 ? _b : batch.batchCompletedAt) !== null && _c !== void 0 ? _c : recordedAt;
        return this.longTasks.filter(function (task) {
            var taskEnd = task.startTime + task.duration;
            return task.startTime <= batchEnd && taskEnd >= batch.startedAt;
        });
    };
    CanvasImagePerformanceMonitor.prototype.buildLongTaskSummary = function (longTasks) {
        if (longTasks.length === 0) {
            return {
                count: 0,
                totalDurationMs: 0,
            };
        }
        var durations = longTasks.map(function (task) { return task.duration; });
        return {
            count: longTasks.length,
            totalDurationMs: durations.reduce(function (sum, duration) { return sum + duration; }, 0),
            maxDurationMs: Math.max.apply(Math, durations),
        };
    };
    CanvasImagePerformanceMonitor.prototype.buildRuntimeSyncSummary = function () {
        if (this.runtimeSyncs.length === 0) {
            return {
                totalWrites: 0,
                totalDurationMs: 0,
            };
        }
        var sorted = this.runtimeSyncs.slice().sort(function (left, right) { return left.recordedAt - right.recordedAt; });
        var first = sorted[0];
        var last = sorted[sorted.length - 1];
        var totalDurationMs = sorted.reduce(function (sum, sync) { return sum + sync.durationMs; }, 0);
        return {
            totalWrites: sorted.length,
            totalDurationMs: totalDurationMs,
            maxDurationMs: Math.max.apply(Math, sorted.map(function (sync) { return sync.durationMs; })),
            averageDurationMs: totalDurationMs / sorted.length,
            writesPerSecond: this.calculateFrequencyPerSecond(sorted.length, first.recordedAt, last.recordedAt),
            firstRecordedAt: first.recordedAt,
            lastRecordedAt: last.recordedAt,
            lastBatchId: last.batchId,
            lastNodeCount: last.nodeCount,
            lastConnectionCount: last.connectionCount,
        };
    };
    CanvasImagePerformanceMonitor.prototype.buildDragVisibilitySummary = function () {
        if (this.dragVisibilityAggregate.totalComputations === 0) {
            return {
                totalComputations: 0,
                totalBatchCommits: 0,
                totalDurationMs: 0,
            };
        }
        var aggregate = this.dragVisibilityAggregate;
        return {
            totalComputations: aggregate.totalComputations,
            totalBatchCommits: aggregate.totalBatchCommits,
            totalDurationMs: aggregate.totalDurationMs,
            maxDurationMs: aggregate.maxDurationMs,
            averageDurationMs: aggregate.totalDurationMs / aggregate.totalComputations,
            computationsPerSecond: this.calculateFrequencyPerSecond(aggregate.totalComputations, aggregate.firstRecordedAt, aggregate.lastRecordedAt),
            batchCommitsPerSecond: this.calculateFrequencyPerSecond(aggregate.totalBatchCommits, aggregate.firstRecordedAt, aggregate.lastRecordedAt),
            firstRecordedAt: aggregate.firstRecordedAt,
            lastRecordedAt: aggregate.lastRecordedAt,
            maxNodeCount: aggregate.maxNodeCount,
        };
    };
    CanvasImagePerformanceMonitor.prototype.getFileNodeRenderSummary = function () {
        return Array.from(this.fileNodeRenderMetrics.values())
            .sort(function (left, right) { return right.lastRecordedAt - left.lastRecordedAt; })
            .map(function (metric) { return (__assign({}, metric)); });
    };
    CanvasImagePerformanceMonitor.prototype.getSubscriptionSummary = function () {
        var summary = this.subscriptionSummaryState;
        return {
            totalSubscriptions: summary.totalSubscriptions,
            peakSubscriptions: summary.peakSubscriptions,
            canvasSubscriptions: summary.canvasSubscriptions,
            originalSubscriptions: summary.originalSubscriptions,
            totalSubscribeCalls: summary.totalSubscribeCalls,
            totalUnsubscribeCalls: summary.totalUnsubscribeCalls,
            uniqueSubscribedNodes: summary.uniqueSubscribedNodes.size,
            activeNodesWithSubscriptions: summary.activeNodesWithSubscriptions,
            canvasSubscribeCalls: summary.canvasSubscribeCalls,
            originalSubscribeCalls: summary.originalSubscribeCalls,
            uploadSnapshotReadCount: summary.uploadSnapshotReadCount,
            uploadNodesObserved: summary.uploadNodesObserved.size,
        };
    };
    CanvasImagePerformanceMonitor.prototype.buildMemorySummary = function () {
        if (this.memorySamples.length === 0) {
            return {
                sampleCount: 0,
            };
        }
        var usedHeapSamples = this.memorySamples
            .map(function (sample) { return sample.usedJSHeapSize; })
            .filter(function (value) { return typeof value === 'number'; });
        var latestSample = this.memorySamples[this.memorySamples.length - 1];
        return {
            sampleCount: this.memorySamples.length,
            latestSample: latestSample ? __assign({}, latestSample) : undefined,
            maxUsedJSHeapSize: usedHeapSamples.length > 0 ? Math.max.apply(Math, usedHeapSamples) : undefined,
            averageUsedJSHeapSize: usedHeapSamples.length > 0
                ? usedHeapSamples.reduce(function (sum, value) { return sum + value; }, 0) / usedHeapSamples.length
                : undefined,
            maxLongTaskCountSinceLastSample: Math.max.apply(Math, this.memorySamples.map(function (sample) { return sample.longTaskCountSinceLastSample; })),
            maxLongTaskDurationSinceLastSample: Math.max.apply(Math, this.memorySamples.map(function (sample) { return sample.longTaskDurationSinceLastSample; })),
        };
    };
    CanvasImagePerformanceMonitor.prototype.buildImageThumbnailWorkerQueueSummary = function (events) {
        var _a, _b, _c, _d, _e, _f, _g;
        var latest = events[0];
        return {
            eventCount: events.length,
            lastEventKind: latest === null || latest === void 0 ? void 0 : latest.eventKind,
            activeTaskId: (_a = latest === null || latest === void 0 ? void 0 : latest.activeTaskId) !== null && _a !== void 0 ? _a : null,
            queuedTaskCount: (_b = latest === null || latest === void 0 ? void 0 : latest.queuedTaskCount) !== null && _b !== void 0 ? _b : 0,
            activeTaskCount: (_c = latest === null || latest === void 0 ? void 0 : latest.activeTaskCount) !== null && _c !== void 0 ? _c : 0,
            totalTaskCount: (_d = latest === null || latest === void 0 ? void 0 : latest.totalTaskCount) !== null && _d !== void 0 ? _d : 0,
            restartCount: (_e = latest === null || latest === void 0 ? void 0 : latest.restartCount) !== null && _e !== void 0 ? _e : 0,
            timeoutCount: (_f = latest === null || latest === void 0 ? void 0 : latest.timeoutCount) !== null && _f !== void 0 ? _f : 0,
            errorCount: (_g = latest === null || latest === void 0 ? void 0 : latest.errorCount) !== null && _g !== void 0 ? _g : 0,
            lastRecordedAt: latest === null || latest === void 0 ? void 0 : latest.recordedAt,
        };
    };
    CanvasImagePerformanceMonitor.prototype.buildThumbnailFailureSummary = function (snapshot) {
        var failures = [];
        snapshot.lifecycleEvents.forEach(function (event) {
            if (event.eventKind !== 'preview-failed' || !event.detail) {
                return;
            }
            var failureCode = event.detail.failureCode;
            var failureStage = event.detail.failureStage;
            var retryable = event.detail.retryable;
            if (!isImageThumbnailFailureCodeValue(failureCode) ||
                !isImageThumbnailFailureStageValue(failureStage) ||
                typeof retryable !== 'boolean') {
                return;
            }
            failures.push({
                failureCode: failureCode,
                failureStage: failureStage,
                retryable: retryable,
                message: typeof event.detail.message === 'string' ? event.detail.message : undefined,
                durationMs: typeof event.detail.durationMs === 'number' ? event.detail.durationMs : undefined,
                queueWaitMs: typeof event.detail.queueWaitMs === 'number' ? event.detail.queueWaitMs : undefined,
                executeMs: typeof event.detail.executeMs === 'number' ? event.detail.executeMs : undefined,
                timeoutMs: typeof event.detail.timeoutMs === 'number' ? event.detail.timeoutMs : undefined,
            });
        });
        snapshot.imageThumbnailWorkerQueueEvents.forEach(function (event) {
            if (!event.detail) {
                return;
            }
            var failureCode = event.detail.errorCode;
            var failureStage = event.detail.failureStage;
            var retryable = event.detail.retryable;
            if (!isImageThumbnailFailureCodeValue(failureCode) ||
                !isImageThumbnailFailureStageValue(failureStage) ||
                typeof retryable !== 'boolean') {
                return;
            }
            failures.push({
                failureCode: failureCode,
                failureStage: failureStage,
                retryable: retryable,
                message: typeof event.detail.errorMessage === 'string'
                    ? event.detail.errorMessage
                    : (typeof event.detail.message === 'string' ? event.detail.message : undefined),
                durationMs: typeof event.detail.durationMs === 'number' ? event.detail.durationMs : undefined,
                queueWaitMs: typeof event.detail.queueWaitMs === 'number' ? event.detail.queueWaitMs : undefined,
                executeMs: typeof event.detail.executeMs === 'number' ? event.detail.executeMs : undefined,
                timeoutMs: typeof event.detail.timeoutMs === 'number' ? event.detail.timeoutMs : undefined,
            });
        });
        return {
            totalFailures: failures.length,
            byFailureCode: buildThumbnailFailureAggregate(failures.map(function (failure) { return failure.failureCode; })),
            byFailureStage: buildThumbnailFailureAggregate(failures.map(function (failure) { return failure.failureStage; })),
            byRetryable: buildThumbnailFailureAggregate(failures.map(function (failure) { return String(failure.retryable); })),
        };
    };
    CanvasImagePerformanceMonitor.prototype.reduceDragVisibilityAggregate = function (metric) {
        var _a, _b, _c;
        var aggregate = this.dragVisibilityAggregate;
        aggregate.totalComputations += 1;
        aggregate.totalBatchCommits += 1;
        aggregate.totalDurationMs += metric.durationMs;
        aggregate.maxDurationMs = Math.max((_a = aggregate.maxDurationMs) !== null && _a !== void 0 ? _a : 0, metric.durationMs);
        aggregate.firstRecordedAt = (_b = aggregate.firstRecordedAt) !== null && _b !== void 0 ? _b : metric.recordedAt;
        aggregate.lastRecordedAt = metric.recordedAt;
        aggregate.maxNodeCount = Math.max((_c = aggregate.maxNodeCount) !== null && _c !== void 0 ? _c : 0, metric.nodeCount);
    };
    CanvasImagePerformanceMonitor.prototype.shouldStoreDragVisibilityDetail = function (metric, config) {
        if (metric.reason === 'flush') {
            return true;
        }
        if (metric.durationMs >= DRAG_VISIBILITY_SLOW_DETAIL_THRESHOLD_MS) {
            return true;
        }
        if (!config.enabled) {
            return false;
        }
        return metric.commitId % Math.max(1, config.dragDetailSampleInterval) === 0;
    };
    CanvasImagePerformanceMonitor.prototype.maybeReportSummary = function (config, recordedAt) {
        if (!config.autoReport) {
            return;
        }
        if (recordedAt - this.lastSummaryReportAt < config.summaryReportThrottleMs) {
            return;
        }
        this.lastSummaryReportAt = recordedAt;
        log.info('auto-report-summary', 'Canvas image performance summary', {
            summary: this.getSummary(),
        });
    };
    CanvasImagePerformanceMonitor.prototype.getDiagnosticsConfig = function () {
        return resolveCanvasImageDiagnosticsConfig();
    };
    CanvasImagePerformanceMonitor.prototype.calculateFrequencyPerSecond = function (count, startedAt, completedAt) {
        if (count <= 1 || typeof startedAt !== 'number' || typeof completedAt !== 'number') {
            return undefined;
        }
        var elapsedSeconds = Math.max((completedAt - startedAt) / 1000, 0.001);
        return count / elapsedSeconds;
    };
    CanvasImagePerformanceMonitor.prototype.sampleMemoryUsage = function () {
        var _a;
        if (typeof window === 'undefined' || !((_a = import.meta.env) === null || _a === void 0 ? void 0 : _a.DEV)) {
            return;
        }
        var memory = performance.memory;
        var totalLongTaskDuration = this.longTasks.reduce(function (sum, task) { return sum + task.duration; }, 0);
        var sample = {
            sampledAt: this.now(),
            usedJSHeapSize: memory === null || memory === void 0 ? void 0 : memory.usedJSHeapSize,
            totalJSHeapSize: memory === null || memory === void 0 ? void 0 : memory.totalJSHeapSize,
            jsHeapSizeLimit: memory === null || memory === void 0 ? void 0 : memory.jsHeapSizeLimit,
            longTaskCountSinceLastSample: Math.max(0, this.longTasks.length - this.lastLongTaskCountAtMemorySample),
            longTaskDurationSinceLastSample: Math.max(0, totalLongTaskDuration - this.lastLongTaskDurationAtMemorySample),
        };
        this.lastLongTaskCountAtMemorySample = this.longTasks.length;
        this.lastLongTaskDurationAtMemorySample = totalLongTaskDuration;
        this.memorySamples.push(sample);
        if (this.memorySamples.length > MAX_MEMORY_SAMPLES) {
            this.memorySamples.splice(0, this.memorySamples.length - MAX_MEMORY_SAMPLES);
        }
    };
    CanvasImagePerformanceMonitor.prototype.ensureMemorySampler = function () {
        var _this = this;
        var _a;
        if (typeof window === 'undefined' || !((_a = import.meta.env) === null || _a === void 0 ? void 0 : _a.DEV)) {
            return;
        }
        if (this.memorySampleTimer) {
            return;
        }
        var tick = function () {
            _this.sampleMemoryUsage();
            _this.memorySampleTimer = window.setTimeout(tick, 2000);
        };
        tick();
    };
    CanvasImagePerformanceMonitor.prototype.recordLifecycleEventFromCommit = function (commit, committedAt) {
        var _a, _b, _c, _d, _e, _f, _g;
        if (commit.nodeType !== 'image') {
            return;
        }
        var eventKind = normalizeLifecycleEventKind(commit.requestEventKind);
        if (!eventKind) {
            return;
        }
        var mode = 'canvas';
        var statsKey = "".concat(commit.nodeId, ":").concat(mode);
        var previous = this.lifecycleStats.get(statsKey);
        var eventSignature = [
            eventKind,
            (_a = commit.requestEventClassification) !== null && _a !== void 0 ? _a : '',
            (_b = commit.requestKey) !== null && _b !== void 0 ? _b : '',
            (_c = commit.attemptedUrl) !== null && _c !== void 0 ? _c : '',
            (_d = commit.src) !== null && _d !== void 0 ? _d : '',
            (_e = commit.requestSwitchReason) !== null && _e !== void 0 ? _e : '',
            (_f = commit.resourceStatus) !== null && _f !== void 0 ? _f : '',
            (_g = commit.resourcePhase) !== null && _g !== void 0 ? _g : '',
        ].join('|');
        if ((previous === null || previous === void 0 ? void 0 : previous.eventSignature) === eventSignature) {
            this.lifecycleStats.set(statsKey, __assign(__assign({}, previous), { fileName: commit.fileName, currentRequestKey: commit.requestKey, lastResourcePhase: commit.resourcePhase, lastRecordedAt: committedAt }));
            return;
        }
        var event = {
            eventId: this.lifecycleEventSequence + 1,
            nodeId: commit.nodeId,
            mode: mode,
            fileName: commit.fileName,
            eventKind: eventKind,
            classification: commit.requestEventClassification,
            requestKey: commit.requestKey,
            switchReason: commit.requestSwitchReason,
            eventReason: commit.requestEventReason,
            attemptedUrl: commit.attemptedUrl,
            src: commit.src,
            resourceStatus: commit.resourceStatus,
            resourcePhase: commit.resourcePhase,
            activeVariantKind: commit.activeVariantKind,
            placeholder: commit.placeholder,
            isVisible: commit.isVisible,
            isNearViewport: commit.isNearViewport,
            recordedAt: committedAt,
        };
        this.lifecycleEventSequence = event.eventId;
        this.lifecycleEvents.push(event);
        if (this.lifecycleEvents.length > MAX_LIFECYCLE_EVENTS) {
            this.lifecycleEvents.splice(0, this.lifecycleEvents.length - MAX_LIFECYCLE_EVENTS);
        }
        this.lifecycleStats.set(statsKey, this.reduceLifecycleStats(previous, event, eventSignature));
    };
    CanvasImagePerformanceMonitor.prototype.reduceLifecycleStats = function (previous, event, eventSignature) {
        var _a;
        var next = previous
            ? __assign({}, previous) : {
            nodeId: event.nodeId,
            mode: event.mode,
            fileName: event.fileName,
            totalEvents: 0,
            registerCount: 0,
            requestStartedCount: 0,
            loadSucceededCount: 0,
            releaseCount: 0,
            loadFailedCount: 0,
            lastRecordedAt: event.recordedAt,
            requestAfterReleaseCount: 0,
            readyReleaseRequestLoopCount: 0,
        };
        next.fileName = (_a = event.fileName) !== null && _a !== void 0 ? _a : next.fileName;
        next.totalEvents += 1;
        next.currentRequestKey = event.requestKey;
        next.lastEventKind = event.eventKind;
        next.lastRequestKey = event.requestKey;
        next.lastSwitchReason = event.switchReason;
        next.lastAttemptedUrl = event.attemptedUrl;
        next.lastResourcePhase = event.resourcePhase;
        next.lastRecordedAt = event.recordedAt;
        next.eventSignature = eventSignature;
        if (event.eventKind === 'register') {
            next.registerCount += 1;
        }
        if (event.eventKind === 'request-started') {
            next.requestStartedCount += 1;
            if (next.lastReleaseAt && event.recordedAt - next.lastReleaseAt <= READY_RELEASE_REQUEST_WINDOW_MS) {
                next.requestAfterReleaseCount += 1;
                if (next.lastReadyAt && next.lastReleaseAt >= next.lastReadyAt) {
                    next.readyReleaseRequestLoopCount += 1;
                }
            }
        }
        if (event.eventKind === 'load-succeeded') {
            next.loadSucceededCount += 1;
            next.lastReadyAt = event.recordedAt;
        }
        if (event.eventKind === 'release') {
            next.releaseCount += 1;
            next.lastReleaseAt = event.recordedAt;
        }
        if (event.eventKind === 'load-failed') {
            next.loadFailedCount += 1;
        }
        return next;
    };
    CanvasImagePerformanceMonitor.prototype.getLifecycleEvents = function () {
        return this.lifecycleEvents
            .slice()
            .sort(function (left, right) { return right.eventId - left.eventId; })
            .map(function (event) { return (__assign({}, event)); });
    };
    CanvasImagePerformanceMonitor.prototype.getNodeLifecycleStats = function () {
        return Array.from(this.lifecycleStats.values())
            .sort(function (left, right) { return right.lastRecordedAt - left.lastRecordedAt; })
            .map(function (stats) { return toPublicLifecycleStats(stats); });
    };
    CanvasImagePerformanceMonitor.prototype.getSuspectedLoops = function () {
        return Array.from(this.lifecycleStats.values())
            .filter(function (stats) { return stats.readyReleaseRequestLoopCount > 0 || stats.requestAfterReleaseCount > 1; })
            .sort(function (left, right) {
            var loopDelta = right.readyReleaseRequestLoopCount - left.readyReleaseRequestLoopCount;
            if (loopDelta !== 0) {
                return loopDelta;
            }
            return right.requestAfterReleaseCount - left.requestAfterReleaseCount;
        })
            .map(function (stats) { return ({
            nodeId: stats.nodeId,
            mode: stats.mode,
            fileName: stats.fileName,
            loopCount: stats.readyReleaseRequestLoopCount,
            requestAfterReleaseCount: stats.requestAfterReleaseCount,
            releaseCount: stats.releaseCount,
            requestStartedCount: stats.requestStartedCount,
            lastRequestKey: stats.lastRequestKey,
            lastSwitchReason: stats.lastSwitchReason,
            lastAttemptedUrl: stats.lastAttemptedUrl,
            lastResourcePhase: stats.lastResourcePhase,
            lastRecordedAt: stats.lastRecordedAt,
        }); });
    };
    CanvasImagePerformanceMonitor.prototype.ensureLongTaskObserver = function () {
        var _this = this;
        var _a, _b;
        if (typeof window === 'undefined' || !((_a = import.meta.env) === null || _a === void 0 ? void 0 : _a.DEV)) {
            return;
        }
        if (typeof PerformanceObserver === 'undefined') {
            return;
        }
        var supportedEntryTypes = (_b = PerformanceObserver.supportedEntryTypes) !== null && _b !== void 0 ? _b : [];
        if (!supportedEntryTypes.includes('longtask')) {
            return;
        }
        if (this.observer) {
            return;
        }
        this.observer = new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (entry) {
                _this.longTasks.push({
                    name: entry.name,
                    startTime: entry.startTime,
                    duration: entry.duration,
                });
            });
            if (_this.longTasks.length > MAX_LONG_TASKS) {
                _this.longTasks.splice(0, _this.longTasks.length - MAX_LONG_TASKS);
            }
        });
        this.observer.observe({
            type: 'longtask',
            buffered: true,
        });
        this.observerActive = true;
    };
    CanvasImagePerformanceMonitor.prototype.pruneFileNodeMetrics = function () {
        var _this = this;
        if (this.fileNodeCommits.size <= MAX_FILE_NODE_METRICS) {
            return;
        }
        var overflow = this.fileNodeCommits.size - MAX_FILE_NODE_METRICS;
        var staleNodes = Array.from(this.fileNodeCommits.values())
            .sort(function (left, right) { return left.lastCommittedAt - right.lastCommittedAt; })
            .slice(0, overflow);
        staleNodes.forEach(function (metric) {
            _this.fileNodeCommits.delete(metric.nodeId);
        });
    };
    CanvasImagePerformanceMonitor.prototype.pruneFileNodeRenderMetrics = function () {
        var _this = this;
        if (this.fileNodeRenderMetrics.size <= MAX_FILE_NODE_RENDER_METRICS) {
            return;
        }
        var overflow = this.fileNodeRenderMetrics.size - MAX_FILE_NODE_RENDER_METRICS;
        var staleNodes = Array.from(this.fileNodeRenderMetrics.values())
            .sort(function (left, right) { return left.lastRecordedAt - right.lastRecordedAt; })
            .slice(0, overflow);
        staleNodes.forEach(function (metric) {
            _this.fileNodeRenderMetrics.delete(metric.nodeId);
        });
    };
    CanvasImagePerformanceMonitor.prototype.touchImportBatch = function (batchId) {
        var index = this.importBatchOrder.indexOf(batchId);
        if (index >= 0) {
            this.importBatchOrder.splice(index, 1);
        }
        this.importBatchOrder.push(batchId);
        if (this.importBatchOrder.length > MAX_IMPORT_BATCHES) {
            var removedBatchId = this.importBatchOrder.shift();
            if (removedBatchId) {
                this.importBatches.delete(removedBatchId);
                this.clearImportedNodesForBatch(removedBatchId);
            }
        }
    };
    CanvasImagePerformanceMonitor.prototype.clearImportedNodesForBatch = function (batchId) {
        var _this = this;
        this.importedNodes.forEach(function (node, nodeId) {
            if (node.batchId === batchId) {
                _this.importedNodes.delete(nodeId);
            }
        });
    };
    CanvasImagePerformanceMonitor.prototype.now = function () {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    };
    return CanvasImagePerformanceMonitor;
}());
export var canvasImagePerformanceMonitor = new CanvasImagePerformanceMonitor();
export function startCanvasImportBatch(batchId, total, startedAt) {
    canvasImagePerformanceMonitor.startImportBatch(batchId, total, startedAt);
}
export function registerCanvasImportNodes(payload) {
    canvasImagePerformanceMonitor.registerImportNodes(payload.batchId, payload.nodes.map(function (node) { return ({
        batchId: payload.batchId,
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        fileName: node.fileName,
    }); }));
}
export function recordCanvasImportStage(payload) {
    canvasImagePerformanceMonitor.recordImportStage(payload);
}
export function markCanvasImportPlaceholdersReady(batchId) {
    canvasImagePerformanceMonitor.markImportPlaceholdersReady(batchId);
}
export function markCanvasImportEnhancementStarted(batchId) {
    canvasImagePerformanceMonitor.markImportEnhancementStarted(batchId);
}
export function markCanvasImportEnhancementSettled(batchId) {
    canvasImagePerformanceMonitor.markImportEnhancementSettled(batchId);
}
export function completeCanvasImportBatch(batchId, completed, failed) {
    canvasImagePerformanceMonitor.completeImportBatch(batchId, completed, failed);
}
export function recordCanvasRuntimeSync(payload) {
    canvasImagePerformanceMonitor.recordRuntimeSync(payload);
}
export function recordCanvasDragVisibility(payload) {
    canvasImagePerformanceMonitor.recordDragVisibility(payload);
}
export function recordCanvasImageSessionSnapshot(payload) {
    canvasImagePerformanceMonitor.recordCanvasSession(payload);
}
export function shouldRecordCanvasImageSessionDiagnostics(force) {
    if (force === void 0) { force = false; }
    var config = resolveCanvasImageDiagnosticsConfig();
    if (!config.enabled) {
        return false;
    }
    if (force || config.sessionSnapshotThrottleMs <= 0) {
        lastSessionSnapshotDiagnosticAt = nowMs();
        return true;
    }
    var now = nowMs();
    if (now - lastSessionSnapshotDiagnosticAt < config.sessionSnapshotThrottleMs) {
        return false;
    }
    lastSessionSnapshotDiagnosticAt = now;
    return true;
}
export function shouldRecordCanvasFileNodeDiagnostics(payload) {
    var config = resolveCanvasImageDiagnosticsConfig();
    if (!config.enabled) {
        return false;
    }
    var now = nowMs();
    var current = fileNodeDiagnosticCommits.get(payload.nodeId);
    var signatureChanged = (current === null || current === void 0 ? void 0 : current.signature) !== payload.signature;
    var throttleElapsed = !current || now - current.recordedAt >= config.fileNodeCommitThrottleMs;
    if (!payload.force && !signatureChanged && !throttleElapsed) {
        return false;
    }
    fileNodeDiagnosticCommits.set(payload.nodeId, {
        signature: payload.signature,
        recordedAt: now,
    });
    return true;
}
export function recordCanvasFileNodeCommit(payload) {
    canvasImagePerformanceMonitor.recordFileNodeCommit(payload);
}
export function recordCanvasImagePreviewLifecycle(payload) {
    canvasImagePerformanceMonitor.recordPreviewLifecycle(payload);
}
export function shouldRecordCanvasImageThumbnailWorkerQueueDiagnostics() {
    return resolveCanvasImageDiagnosticsConfig().enabled;
}
export function recordCanvasImageThumbnailWorkerQueueEvent(payload) {
    canvasImagePerformanceMonitor.recordImageThumbnailWorkerQueueEvent(payload);
}
export function recordCanvasFileNodeRender(payload) {
    canvasImagePerformanceMonitor.recordFileNodeRender(payload);
}
export function recordCanvasImageResourceSubscription(payload) {
    canvasImagePerformanceMonitor.recordImageResourceSubscription(payload);
}
export function recordCanvasUploadSnapshotRead(nodeId) {
    canvasImagePerformanceMonitor.recordUploadSnapshotRead(nodeId);
}
export function getCanvasImagePerformanceSnapshot() {
    return canvasImagePerformanceMonitor.getSnapshot();
}
export function getCanvasImagePerformanceSummary(imageManagerSnapshot) {
    return canvasImagePerformanceMonitor.getSummary(imageManagerSnapshot);
}
export function getCanvasImageFlickerDebugSnapshot(imageManagerSnapshot) {
    return canvasImagePerformanceMonitor.getFlickerDebugSnapshot(imageManagerSnapshot);
}
export function resetCanvasImagePerformanceSnapshot() {
    canvasImagePerformanceMonitor.reset();
}
export function getCanvasImageDiagnosticsConfig() {
    return resolveCanvasImageDiagnosticsConfig();
}
export function setCanvasImageDiagnosticsConfig(options) {
    if (typeof options.enabled === 'boolean') {
        writeLocalStorageFlag(CANVAS_IMAGE_DIAGNOSTICS_STORAGE_KEY, options.enabled);
        if (typeof window !== 'undefined') {
            window.__CANVAS_IMAGE_PERF_ENABLED__ = options.enabled;
        }
    }
    if (typeof options.verbose === 'boolean') {
        writeLocalStorageFlag(CANVAS_IMAGE_VERBOSE_STORAGE_KEY, options.verbose);
        if (typeof window !== 'undefined') {
            window.__CANVAS_IMAGE_PERF_VERBOSE__ = options.verbose;
        }
    }
    if (typeof options.autoReport === 'boolean') {
        writeLocalStorageFlag(CANVAS_IMAGE_AUTO_REPORT_STORAGE_KEY, options.autoReport);
        if (typeof window !== 'undefined') {
            window.__CANVAS_IMAGE_PERF_AUTO_REPORT__ = options.autoReport;
        }
    }
    return resolveCanvasImageDiagnosticsConfig();
}
export function reportCanvasImagePerformanceSummary(imageManagerSnapshot) {
    var summary = canvasImagePerformanceMonitor.getSummary(imageManagerSnapshot);
    log.info('report-summary', 'Canvas image performance summary', {
        summary: summary,
    });
    return summary;
}
if (typeof window !== 'undefined' && ((_a = import.meta.env) === null || _a === void 0 ? void 0 : _a.DEV)) {
    window.__CANVAS_IMAGE_PERF__ = canvasImagePerformanceMonitor;
    window.__CANVAS_IMAGE_PERF_DEBUG__ = function () { return canvasImagePerformanceMonitor.getSnapshot(); };
    window.__CANVAS_IMAGE_PERF_SUMMARY__ = function () { return canvasImagePerformanceMonitor.getSummary(); };
    window.__CANVAS_IMAGE_PERF_REPORT__ = function () { return reportCanvasImagePerformanceSummary(); };
    window.__CANVAS_IMAGE_FLICKER_DEBUG__ = function () { return canvasImagePerformanceMonitor.getFlickerDebugSnapshot(); };
    window.__CANVAS_IMAGE_PERF_RESET__ = function () { return canvasImagePerformanceMonitor.reset(); };
    window.__CANVAS_IMAGE_PERF_CONFIG__ = getCanvasImageDiagnosticsConfig;
    window.__CANVAS_IMAGE_PERF_ENABLE__ = function (options) {
        if (options === void 0) { options = {}; }
        return setCanvasImageDiagnosticsConfig(__assign({ enabled: true }, options));
    };
    window.__CANVAS_IMAGE_PERF_DISABLE__ = function () { return setCanvasImageDiagnosticsConfig({
        enabled: false,
        verbose: false,
        autoReport: false,
    }); };
}
