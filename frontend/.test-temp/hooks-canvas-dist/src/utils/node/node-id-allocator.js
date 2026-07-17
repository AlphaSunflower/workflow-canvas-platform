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
import { MAX_NODE_ID, NODE_ID_EXHAUSTED_ERROR, generateNodeId } from './node-id.shared';
function parseNumericNodeId(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    }
    if (typeof value !== 'string') {
        return 0;
    }
    var trimmed = value.trim();
    if (trimmed.length === 0) {
        return 0;
    }
    var parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
export function getMaxNodeIdFromNodeMap(nodes) {
    return Object.keys(nodes).reduce(function (max, nodeId) { return Math.max(max, parseNumericNodeId(nodeId)); }, 0);
}
export function getMaxNodeIdFromCollection(nodeIds) {
    if (!Array.isArray(nodeIds)) {
        return 0;
    }
    return nodeIds.reduce(function (max, nodeId) { return Math.max(max, parseNumericNodeId(nodeId)); }, 0);
}
export function normalizeWorkflowNodeIdMetadata(metadata, nodes) {
    var maxNodeIdFromNodes = getMaxNodeIdFromNodeMap(nodes);
    var maxNodeIdFromUsedIds = getMaxNodeIdFromCollection(metadata.usedNodeIds);
    var historicalLastNodeId = parseNumericNodeId(metadata.lastNodeId);
    var normalizedLastNodeId = Math.max(historicalLastNodeId, maxNodeIdFromNodes, maxNodeIdFromUsedIds);
    var usedNodeIds = Array.from(new Set(__spreadArray(__spreadArray([], (Array.isArray(metadata.usedNodeIds) ? metadata.usedNodeIds : []), true), Object.keys(nodes), true)));
    return __assign(__assign({}, metadata), { lastNodeId: normalizedLastNodeId, usedNodeIds: usedNodeIds, releasedNodeIds: Array.isArray(metadata.releasedNodeIds) ? metadata.releasedNodeIds : [] });
}
export function createMonotonicNodeIdAllocator(initialLastIssued) {
    if (initialLastIssued === void 0) { initialLastIssued = 0; }
    var lastIssued = Math.max(0, Math.floor(initialLastIssued));
    function allocateOne() {
        if (lastIssued >= MAX_NODE_ID) {
            return {
                success: false,
                error: NODE_ID_EXHAUSTED_ERROR,
            };
        }
        lastIssued += 1;
        return {
            success: true,
            nodeId: generateNodeId(lastIssued),
        };
    }
    return {
        next: function () {
            return allocateOne();
        },
        nextBatch: function (count) {
            var safeCount = Math.max(0, Math.floor(count));
            if (safeCount === 0) {
                return {
                    success: true,
                    nodeIds: [],
                };
            }
            if (lastIssued + safeCount > MAX_NODE_ID) {
                return {
                    success: false,
                    error: NODE_ID_EXHAUSTED_ERROR,
                };
            }
            var nodeIds = Array.from({ length: safeCount }, function () {
                var allocation = allocateOne();
                return allocation.nodeId;
            });
            return {
                success: true,
                nodeIds: nodeIds,
            };
        },
        getLastIssued: function () {
            return lastIssued;
        },
        isExhausted: function () {
            return lastIssued >= MAX_NODE_ID;
        },
        snapshot: function () {
            return { lastIssued: lastIssued };
        },
    };
}
export function createNodeIdAllocatorFromWorkflowMetadata(metadata, nodes) {
    var normalizedMetadata = normalizeWorkflowNodeIdMetadata(metadata, nodes);
    return createMonotonicNodeIdAllocator(normalizedMetadata.lastNodeId);
}
