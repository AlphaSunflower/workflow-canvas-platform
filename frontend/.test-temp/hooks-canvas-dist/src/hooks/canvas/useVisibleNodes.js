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
import { useEffect, useMemo, useState } from 'react';
import { rectsIntersect } from '@/utils';
import { deriveVisibilityBucketState, resolveDisplayBucket, shouldEmitVisibilityDiff, } from './visibility-buckets';
import { resolveNodeRenderTier } from './node-render-tier';
import { resolveCanvasNodeVisibilityRect } from './node-visibility-rect';
export function serializeVisibleNodesInput(_a) {
    var nodes = _a.nodes, candidateNodeIds = _a.candidateNodeIds, forcedOffscreenNodeIds = _a.forcedOffscreenNodeIds, viewport = _a.viewport, containerSize = _a.containerSize, _b = _a.overscan, overscan = _b === void 0 ? 240 : _b, recentlyInteractedNodeIds = _a.recentlyInteractedNodeIds, importingNodeIds = _a.importingNodeIds;
    var candidateSet = candidateNodeIds ? new Set(candidateNodeIds) : null;
    var filteredNodes = candidateSet
        ? nodes.filter(function (node) { return candidateSet.has(node.id); })
        : nodes;
    return {
        nodes: filteredNodes.map(function (node) {
            var rect = resolveCanvasNodeVisibilityRect(node);
            return {
                id: node.id,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                selected: Boolean(node.selected),
            };
        }),
        forcedOffscreenNodeIds: Array.from(forcedOffscreenNodeIds !== null && forcedOffscreenNodeIds !== void 0 ? forcedOffscreenNodeIds : []),
        viewport: viewport,
        containerSize: containerSize,
        overscan: overscan,
        recentlyInteractedNodeIds: Array.from(recentlyInteractedNodeIds !== null && recentlyInteractedNodeIds !== void 0 ? recentlyInteractedNodeIds : []),
        importingNodeIds: Array.from(importingNodeIds !== null && importingNodeIds !== void 0 ? importingNodeIds : []),
    };
}
export function materializeVisibleNodeMap(results) {
    return new Map(results.map(function (entry) { return [entry.nodeId, entry.visibility]; }));
}
function areVisibleNodeStatesEqual(left, right) {
    return !shouldEmitVisibilityDiff(toVisibilityBucketState(left), toVisibilityBucketState(right)) &&
        left.isSelected === right.isSelected &&
        left.isRecentlyInteracted === right.isRecentlyInteracted &&
        left.isImporting === right.isImporting &&
        left.renderTier === right.renderTier;
}
export function areVisibleNodeMapsEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (left.size !== right.size) {
        return false;
    }
    for (var _i = 0, _a = left.entries(); _i < _a.length; _i++) {
        var _b = _a[_i], nodeId = _b[0], leftState = _b[1];
        var rightState = right.get(nodeId);
        if (!rightState || !areVisibleNodeStatesEqual(leftState, rightState)) {
            return false;
        }
    }
    return true;
}
function areViewportsEqual(left, right) {
    return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}
