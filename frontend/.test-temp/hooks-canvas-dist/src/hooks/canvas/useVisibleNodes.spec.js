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
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT, AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP, AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP, AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT, } from '@/nodes/ai-image-inpaint/constants';
import { computeVisibleNodes, diffVisibleNodes, hasUsableVisibleNodeContainerSize, isVisibleNodeSnapshotFresh, resolveVisibleNodesForCurrentState, } from './useVisibleNodes';
function createNode(id, x, y, width, height) {
    if (width === void 0) { width = 200; }
    if (height === void 0) { height = 120; }
    return {
        id: id,
        type: 'file',
        position: { x: x, y: y },
        data: {
            id: id,
            type: 'image',
            label: id,
            position: { x: x, y: y },
            dimensions: { width: width, height: height },
            metadata: {},
            status: 'idle',
            timestamp: { created: '', updated: '' },
        },
        width: width,
        height: height,
        selected: false,
    };
}
function createInpaintNode(id, x, y) {
    var data = {
        id: { value: id, display: "#".concat(id) },
        type: 'aiImageInpaint',
        position: { x: x, y: y },
        dimensions: { width: 500, height: 460 },
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 0,
        timestamp: { created: 1, updated: 1 },
        references: [],
        outputs: [],
        config: {
            editorHeight: AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
        },
        tasks: [],
    };
    return {
        id: id,
        type: 'aiImageInpaint',
        position: data.position,
        data: data,
        width: data.dimensions.width,
        height: data.dimensions.height,
        selected: false,
    };
}
function compute(nodes, viewport, options) {
    return computeVisibleNodes({
        nodes: nodes,
        viewport: viewport,
        containerSize: { width: 1280, height: 720 },
        recentlyInteractedNodeIds: options === null || options === void 0 ? void 0 : options.recent,
        importingNodeIds: options === null || options === void 0 ? void 0 : options.importing,
    });
}
test('diffVisibleNodes suppresses minor continuous score changes inside the same bucket', function () {
    var node = createNode('n1', 80, 80);
    var previous = compute([node], { x: 0, y: 0, zoom: 1 });
    var next = compute([node], { x: -6, y: -4, zoom: 1 });
    var diff = diffVisibleNodes(previous, next);
    assert.equal(diff.size, 0);
});
test('diffVisibleNodes emits when node enters the viewport', function () {
    var _a, _b;
    var node = createNode('n1', 1500, 80);
    var previous = compute([node], { x: 0, y: 0, zoom: 1 });
    var next = compute([node], { x: -1420, y: 0, zoom: 1 });
    var diff = diffVisibleNodes(previous, next);
    assert.equal((_a = previous.get('n1')) === null || _a === void 0 ? void 0 : _a.isVisible, false);
    assert.equal((_b = next.get('n1')) === null || _b === void 0 ? void 0 : _b.isVisible, true);
    assert.equal(diff.size, 1);
});
test('diffVisibleNodes emits when importing priority semantics change', function () {
    var _a, _b;
    var node = createNode('n1', 900, 80);
    var previous = compute([node], { x: 0, y: 0, zoom: 1 });
    var next = compute([node], { x: 0, y: 0, zoom: 1 }, { importing: ['n1'] });
    var diff = diffVisibleNodes(previous, next);
    assert.equal((_a = previous.get('n1')) === null || _a === void 0 ? void 0 : _a.isImporting, false);
    assert.equal((_b = next.get('n1')) === null || _b === void 0 ? void 0 : _b.isImporting, true);
    assert.equal(diff.size, 1);
});
test('computeVisibleNodes only evaluates candidate nodes when candidateNodeIds is provided', function () {
    var visibleNode = createNode('visible', 80, 80);
    var offscreenNode = createNode('offscreen', 3000, 3000);
    var result = computeVisibleNodes({
        nodes: [visibleNode, offscreenNode],
        candidateNodeIds: ['visible'],
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
    });
    assert.equal(result.has('visible'), true);
    assert.equal(result.has('offscreen'), false);
});
test('computeVisibleNodes treats the floating inpaint editor as part of node visibility', function () {
    var bodyTop = 720 + 20;
    var inpaintNode = createInpaintNode('inpaint', 80, bodyTop);
    var result = computeVisibleNodes({
        nodes: [inpaintNode],
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
        overscan: 0,
    });
    var visibility = result.get('inpaint');
    assert.equal(visibility === null || visibility === void 0 ? void 0 : visibility.isVisible, true);
    assert.equal(visibility === null || visibility === void 0 ? void 0 : visibility.displayHeight, 460
        + AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT
        + AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP
        + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP
        + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT);
});
test('diffVisibleNodes emits offscreen fallback when an already minimal node drops out of candidate set', function () {
    var _a, _b, _c;
    var node = createNode('n1', 3000, 3000);
    var previous = computeVisibleNodes({
        nodes: [node],
        candidateNodeIds: ['n1'],
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
    });
    var next = computeVisibleNodes({
        nodes: [node],
        candidateNodeIds: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
    });
    var diff = diffVisibleNodes(previous, next);
    assert.equal(next.has('n1'), false);
    assert.equal((_a = diff.get('n1')) === null || _a === void 0 ? void 0 : _a.isVisible, false);
    assert.equal((_b = diff.get('n1')) === null || _b === void 0 ? void 0 : _b.isNearViewport, false);
    assert.equal((_c = diff.get('n1')) === null || _c === void 0 ? void 0 : _c.renderTier, 'minimal');
});
test('computeVisibleNodes keeps forced importing nodes renderable even when they are outside candidateNodeIds', function () {
    var _a, _b, _c;
    var offscreenImportingNode = createNode('importing', 3000, 3000);
    var result = computeVisibleNodes({
        nodes: [offscreenImportingNode],
        candidateNodeIds: [],
        forcedOffscreenNodeIds: ['importing'],
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
        importingNodeIds: ['importing'],
    });
    assert.equal((_a = result.get('importing')) === null || _a === void 0 ? void 0 : _a.isImporting, true);
    assert.equal((_b = result.get('importing')) === null || _b === void 0 ? void 0 : _b.isNearViewport, true);
    assert.equal((_c = result.get('importing')) === null || _c === void 0 ? void 0 : _c.renderTier, 'full');
});
test('diffVisibleNodes keeps recently near-viewport nodes stable when they temporarily drop out of candidate set', function () {
    var _a, _b;
    var previous = computeVisibleNodes({
        nodes: [createNode('n1', 1400, 80)],
        candidateNodeIds: ['n1'],
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
    });
    var next = new Map();
    var diff = diffVisibleNodes(previous, next);
    assert.equal((_a = previous.get('n1')) === null || _a === void 0 ? void 0 : _a.isVisible, false);
    assert.equal((_b = previous.get('n1')) === null || _b === void 0 ? void 0 : _b.isNearViewport, true);
    assert.equal(diff.size, 0);
});
test('diffVisibleNodes keeps visible nodes stable when they temporarily drop out of candidate set', function () {
    var previous = new Map([
        ['n1', {
                isVisible: true,
                isNearViewport: true,
                displayWidth: 220,
                displayHeight: 140,
                visibilityBucket: 'visible',
                visibilityScoreBucket: 'ready',
                visibilityAreaBucket: 'ready',
                visibleAreaRatio: 0.8,
                viewportZoom: 1,
                visibilityScore: 0.82,
                centerDistance: 120,
                isSelected: false,
                isRecentlyInteracted: false,
                isImporting: false,
                renderTier: 'full',
            }],
    ]);
    var next = new Map();
    var diff = diffVisibleNodes(previous, next);
    assert.equal(diff.size, 0);
});
test('isVisibleNodeSnapshotFresh accepts only matching viewport, nodes version, and container size', function () {
    var visibleNodes = computeVisibleNodes({
        nodes: [createNode('n1', 80, 80)],
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
    });
    var snapshot = {
        visibleNodes: visibleNodes,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodesVersion: 2,
        containerSize: { width: 1280, height: 720 },
        computedAt: 123,
    };
    assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodesVersion: 2,
        containerSize: { width: 1280, height: 720 },
    }), true);
    assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
        viewport: { x: -100, y: 0, zoom: 1 },
        nodesVersion: 2,
        containerSize: { width: 1280, height: 720 },
    }), false);
    assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodesVersion: 3,
        containerSize: { width: 1280, height: 720 },
    }), false);
    assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodesVersion: 2,
        containerSize: { width: 1024, height: 720 },
    }), false);
});
test('isVisibleNodeSnapshotFresh rejects unusable current or snapshot container size', function () {
    var snapshot = {
        visibleNodes: computeVisibleNodes({
            nodes: [createNode('n1', 80, 80)],
            viewport: { x: 0, y: 0, zoom: 1 },
            containerSize: { width: 1280, height: 720 },
        }),
        viewport: { x: 0, y: 0, zoom: 1 },
        nodesVersion: 1,
        containerSize: { width: 1280, height: 720 },
        computedAt: 123,
    };
    assert.equal(hasUsableVisibleNodeContainerSize({ width: 1280, height: 720 }), true);
    assert.equal(hasUsableVisibleNodeContainerSize({ width: 0, height: 720 }), false);
    assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodesVersion: 1,
        containerSize: { width: 0, height: 720 },
    }), false);
    assert.equal(isVisibleNodeSnapshotFresh(__assign(__assign({}, snapshot), { containerSize: { width: 0, height: 720 } }), {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodesVersion: 1,
        containerSize: { width: 0, height: 720 },
    }), false);
});
test('resolveVisibleNodesForCurrentState ignores stale precomputed snapshot and recomputes current visibility', function () {
    var _a, _b;
    var node = createNode('n1', 80, 80);
    var staleVisibility = computeVisibleNodes({
        nodes: [node],
        viewport: { x: -3000, y: -3000, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
    });
    var result = resolveVisibleNodesForCurrentState({
        nodes: [node],
        nodesVersion: 2,
        precomputedVisibility: {
            visibleNodes: staleVisibility,
            viewport: { x: -3000, y: -3000, zoom: 1 },
            nodesVersion: 1,
            containerSize: { width: 1280, height: 720 },
            computedAt: 123,
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
    });
    assert.equal((_a = staleVisibility.get('n1')) === null || _a === void 0 ? void 0 : _a.isVisible, false);
    assert.equal((_b = result === null || result === void 0 ? void 0 : result.get('n1')) === null || _b === void 0 ? void 0 : _b.isVisible, true);
});
test('resolveVisibleNodesForCurrentState returns undefined when container size is temporarily unavailable', function () {
    var result = resolveVisibleNodesForCurrentState({
        nodes: [createNode('n1', 80, 80)],
        nodesVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 0, height: 720 },
    });
    assert.equal(result, undefined);
});
test('resolveVisibleNodesForCurrentState keeps forced importing nodes renderable', function () {
    var _a, _b, _c;
    var importingNode = createNode('importing', 3000, 3000);
    var result = resolveVisibleNodesForCurrentState({
        nodes: [importingNode],
        nodesVersion: 1,
        candidateNodeIds: [],
        forcedOffscreenNodeIds: ['importing'],
        importingNodeIds: ['importing'],
        viewport: { x: 0, y: 0, zoom: 1 },
        containerSize: { width: 1280, height: 720 },
    });
    assert.equal((_a = result === null || result === void 0 ? void 0 : result.get('importing')) === null || _a === void 0 ? void 0 : _a.isImporting, true);
    assert.equal((_b = result === null || result === void 0 ? void 0 : result.get('importing')) === null || _b === void 0 ? void 0 : _b.isNearViewport, true);
    assert.equal((_c = result === null || result === void 0 ? void 0 : result.get('importing')) === null || _c === void 0 ? void 0 : _c.renderTier, 'full');
});
