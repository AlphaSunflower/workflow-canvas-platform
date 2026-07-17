import { useCallback, useSyncExternalStore } from 'react';
var renderTierStore = new Map();
var renderTierListeners = new Map();
export function resolveNodeRenderTier(input) {
    if (input.isSelected || input.isRecentlyInteracted || input.isImporting) {
        return 'full';
    }
    if (input.visibilityBucket === 'visible' || input.visibilityBucket === 'near') {
        return 'full';
    }
    if (input.visibilityBucket === 'far') {
        return 'compact';
    }
    return 'minimal';
}
export function shouldNodeRenderTierUpdate(previous, next) {
    return previous !== next;
}
export function resolveNodeRenderTierWithActiveState(scheduledRenderTier, activeState) {
    return activeState === 'active' ? 'full' : scheduledRenderTier;
}
function emitNodeRenderTier(nodeId) {
    var _a;
    (_a = renderTierListeners.get(nodeId)) === null || _a === void 0 ? void 0 : _a.forEach(function (listener) {
        listener();
    });
}
export function syncNodeRenderTierSnapshot(entries) {
    var nextSnapshot = new Map();
    var changedNodeIds = new Set();
    for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
        var _a = entries_1[_i], nodeId = _a[0], renderTier = _a[1];
        nextSnapshot.set(nodeId, renderTier);
    }
    renderTierStore.forEach(function (renderTier, nodeId) {
        var nextRenderTier = nextSnapshot.get(nodeId);
        if (!nextRenderTier) {
            renderTierStore.delete(nodeId);
            changedNodeIds.add(nodeId);
            return;
        }
        if (shouldNodeRenderTierUpdate(renderTier, nextRenderTier)) {
            changedNodeIds.add(nodeId);
        }
    });
    nextSnapshot.forEach(function (renderTier, nodeId) {
        var previous = renderTierStore.get(nodeId);
        if (!shouldNodeRenderTierUpdate(previous, renderTier)) {
            return;
        }
        renderTierStore.set(nodeId, renderTier);
        changedNodeIds.add(nodeId);
    });
    changedNodeIds.forEach(function (nodeId) {
        emitNodeRenderTier(nodeId);
    });
}
export function clearNodeRenderTierSnapshot() {
    if (renderTierStore.size === 0) {
        return;
    }
    var nodeIds = Array.from(renderTierStore.keys());
    renderTierStore.clear();
    nodeIds.forEach(function (nodeId) {
        emitNodeRenderTier(nodeId);
    });
}
export function getNodeRenderTier(nodeId, fallback) {
    var _a;
    if (fallback === void 0) { fallback = 'full'; }
    return (_a = renderTierStore.get(nodeId)) !== null && _a !== void 0 ? _a : fallback;
}
function subscribeNodeRenderTier(nodeId, listener) {
    var _a;
    var listeners = (_a = renderTierListeners.get(nodeId)) !== null && _a !== void 0 ? _a : new Set();
    listeners.add(listener);
    renderTierListeners.set(nodeId, listeners);
    return function () {
        var currentListeners = renderTierListeners.get(nodeId);
        if (!currentListeners) {
            return;
        }
        currentListeners.delete(listener);
        if (currentListeners.size === 0) {
            renderTierListeners.delete(nodeId);
        }
    };
}
export function useNodeRenderTier(nodeId, fallback) {
    if (fallback === void 0) { fallback = 'full'; }
    var subscribe = useCallback(function (listener) { return subscribeNodeRenderTier(nodeId, listener); }, [nodeId]);
    var getSnapshot = useCallback(function () { return getNodeRenderTier(nodeId, fallback); }, [fallback, nodeId]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