function areContainerSizesEqual(left, right) {
    return left.width === right.width && left.height === right.height;
}
export function hasUsableVisibleNodeContainerSize(containerSize) {
    return containerSize.width > 0 && containerSize.height > 0;
}
export function isVisibleNodeSnapshotFresh(snapshot, current) {
    if (!snapshot) {
        return false;
    }
    if (!hasUsableVisibleNodeContainerSize(snapshot.containerSize) ||
        !hasUsableVisibleNodeContainerSize(current.containerSize)) {
        return false;
    }
    return (snapshot.nodesVersion === current.nodesVersion &&
        areViewportsEqual(snapshot.viewport, current.viewport) &&
        areContainerSizesEqual(snapshot.containerSize, current.containerSize));
}
export function areVisibleNodeSnapshotsEqual(left, right) {
    return left.nodesVersion === right.nodesVersion &&
        areViewportsEqual(left.viewport, right.viewport) &&
        areContainerSizesEqual(left.containerSize, right.containerSize) &&
        areVisibleNodeMapsEqual(left.visibleNodes, right.visibleNodes);
}
function buildViewportRect(viewport, width, height, extraMargin) {
    if (extraMargin === void 0) { extraMargin = 0; }
    var zoom = viewport.zoom || 1;
    return {
        x: -viewport.x / zoom - extraMargin,
        y: -viewport.y / zoom - extraMargin,
        width: width / zoom + extraMargin * 2,
        height: height / zoom + extraMargin * 2,
    };
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function computeIntersectionArea(left, right) {
    var overlapWidth = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
    var overlapHeight = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
    if (overlapWidth <= 0 || overlapHeight <= 0) {
        return 0;
    }
    return overlapWidth * overlapHeight;
}
function createIdSet(ids) {
    return new Set(Array.from(ids !== null && ids !== void 0 ? ids : []));
}
function applyForcedOffscreenVisibility(_a) {
    var baseVisibility = _a.baseVisibility, nodes = _a.nodes, forcedOffscreenNodeIds = _a.forcedOffscreenNodeIds, viewport = _a.viewport, recentlyInteractedNodeIds = _a.recentlyInteractedNodeIds, importingNodeIds = _a.importingNodeIds;
    var forcedOffscreenSet = createIdSet(forcedOffscreenNodeIds);
    if (forcedOffscreenSet.size === 0) {
        return baseVisibility;
    }
    var interactedSet = createIdSet(recentlyInteractedNodeIds);
    var importingSet = createIdSet(importingNodeIds);
    var nextVisibility = baseVisibility;
    var hasPatchedVisibility = false;
    forcedOffscreenSet.forEach(function (nodeId) {
        var current = nextVisibility.get(nodeId);
        if (current) {
            if (!importingSet.has(nodeId) || current.renderTier === 'full') {
                return;
            }
            if (!hasPatchedVisibility) {
                nextVisibility = new Map(nextVisibility);
                hasPatchedVisibility = true;
            }
            nextVisibility.set(nodeId, __assign(__assign({}, current), { isImporting: true, renderTier: 'full' }));
            return;
        }
        var fallback = nodes.find(function (node) { return node.id === nodeId; });
        if (!fallback) {
            return;
        }
        if (!hasPatchedVisibility) {
            nextVisibility = new Map(nextVisibility);
            hasPatchedVisibility = true;
        }
        var fallbackRect = resolveCanvasNodeVisibilityRect(fallback);
        nextVisibility.set(nodeId, {
            isVisible: false,
            isNearViewport: true,
            displayWidth: Math.round(fallbackRect.width * (viewport.zoom || 1)),
            displayHeight: Math.round(fallbackRect.height * (viewport.zoom || 1)),
            visibilityBucket: 'near',
            visibilityScoreBucket: 'ready',
            visibilityAreaBucket: 'none',
            visibleAreaRatio: 0,
            viewportZoom: viewport.zoom || 1,
            visibilityScore: 0,
            centerDistance: Number.POSITIVE_INFINITY,
            isSelected: Boolean(fallback.selected),
            isRecentlyInteracted: interactedSet.has(nodeId),
            isImporting: importingSet.has(nodeId),
            renderTier: 'full',
        });
    });
    return nextVisibility;
}
export function resolveVisibleNodesForCurrentState(_a) {
    var nodes = _a.nodes, _b = _a.nodesVersion, nodesVersion = _b === void 0 ? 0 : _b, candidateNodeIds = _a.candidateNodeIds, forcedOffscreenNodeIds = _a.forcedOffscreenNodeIds, viewport = _a.viewport, containerSize = _a.containerSize, precomputedVisibility = _a.precomputedVisibility, _c = _a.overscan, overscan = _c === void 0 ? 240 : _c, recentlyInteractedNodeIds = _a.recentlyInteractedNodeIds, importingNodeIds = _a.importingNodeIds;
    var freshPrecomputedVisibility = isVisibleNodeSnapshotFresh(precomputedVisibility, {
        viewport: viewport,
        nodesVersion: nodesVersion,
        containerSize: containerSize,
    })
        ? precomputedVisibility.visibleNodes
        : undefined;
    var baseVisibility = freshPrecomputedVisibility !== null && freshPrecomputedVisibility !== void 0 ? freshPrecomputedVisibility : (hasUsableVisibleNodeContainerSize(containerSize)
        ? computeVisibleNodes({
            nodes: nodes,
            candidateNodeIds: candidateNodeIds,
            forcedOffscreenNodeIds: forcedOffscreenNodeIds,
            viewport: viewport,
            containerSize: containerSize,
            overscan: overscan,
            recentlyInteractedNodeIds: recentlyInteractedNodeIds,
            importingNodeIds: importingNodeIds,
        })
        : undefined);
    if (!baseVisibility) {
        return undefined;
    }
    return applyForcedOffscreenVisibility({
        baseVisibility: baseVisibility,
        nodes: nodes,
        forcedOffscreenNodeIds: forcedOffscreenNodeIds,
        viewport: viewport,
        recentlyInteractedNodeIds: recentlyInteractedNodeIds,
        importingNodeIds: importingNodeIds,
    });
}
export function useVisibleNodes(_a) {
    var nodes = _a.nodes, _b = _a.nodesVersion, nodesVersion = _b === void 0 ? 0 : _b, candidateNodeIds = _a.candidateNodeIds, forcedOffscreenNodeIds = _a.forcedOffscreenNodeIds, viewport = _a.viewport, containerSize = _a.containerSize, precomputedVisibility = _a.precomputedVisibility, _c = _a.overscan, overscan = _c === void 0 ? 240 : _c, recentlyInteractedNodeIds = _a.recentlyInteractedNodeIds, importingNodeIds = _a.importingNodeIds, _d = _a.freezeComputedVisibility, freezeComputedVisibility = _d === void 0 ? false : _d;
    var recentInteractionIds = Array.from(recentlyInteractedNodeIds !== null && recentlyInteractedNodeIds !== void 0 ? recentlyInteractedNodeIds : []).sort();
    var interactedSet = useMemo(function () { return new Set(recentInteractionIds); }, [recentInteractionIds]);
    var importingIds = Array.from(importingNodeIds !== null && importingNodeIds !== void 0 ? importingNodeIds : []).sort();
    var importingSet = useMemo(function () { return new Set(importingIds); }, [importingIds]);
    var forcedOffscreenIds = Array.from(forcedOffscreenNodeIds !== null && forcedOffscreenNodeIds !== void 0 ? forcedOffscreenNodeIds : []).sort();
    var forcedOffscreenSet = useMemo(function () { return new Set(forcedOffscreenIds); }, [forcedOffscreenIds]);
    var computedVisibility = useMemo(function () {
        return resolveVisibleNodesForCurrentState({
            nodes: nodes,
            nodesVersion: nodesVersion,
            candidateNodeIds: candidateNodeIds,
            forcedOffscreenNodeIds: forcedOffscreenSet,
            viewport: viewport,
            containerSize: containerSize,
            precomputedVisibility: precomputedVisibility,
            overscan: overscan,
            recentlyInteractedNodeIds: interactedSet,
            importingNodeIds: importingSet,
        });
    }, [
        candidateNodeIds,
        containerSize,
        forcedOffscreenNodeIds,
        forcedOffscreenSet,
        importingSet,
        interactedSet,
        nodes,
        nodesVersion,
        overscan,
        precomputedVisibility,
        viewport,
    ]);
    var _e = useState(computedVisibility !== null && computedVisibility !== void 0 ? computedVisibility : new Map()), visibleNodes = _e[0], setVisibleNodes = _e[1];
    useEffect(function () {
        if (freezeComputedVisibility || !computedVisibility) {
            return;
        }
        var frameId = window.requestAnimationFrame(function () {
            setVisibleNodes(function (current) { return (areVisibleNodeMapsEqual(current, computedVisibility)
                ? current
                : computedVisibility); });
            frameId = 0;
        });
        return function () {
            if (frameId !== 0) {
                window.cancelAnimationFrame(frameId);
            }
        };
    }, [computedVisibility, freezeComputedVisibility]);
    return visibleNodes;
}
export function computeVisibleNodes(_a) {
    var nodes = _a.nodes, candidateNodeIds = _a.candidateNodeIds, forcedOffscreenNodeIds = _a.forcedOffscreenNodeIds, viewport = _a.viewport, containerSize = _a.containerSize, _b = _a.overscan, overscan = _b === void 0 ? 240 : _b, recentlyInteractedNodeIds = _a.recentlyInteractedNodeIds, importingNodeIds = _a.importingNodeIds;
    return materializeVisibleNodeMap(computeVisibleNodesSerialized(serializeVisibleNodesInput({
        nodes: nodes,
        candidateNodeIds: candidateNodeIds,
        forcedOffscreenNodeIds: forcedOffscreenNodeIds,
        viewport: viewport,
        containerSize: containerSize,
        overscan: overscan,
        recentlyInteractedNodeIds: recentlyInteractedNodeIds instanceof Set
            ? Array.from(recentlyInteractedNodeIds)
            : Array.from(recentlyInteractedNodeIds !== null && recentlyInteractedNodeIds !== void 0 ? recentlyInteractedNodeIds : []),
        importingNodeIds: importingNodeIds instanceof Set
            ? Array.from(importingNodeIds)
            : Array.from(importingNodeIds !== null && importingNodeIds !== void 0 ? importingNodeIds : []),
    })));
}
export function computeVisibleNodesSerialized(input) {
    var _a, _b, _c, _d;
    var interactedSet = new Set((_a = input.recentlyInteractedNodeIds) !== null && _a !== void 0 ? _a : []);
    var importingSet = new Set((_b = input.importingNodeIds) !== null && _b !== void 0 ? _b : []);
    var result = [];
    if (input.containerSize.width <= 0 || input.containerSize.height <= 0) {
        return result;
    }
    var viewportRect = buildViewportRect(input.viewport, input.containerSize.width, input.containerSize.height, 0);
    var nearViewportRect = buildViewportRect(input.viewport, input.containerSize.width, input.containerSize.height, (_c = input.overscan) !== null && _c !== void 0 ? _c : 240);
    var zoom = input.viewport.zoom || 1;
    var viewportCenterX = viewportRect.x + viewportRect.width / 2;
    var viewportCenterY = viewportRect.y + viewportRect.height / 2;
    input.nodes.forEach(function (node) {
        var width = node.width;
        var height = node.height;
        var nodeRect = {
            x: node.x,
            y: node.y,
            width: width,
            height: height,
        };
        var nodeArea = Math.max(width * height, 1);
        var visibleArea = computeIntersectionArea(nodeRect, viewportRect);
        var visibleAreaRatio = clamp(visibleArea / nodeArea, 0, 1);
        var nodeCenterX = nodeRect.x + nodeRect.width / 2;
        var nodeCenterY = nodeRect.y + nodeRect.height / 2;
        var centerDistance = Math.hypot(nodeCenterX - viewportCenterX, nodeCenterY - viewportCenterY);
        var normalizedCenterDistance = Math.max(0, 1 - clamp(centerDistance / Math.max(viewportRect.width, viewportRect.height, 1), 0, 1.5));
        var zoomWeight = clamp((zoom - 0.6) / 1.4, 0, 1);
        var selectedWeight = node.selected ? 1 : 0;
        var interactedWeight = interactedSet.has(node.id) ? 1 : 0;
        var importingWeight = importingSet.has(node.id) ? 1 : 0;
        var nearViewportWeight = rectsIntersect(nodeRect, nearViewportRect) ? 1 : 0;
        var visibilityScore = clamp(visibleAreaRatio * 0.5 +
            normalizedCenterDistance * 0.2 +
            zoomWeight * 0.1 +
            selectedWeight * 0.12 +
            interactedWeight * 0.06 +
            importingWeight * 0.18 +
            nearViewportWeight * 0.02, 0, 1);
        var bucketState = deriveVisibilityBucketState({
            isVisible: visibleArea > 0,
            isNearViewport: nearViewportWeight > 0,
            visibleAreaRatio: visibleAreaRatio,
            visibilityScore: visibilityScore,
            centerDistance: centerDistance,
            viewportSpan: Math.max(viewportRect.width, viewportRect.height, 1),
            isSelected: Boolean(node.selected),
            isRecentlyInteracted: interactedSet.has(node.id),
            isImporting: importingSet.has(node.id),
            displayWidth: Math.round(width * zoom),
            displayHeight: Math.round(height * zoom),
        });
        var renderTier = resolveNodeRenderTier({
            visibilityBucket: bucketState.visibilityBucket,
            isSelected: Boolean(node.selected),
            isRecentlyInteracted: interactedSet.has(node.id),
            isImporting: importingSet.has(node.id),
        });
        result.push({
            nodeId: node.id,
            visibility: {
                isVisible: visibleArea > 0,
                isNearViewport: nearViewportWeight > 0,
                displayWidth: Math.round(width * zoom),
                displayHeight: Math.round(height * zoom),
                visibilityBucket: bucketState.visibilityBucket,
                visibilityScoreBucket: bucketState.visibilityScoreBucket,
                visibilityAreaBucket: bucketState.visibilityAreaBucket,
                visibleAreaRatio: visibleAreaRatio,
                viewportZoom: zoom,
                visibilityScore: visibilityScore,
                centerDistance: centerDistance,
                isSelected: Boolean(node.selected),
                isRecentlyInteracted: interactedSet.has(node.id),
                isImporting: importingSet.has(node.id),
                renderTier: renderTier,
            },
        });
    });
    ((_d = input.forcedOffscreenNodeIds) !== null && _d !== void 0 ? _d : []).forEach(function (nodeId) {
        if (result.some(function (entry) { return entry.nodeId === nodeId; })) {
            return;
        }
        result.push({
            nodeId: nodeId,
            visibility: {
                isVisible: false,
                isNearViewport: false,
                displayWidth: 0,
                displayHeight: 0,
                visibilityBucket: 'offscreen',
                visibilityScoreBucket: 'cancel',
                visibilityAreaBucket: 'none',
                visibleAreaRatio: 0,
                viewportZoom: input.viewport.zoom || 1,
                visibilityScore: 0,
                centerDistance: Number.POSITIVE_INFINITY,
                isSelected: false,
                isRecentlyInteracted: false,
                isImporting: importingSet.has(nodeId),
                renderTier: importingSet.has(nodeId) ? 'full' : 'minimal',
            },
        });
    });
    return result;
}
export function diffVisibleNodes(previous, next) {
    if (!previous || previous.size === 0) {
        return next;
    }
    var diff = new Map();
    next.forEach(function (nextState, nodeId) {
        var previousState = previous.get(nodeId);
        if (!previousState) {
            diff.set(nodeId, nextState);
            return;
        }
        if (shouldEmitVisibilityDiff(toVisibilityBucketState(previousState), toVisibilityBucketState(nextState))) {
            diff.set(nodeId, nextState);
            return;
        }
        if (previousState.isSelected !== nextState.isSelected ||
            previousState.isRecentlyInteracted !== nextState.isRecentlyInteracted ||
            previousState.isImporting !== nextState.isImporting ||
            previousState.renderTier !== nextState.renderTier) {
            diff.set(nodeId, nextState);
        }
    });
    previous.forEach(function (previousState, nodeId) {
        if (next.has(nodeId)) {
            return;
        }
        if (previousState.isVisible ||
            previousState.isNearViewport ||
            previousState.renderTier !== 'minimal' ||
            previousState.isRecentlyInteracted ||
            previousState.isImporting) {
            return;
        }
        diff.set(nodeId, {
            isVisible: false,
            isNearViewport: false,
            displayWidth: 0,
            displayHeight: 0,
            visibilityBucket: 'offscreen',
            visibilityScoreBucket: 'cancel',
            visibilityAreaBucket: 'none',
            visibleAreaRatio: 0,
            viewportZoom: previousState.viewportZoom,
            visibilityScore: 0,
            centerDistance: Number.POSITIVE_INFINITY,
            isSelected: false,
            isRecentlyInteracted: false,
            isImporting: false,
            renderTier: 'minimal',
        });
    });
    return diff;
}
function toVisibilityBucketState(state) {
    return {
        visibilityBucket: state.visibilityBucket,
        visibilityScoreBucket: state.visibilityScoreBucket,
        visibilityAreaBucket: state.visibilityAreaBucket,
        displayWidthBucket: resolveDisplayBucket(state.displayWidth),
        displayHeightBucket: resolveDisplayBucket(state.displayHeight),
    };
}
