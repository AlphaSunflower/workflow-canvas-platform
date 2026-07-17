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
import { ConnectionLineType } from 'reactflow';
import { isAINodeData, isFileNodeData } from '@/utils/common/guards';
import { ensureAIImageInputGroups, normalizeAIImageGenInputHandle, normalizeAIImageGenOutputHandle, } from '@/utils/node/create';
import { createGroupPortHandle } from '@/nodes/shared/group-port-handle';
import { AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO, AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT, AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE, AI_IMAGE_INPAINT_DEFAULT_MASK_MODE, } from '@/nodes/ai-image-inpaint/constants';
import { createAIImageInpaintInputGroup, getAIImageInpaintInputHandle, getAIImageInpaintOutputHandle, } from '@/nodes/ai-image-inpaint/groups';
export var WORKFLOW_CONNECTION_LINE_TYPE = ConnectionLineType.Bezier;
export var WORKFLOW_CONNECTION_LINE_STYLE = { stroke: '#b1b1b7', strokeWidth: 1 };
var AI_IMAGE_INPUT_PORT_ID = 'images';
function migrateLegacyNode(node) {
    if (node.type === 'aiChat' || node.type === 'group') {
        return null;
    }
    if (node.type === 'aiImageRestore') {
        return __assign(__assign({}, node), { type: 'aiMultiViewRestore' });
    }
    return node;
}
export function createReactFlowNode(node) {
    return {
        id: node.id.value,
        type: node.type,
        position: node.position,
        data: node,
        dragHandle: node.type === 'aiImageGen' ? '.ai-image-gen-node__titlebar' : undefined,
    };
}
export function createReactFlowNodes(nodes) {
    return Object.values(nodes).map(createReactFlowNode);
}
export function createReactFlowEdge(connection) {
    return {
        id: connection.id,
        source: connection.sourceId,
        target: connection.targetId,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        type: WORKFLOW_CONNECTION_LINE_TYPE,
        animated: false,
        style: __assign({}, WORKFLOW_CONNECTION_LINE_STYLE),
        data: {
            connectionType: connection.type,
            order: connection.order,
        },
    };
}
export function createReactFlowEdges(connections) {
    return connections.map(createReactFlowEdge);
}
export function createWorkflowNodesRecord(nodes) {
    return nodes.reduce(function (accumulator, node) {
        var transientFileNodeData = ((node.data.type === 'image' || node.data.type === 'video' || node.data.type === 'ply') &&
            ('renderTier' in node.data || 'activeState' in node.data || 'activeReasons' in node.data))
            ? __assign(__assign({}, node.data), { renderTier: undefined, activeState: undefined, activeReasons: undefined }) : node.data;
        accumulator[node.id] = __assign(__assign({}, transientFileNodeData), { position: node.position });
        return accumulator;
    }, {});
}
export function createWorkflowConnections(edges) {
    return edges.map(function (edge) {
        var _a, _b, _c, _d, _e;
        return ({
            id: edge.id,
            type: (_b = (_a = edge.data) === null || _a === void 0 ? void 0 : _a.connectionType) !== null && _b !== void 0 ? _b : 'file-reference',
            sourceId: edge.source,
            targetId: edge.target,
            sourceHandle: (_c = edge.sourceHandle) !== null && _c !== void 0 ? _c : undefined,
            targetHandle: (_d = edge.targetHandle) !== null && _d !== void 0 ? _d : undefined,
            order: (_e = edge.data) === null || _e === void 0 ? void 0 : _e.order,
        });
    });
}
function normalizeAINode(node) {
    if (node.type === 'aiImageInpaint') {
        return __assign(__assign({}, node), { references: Array.isArray(node.references) ? node.references : [], outputs: Array.isArray(node.outputs) ? node.outputs : [], tasks: Array.isArray(node.tasks) ? node.tasks : [], config: __assign(__assign({}, node.config), { aspectRatio: typeof node.config.aspectRatio === 'string' && node.config.aspectRatio.length > 0
                    ? node.config.aspectRatio
                    : AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO, imageSize: typeof node.config.imageSize === 'string' && node.config.imageSize.length > 0
                    ? node.config.imageSize
                    : AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE, maskMode: typeof node.config.maskMode === 'string' && node.config.maskMode.length > 0
                    ? node.config.maskMode
                    : AI_IMAGE_INPAINT_DEFAULT_MASK_MODE, editorHeight: typeof node.config.editorHeight === 'number' && Number.isFinite(node.config.editorHeight)
                    ? node.config.editorHeight
                    : AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT, hasMaskMarks: node.config.hasMaskMarks === true, maskStrokes: Array.isArray(node.config.maskStrokes)
                    ? node.config.maskStrokes
                    : [], maskSourceFileId: typeof node.config.maskSourceFileId === 'string'
                    ? node.config.maskSourceFileId
                    : undefined, maskSourceWidth: typeof node.config.maskSourceWidth === 'number' && Number.isFinite(node.config.maskSourceWidth)
                    ? node.config.maskSourceWidth
                    : undefined, maskSourceHeight: typeof node.config.maskSourceHeight === 'number' && Number.isFinite(node.config.maskSourceHeight)
                    ? node.config.maskSourceHeight
                    : undefined, inputGroups: createAIImageInpaintInputGroup() }) });
    }
    if (node.type !== 'aiImageGen') {
        return __assign(__assign({}, node), { references: Array.isArray(node.references) ? node.references : [], outputs: Array.isArray(node.outputs) ? node.outputs : [], tasks: Array.isArray(node.tasks) ? node.tasks : [] });
    }
    return __assign(__assign({}, node), { references: Array.isArray(node.references) ? node.references : [], outputs: Array.isArray(node.outputs) ? node.outputs : [], tasks: Array.isArray(node.tasks) ? node.tasks : [], config: __assign(__assign({}, node.config), { model: typeof node.config.model === 'string' && node.config.model.length > 0
                ? node.config.model
                : 'gpt-image-2-vip', aspectRatio: typeof node.config.aspectRatio === 'string' && node.config.aspectRatio.length > 0
                ? node.config.aspectRatio
                : '1:1', resolutionPreset: typeof node.config.resolutionPreset === 'string' && node.config.resolutionPreset.length > 0
                ? node.config.resolutionPreset
                : '1024x1024', outputCount: typeof node.config.outputCount === 'number' && Number.isFinite(node.config.outputCount)
                ? node.config.outputCount
                : 1, inputGroups: ensureAIImageInputGroups(node.config) }) });
}
function normalizeRelatedTasks(metadata) {
    if (!Array.isArray(metadata.relatedTasks)) {
        return [];
    }
    return metadata.relatedTasks.filter(function (task) { return (typeof task === 'object' &&
        task !== null &&
        typeof task.taskId === 'string' &&
        (task.taskNo === undefined || typeof task.taskNo === 'string') &&
        (task.runId === undefined || typeof task.runId === 'string') &&
        (task.runNo === undefined || typeof task.runNo === 'string') &&
        typeof task.nodeId === 'string' &&
        typeof task.nodeDisplayId === 'string' &&
        typeof task.nodeType === 'string' &&
        (task.groupId === undefined || typeof task.groupId === 'string') &&
        (task.groupOrder === undefined || typeof task.groupOrder === 'number') &&
        (task.outputHandle === undefined || typeof task.outputHandle === 'string') &&
        (task.createdAt === undefined || typeof task.createdAt === 'number')); });
}
function normalizeWorkflowNode(node) {
    var migrated = migrateLegacyNode(node);
    if (!migrated) {
        return null;
    }
    if (isAINodeData(migrated)) {
        return normalizeAINode(migrated);
    }
    return migrated;
}
function findLegacyReferenceSourceId(reference, nodesById) {
    var referencedNode = nodesById.get(reference.nodeId);
    if (referencedNode && isFileNodeData(referencedNode) && referencedNode.fileId === reference.fileId) {
        return referencedNode.id.value;
    }
    for (var _i = 0, _a = nodesById.values(); _i < _a.length; _i++) {
        var node = _a[_i];
        if (isFileNodeData(node) && node.fileId === reference.fileId) {
            return node.id.value;
        }
    }
    return null;
}
function createLegacyAIImageConnections(nodesById, existingConnections) {
    var _a, _b;
    var generatedConnections = [];
    var existingKeys = new Set(existingConnections.map(function (connection) {
        var _a;
        return [
            connection.type,
            connection.sourceId,
            connection.targetId,
            (_a = connection.targetHandle) !== null && _a !== void 0 ? _a : '',
        ].join(':');
    }));
    var _loop_1 = function (node) {
        if (!isAINodeData(node) || node.type !== 'aiImageGen') {
            return "continue";
        }
        var existingAIInputs = existingConnections.some(function (connection) {
            return connection.type === 'file-reference' && connection.targetId === node.id.value;
        });
        if (existingAIInputs) {
            return "continue";
        }
        var references = Array.isArray(node.references) ? __spreadArray([], node.references, true) : [];
        if (references.length === 0) {
            return "continue";
        }
        var defaultGroupId = (_b = (_a = ensureAIImageInputGroups(node.config)[0]) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 'group-1';
        references
            .slice()
            .sort(function (left, right) { return left.order - right.order; })
            .forEach(function (reference, index) {
            var sourceId = findLegacyReferenceSourceId(reference, nodesById);
            if (!sourceId) {
                return;
            }
            var key = ['file-reference', sourceId, node.id.value, defaultGroupId].join(':');
            if (existingKeys.has(key)) {
                return;
            }
            existingKeys.add(key);
            generatedConnections.push({
                id: "legacy-ai-image-".concat(node.id.value, "-").concat(sourceId, "-").concat(index + 1),
                type: 'file-reference',
                sourceId: sourceId,
                targetId: node.id.value,
                targetHandle: createGroupPortHandle(defaultGroupId, AI_IMAGE_INPUT_PORT_ID),
                order: typeof reference.order === 'number' && Number.isFinite(reference.order) ? reference.order : index,
            });
        });
    };
    for (var _i = 0, _c = nodesById.values(); _i < _c.length; _i++) {
        var node = _c[_i];
        _loop_1(node);
    }
    return generatedConnections;
}
function normalizeConnection(connection, fallbackOrder, nodesById) {
    var _a;
    if (!nodesById.has(connection.sourceId) || !nodesById.has(connection.targetId)) {
        return null;
    }
    var targetNode = nodesById.get(connection.targetId);
    var normalizedTargetHandle = (connection.type === 'file-reference' &&
        targetNode &&
        isAINodeData(targetNode) &&
        targetNode.type === 'aiImageGen')
        ? (function () {
            var _a, _b;
            var defaultGroupId = (_a = ensureAIImageInputGroups(targetNode.config)[0]) === null || _a === void 0 ? void 0 : _a.id;
            if (!defaultGroupId) {
                return connection.targetHandle;
            }
            return normalizeAIImageGenInputHandle((_b = connection.targetHandle) !== null && _b !== void 0 ? _b : undefined, targetNode.config);
        })()
        : connection.targetHandle;
    var sourceNode = nodesById.get(connection.sourceId);
    var normalizedInpaintTargetHandle = (connection.type === 'file-reference' &&
        targetNode &&
        isAINodeData(targetNode) &&
        targetNode.type === 'aiImageInpaint')
        ? getAIImageInpaintInputHandle()
        : normalizedTargetHandle;
    var normalizedSourceHandle = (connection.type === 'output-link' &&
        sourceNode &&
        isAINodeData(sourceNode) &&
        sourceNode.type === 'aiImageGen')
        ? normalizeAIImageGenOutputHandle((_a = connection.sourceHandle) !== null && _a !== void 0 ? _a : undefined, sourceNode.config)
        : (connection.type === 'output-link' &&
            sourceNode &&
            isAINodeData(sourceNode) &&
            sourceNode.type === 'aiImageInpaint')
            ? getAIImageInpaintOutputHandle()
            : connection.sourceHandle;
    return __assign(__assign({}, connection), { sourceHandle: normalizedSourceHandle !== null && normalizedSourceHandle !== void 0 ? normalizedSourceHandle : undefined, targetHandle: normalizedInpaintTargetHandle !== null && normalizedInpaintTargetHandle !== void 0 ? normalizedInpaintTargetHandle : undefined, order: typeof connection.order === 'number' && Number.isFinite(connection.order)
            ? connection.order
            : fallbackOrder });
}
export function normalizeWorkflowData(workflow) {
    var normalizedNodes = Object.fromEntries(Object.entries(workflow.nodes)
        .map(function (_a) {
        var nodeId = _a[0], node = _a[1];
        return [nodeId, normalizeWorkflowNode(node)];
    })
        .filter(function (entry) { return entry[1] !== null; }));
    var nodesById = new Map(Object.values(normalizedNodes).map(function (node) { return [node.id.value, node]; }));
    var legacyConnections = createLegacyAIImageConnections(nodesById, workflow.connections);
    var normalizedConnections = dedupeAIImageInpaintConnections(__spreadArray(__spreadArray([], workflow.connections, true), legacyConnections, true), nodesById)
        .map(function (connection, index) { return normalizeConnection(connection, index, nodesById); })
        .filter(function (connection) { return Boolean(connection); });
    return __assign(__assign({}, workflow), { nodes: normalizedNodes, connections: normalizedConnections, metadata: __assign(__assign({}, workflow.metadata), { relatedTasks: normalizeRelatedTasks(workflow.metadata) }) });
}
function dedupeAIImageInpaintConnections(connections, nodesById) {
    var latestInputByNodeId = new Map();
    var passthroughConnections = [];
    connections.forEach(function (connection) {
        var _a;
        var targetNode = nodesById.get(connection.targetId);
        if (connection.type === 'file-reference' &&
            targetNode &&
            isAINodeData(targetNode) &&
            targetNode.type === 'aiImageInpaint') {
            latestInputByNodeId.set(targetNode.id.value, __assign(__assign({}, connection), { targetHandle: getAIImageInpaintInputHandle(), order: 0 }));
            return;
        }
        if (connection.type === 'output-link' &&
            ((_a = nodesById.get(connection.sourceId)) === null || _a === void 0 ? void 0 : _a.type) === 'aiImageInpaint') {
            passthroughConnections.push(__assign(__assign({}, connection), { sourceHandle: getAIImageInpaintOutputHandle() }));
            return;
        }
        passthroughConnections.push(connection);
    });
    return __spreadArray(__spreadArray([], passthroughConnections, true), Array.from(latestInputByNodeId.values()), true);
}
export function normalizeViewport(viewport) {
    return {
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom,
    };
}
export function createWorkflowRuntimeSnapshot(nodes, edges, viewport) {
    return {
        nodes: createWorkflowNodesRecord(nodes),
        connections: createWorkflowConnections(edges),
        viewport: normalizeViewport(viewport),
    };
}
