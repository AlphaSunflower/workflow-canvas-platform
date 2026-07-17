/**
 * Workflow validators.
 * @module utils/validators/workflow-validators
 */
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
import { ensureAIImageInputGroups, normalizeAIImageGenInputHandle, normalizeAIImageGenOutputHandle, } from '@/utils/node/create';
import { createGroupPortHandle } from '@/nodes/shared/group-port-handle';
import { AI_IMAGE_INPAINT_GROUP_ID, AI_IMAGE_INPAINT_INPUT_PORT_ID, AI_IMAGE_INPAINT_RESULT_PORT_ID, getAIImageInpaintInputHandle, getAIImageInpaintOutputHandle, } from '@/nodes/ai-image-inpaint/groups';
import { normalizeWorkflowData } from '@/utils/workflow/runtime';
import { isAINodeData, isFileNodeData } from '../common';
import { validateNodeData } from './node-validators';
import { CANVAS_DEFAULTS } from '@/constants/canvas.constants';
import { AUTO_SAVE_DEFAULTS, CONNECTION_STYLE_DEFAULTS } from '@/constants/workflow.constants';
var COLOR_HEX_PATTERN = /^#([0-9A-Fa-f]{3}){1,2}$/;
var COLOR_RGB_PATTERN = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/;
var COLOR_RGBA_PATTERN = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/;
var AI_IMAGE_INPUT_PORT_ID = 'images';
var AI_IMAGE_RESULT_PORT_ID = 'result';
export function createValidResult() {
    return { valid: true, message: '' };
}
export function createInvalidResult(message) {
    return { valid: false, message: message };
}
export function validateViewport(viewport) {
    if (typeof viewport !== 'object' || viewport === null) {
        return createInvalidResult('Viewport must be an object.');
    }
    var vp = viewport;
    if (typeof vp.x !== 'number' || !Number.isFinite(vp.x)) {
        return createInvalidResult('Viewport x must be a finite number.');
    }
    if (typeof vp.y !== 'number' || !Number.isFinite(vp.y)) {
        return createInvalidResult('Viewport y must be a finite number.');
    }
    if (typeof vp.zoom !== 'number' || !Number.isFinite(vp.zoom)) {
        return createInvalidResult('Viewport zoom must be a finite number.');
    }
    if (vp.zoom < CANVAS_DEFAULTS.minZoom) {
        return createInvalidResult("Viewport zoom cannot be less than ".concat(CANVAS_DEFAULTS.minZoom, "."));
    }
    if (vp.zoom > CANVAS_DEFAULTS.maxZoom) {
        return createInvalidResult("Viewport zoom cannot be greater than ".concat(CANVAS_DEFAULTS.maxZoom, "."));
    }
    return createValidResult();
}
export function validateZoom(zoom) {
    if (typeof zoom !== 'number' || !Number.isFinite(zoom)) {
        return createInvalidResult('Zoom must be a finite number.');
    }
    if (zoom < CANVAS_DEFAULTS.minZoom) {
        return createInvalidResult("Zoom cannot be less than ".concat(CANVAS_DEFAULTS.minZoom, "."));
    }
    if (zoom > CANVAS_DEFAULTS.maxZoom) {
        return createInvalidResult("Zoom cannot be greater than ".concat(CANVAS_DEFAULTS.maxZoom, "."));
    }
    return createValidResult();
}
export function validateCanvasPosition(position) {
    if (typeof position !== 'object' || position === null) {
        return createInvalidResult('Position must be an object.');
    }
    var pos = position;
    if (typeof pos.x !== 'number' || !Number.isFinite(pos.x)) {
        return createInvalidResult('Position x must be a finite number.');
    }
    if (typeof pos.y !== 'number' || !Number.isFinite(pos.y)) {
        return createInvalidResult('Position y must be a finite number.');
    }
    var halfWidth = CANVAS_DEFAULTS.width / 2;
    var halfHeight = CANVAS_DEFAULTS.height / 2;
    if (Math.abs(pos.x) > halfWidth) {
        return createInvalidResult("Position x(".concat(pos.x, ") is outside the canvas bounds."));
    }
    if (Math.abs(pos.y) > halfHeight) {
        return createInvalidResult("Position y(".concat(pos.y, ") is outside the canvas bounds."));
    }
    return createValidResult();
}
export function validateConnection(connection) {
    if (typeof connection !== 'object' || connection === null) {
        return createInvalidResult('Connection must be an object.');
    }
    var conn = connection;
    if (typeof conn.id !== 'string' || conn.id.length === 0) {
        return createInvalidResult('Connection id must be a non-empty string.');
    }
    if (conn.type !== 'file-reference' && conn.type !== 'output-link') {
        return createInvalidResult('Connection type must be file-reference or output-link.');
    }
    if (typeof conn.sourceId !== 'string' || conn.sourceId.length === 0) {
        return createInvalidResult('Connection sourceId must be a non-empty string.');
    }
    if (typeof conn.targetId !== 'string' || conn.targetId.length === 0) {
        return createInvalidResult('Connection targetId must be a non-empty string.');
    }
    if (conn.sourceId === conn.targetId) {
        return createInvalidResult('Connection source and target cannot be the same node.');
    }
    return createValidResult();
}
export function validateAutoSaveConfig(config) {
    if (typeof config !== 'object' || config === null) {
        return createInvalidResult('Auto save config must be an object.');
    }
    var cfg = config;
    if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') {
        return createInvalidResult('Auto save enabled must be a boolean.');
    }
    if (cfg.idleSaveEnabled !== undefined && typeof cfg.idleSaveEnabled !== 'boolean') {
        return createInvalidResult('Auto save idleSaveEnabled must be a boolean.');
    }
    if (cfg.interval !== undefined) {
        if (typeof cfg.interval !== 'number' || cfg.interval <= 0 || !Number.isFinite(cfg.interval)) {
            return createInvalidResult('Auto save interval must be a positive finite number.');
        }
        if (cfg.interval < 1000) {
            return createInvalidResult('Auto save interval cannot be less than 1000ms.');
        }
        if (cfg.interval > 300000) {
            return createInvalidResult('Auto save interval cannot be greater than 300000ms.');
        }
    }
    if (cfg.fallbackIntervalMs !== undefined) {
        if (typeof cfg.fallbackIntervalMs !== 'number' || cfg.fallbackIntervalMs <= 0 || !Number.isFinite(cfg.fallbackIntervalMs)) {
            return createInvalidResult('Auto save fallbackIntervalMs must be a positive finite number.');
        }
        if (cfg.fallbackIntervalMs < 60000) {
            return createInvalidResult('Auto save fallbackIntervalMs cannot be less than 60000ms.');
        }
        if (cfg.fallbackIntervalMs > 3600000) {
            return createInvalidResult('Auto save fallbackIntervalMs cannot be greater than 3600000ms.');
        }
    }
    if (cfg.debounceMs !== undefined) {
        if (typeof cfg.debounceMs !== 'number' || cfg.debounceMs <= 0 || !Number.isFinite(cfg.debounceMs)) {
            return createInvalidResult('Auto save debounceMs must be a positive finite number.');
        }
        if (cfg.debounceMs > 10000) {
            return createInvalidResult('Auto save debounceMs cannot be greater than 10000ms.');
        }
    }
    return createValidResult();
}
export function validateConnectionStyle(style) {
    if (typeof style !== 'object' || style === null) {
        return createInvalidResult('Connection style must be an object.');
    }
    var s = style;
    if (s.type !== undefined && s.type !== 'bezier' && s.type !== 'straight' && s.type !== 'step') {
        return createInvalidResult('Connection style type must be bezier, straight, or step.');
    }
    if (s.animated !== undefined && typeof s.animated !== 'boolean') {
        return createInvalidResult('Connection style animated must be a boolean.');
    }
    if (s.color !== undefined && (typeof s.color !== 'string' || !isValidColor(s.color))) {
        return createInvalidResult('Connection style color must be a valid color string.');
    }
    if (s.strokeWidth !== undefined) {
        if (typeof s.strokeWidth !== 'number' || s.strokeWidth <= 0 || !Number.isFinite(s.strokeWidth)) {
            return createInvalidResult('Connection style strokeWidth must be a positive finite number.');
        }
        if (s.strokeWidth > 20) {
            return createInvalidResult('Connection style strokeWidth cannot be greater than 20.');
        }
    }
    return createValidResult();
}
export function isValidColor(color) {
    return COLOR_HEX_PATTERN.test(color) || COLOR_RGB_PATTERN.test(color) || COLOR_RGBA_PATTERN.test(color);
}
export function validateLayoutConfig(config) {
    if (typeof config !== 'object' || config === null) {
        return createInvalidResult('Layout config must be an object.');
    }
    var cfg = config;
    if (cfg.type !== undefined && cfg.type !== 'grid' && cfg.type !== 'smart' && cfg.type !== 'force-directed') {
        return createInvalidResult('Layout type must be grid, smart, or force-directed.');
    }
    if (cfg.spacing !== undefined) {
        if (typeof cfg.spacing !== 'number' || cfg.spacing < 0 || !Number.isFinite(cfg.spacing)) {
            return createInvalidResult('Layout spacing must be a non-negative finite number.');
        }
        if (cfg.spacing > 500) {
            return createInvalidResult('Layout spacing cannot be greater than 500.');
        }
    }
    if (cfg.padding !== undefined && (typeof cfg.padding !== 'number' || cfg.padding < 0 || !Number.isFinite(cfg.padding))) {
        return createInvalidResult('Layout padding must be a non-negative finite number.');
    }
    return createValidResult();
}
export function validateWorkflowName(name) {
    if (typeof name !== 'string') {
        return createInvalidResult('Workflow name must be a string.');
    }
    if (name.length === 0) {
        return createInvalidResult('Workflow name cannot be empty.');
    }
    if (name.length > 200) {
        return createInvalidResult('Workflow name cannot exceed 200 characters.');
    }
    return createValidResult();
}
export function validateWorkflow(workflow) {
    var _a, _b;
    if (typeof workflow !== 'object' || workflow === null) {
        return createInvalidResult('Workflow must be an object.');
    }
    var legacyMetadata = workflow.metadata;
    if (legacyMetadata && 'relatedTaskIds' in legacyMetadata) {
        return createInvalidResult('Workflow metadata relatedTaskIds is no longer supported. Use relatedTasks.');
    }
    if (hasInvalidRawRelatedTasks(workflow)) {
        return createInvalidResult('Workflow metadata relatedTasks must contain valid task references only.');
    }
    var wf = normalizeWorkflowData(workflow);
    if (typeof wf.id !== 'string' || wf.id.length === 0) {
        return createInvalidResult('Workflow id must be a non-empty string.');
    }
    if (typeof wf.projectId !== 'string' || wf.projectId.length === 0) {
        return createInvalidResult('Workflow projectId must be a non-empty string.');
    }
    var nameResult = validateWorkflowName(wf.name);
    if (!nameResult.valid) {
        return nameResult;
    }
    if (typeof wf.nodes !== 'object' || wf.nodes === null) {
        return createInvalidResult('Workflow nodes must be an object.');
    }
    if (!Array.isArray(wf.connections)) {
        return createInvalidResult('Workflow connections must be an array.');
    }
    var nodesById = new Map(Object.entries(wf.nodes));
    var nodes = Object.values(wf.nodes);
    for (var i = 0; i < nodes.length; i++) {
        var nodeResult = validateNodeData(nodes[i]);
        if (!nodeResult.valid) {
            return createInvalidResult("nodes[".concat(i, "] validation failed: ").concat(nodeResult.message));
        }
    }
    for (var i = 0; i < wf.connections.length; i++) {
        var connection = wf.connections[i];
        var connectionResult = validateConnection(connection);
        if (!connectionResult.valid) {
            return createInvalidResult("connections[".concat(i, "] validation failed: ").concat(connectionResult.message));
        }
        var sourceNode = nodesById.get(connection.sourceId);
        var targetNode = nodesById.get(connection.targetId);
        if (!sourceNode) {
            return createInvalidResult("connections[".concat(i, "] references a missing source node."));
        }
        if (!targetNode) {
            return createInvalidResult("connections[".concat(i, "] references a missing target node."));
        }
        if (connection.type === 'file-reference' && isAINodeData(targetNode) && targetNode.type === 'aiImageGen') {
            var groupHandles = new Set(ensureAIImageInputGroups(targetNode.config).map(function (group) { return createGroupPortHandle(group.id, AI_IMAGE_INPUT_PORT_ID); }));
            var normalizedTargetHandle = normalizeAIImageGenInputHandle((_a = connection.targetHandle) !== null && _a !== void 0 ? _a : undefined, targetNode.config);
            if (!isFileNodeData(sourceNode) || sourceNode.type !== 'image') {
                return createInvalidResult("connections[".concat(i, "] can only connect image nodes into AI image generation groups."));
            }
            if (typeof normalizedTargetHandle !== 'string' || !groupHandles.has(normalizedTargetHandle)) {
                return createInvalidResult("connections[".concat(i, "] must target a valid AI image generation input group."));
            }
        }
        if (connection.type === 'file-reference' && isAINodeData(targetNode) && targetNode.type !== 'aiImageGen') {
            if (!isFileNodeData(sourceNode)) {
                return createInvalidResult("connections[".concat(i, "] current stage only allows file nodes to connect into AI nodes."));
            }
        }
        if (connection.type === 'file-reference' && isAINodeData(targetNode) && targetNode.type === 'aiImageInpaint') {
            if (!isFileNodeData(sourceNode) || sourceNode.type !== 'image') {
                return createInvalidResult("connections[".concat(i, "] can only connect one image node into AI image inpaint."));
            }
            if (connection.targetHandle !== getAIImageInpaintInputHandle()) {
                return createInvalidResult("connections[".concat(i, "] must target the AI image inpaint source image handle."));
            }
        }
        if (connection.type === 'output-link' && isAINodeData(sourceNode) && sourceNode.type === 'aiImageGen') {
            var groupHandles = new Set(ensureAIImageInputGroups(sourceNode.config).map(function (group) { return createGroupPortHandle(group.id, AI_IMAGE_RESULT_PORT_ID); }));
            var normalizedSourceHandle = normalizeAIImageGenOutputHandle((_b = connection.sourceHandle) !== null && _b !== void 0 ? _b : undefined, sourceNode.config);
            if (!isFileNodeData(targetNode) || targetNode.type !== 'image') {
                return createInvalidResult("connections[".concat(i, "] AI image generation outputs must point to image nodes."));
            }
            if (typeof normalizedSourceHandle !== 'string' || !groupHandles.has(normalizedSourceHandle)) {
                return createInvalidResult("connections[".concat(i, "] AI image generation outputs must bind to a valid group handle."));
            }
        }
        if (connection.type === 'output-link' && isAINodeData(sourceNode) && sourceNode.type === 'aiImageInpaint') {
            if (!isFileNodeData(targetNode) || targetNode.type !== 'image') {
                return createInvalidResult("connections[".concat(i, "] AI image inpaint outputs must point to image nodes."));
            }
            if (connection.sourceHandle !== getAIImageInpaintOutputHandle()) {
                return createInvalidResult("connections[".concat(i, "] AI image inpaint outputs must bind to the result handle."));
            }
        }
    }
    var _loop_1 = function (node) {
        if (isAINodeData(node) && node.type === 'aiImageInpaint') {
            var groups_2 = ensureAIImageInputGroups(node.config);
            if (groups_2.length !== 1 ||
                groups_2[0].id !== AI_IMAGE_INPAINT_GROUP_ID ||
                groups_2[0].order !== 0) {
                return { value: createInvalidResult("AI image inpaint node ".concat(node.id.display, " must contain exactly one fixed input group.")) };
            }
            var incomingConnections_1 = wf.connections.filter(function (connection) {
                return connection.type === 'file-reference' &&
                    connection.targetId === node.id.value &&
                    connection.targetHandle === createGroupPortHandle(AI_IMAGE_INPAINT_GROUP_ID, AI_IMAGE_INPAINT_INPUT_PORT_ID);
            });
            if (incomingConnections_1.length > 1) {
                return { value: createInvalidResult("AI image inpaint node ".concat(node.id.display, " cannot contain more than one source image.")) };
            }
            var sourceIds = incomingConnections_1.map(function (connection) { return connection.sourceId; });
            if (new Set(sourceIds).size !== sourceIds.length) {
                return { value: createInvalidResult("AI image inpaint node ".concat(node.id.display, " contains duplicate image connections.")) };
            }
            var outgoingConnections = wf.connections.filter(function (connection) {
                return connection.type === 'output-link' &&
                    connection.sourceId === node.id.value &&
                    connection.sourceHandle === createGroupPortHandle(AI_IMAGE_INPAINT_GROUP_ID, AI_IMAGE_INPAINT_RESULT_PORT_ID);
            });
            if (outgoingConnections.length > 1) {
                return { value: createInvalidResult("AI image inpaint node ".concat(node.id.display, " cannot bind more than one result output.")) };
            }
            return "continue";
        }
        if (!isAINodeData(node) || node.type !== 'aiImageGen') {
            return "continue";
        }
        var groups = ensureAIImageInputGroups(node.config);
        if (groups.length > 10) {
            return { value: createInvalidResult("AI image generation node ".concat(node.id.display, " cannot contain more than 10 groups.")) };
        }
        var incomingConnections = wf.connections.filter(function (connection) {
            return connection.type === 'file-reference' && connection.targetId === node.id.value;
        });
        var _loop_2 = function (group) {
            var groupHandle = createGroupPortHandle(group.id, AI_IMAGE_INPUT_PORT_ID);
            var groupConnections = incomingConnections.filter(function (connection) { var _a; return normalizeAIImageGenInputHandle((_a = connection.targetHandle) !== null && _a !== void 0 ? _a : undefined, node.config) === groupHandle; });
            if (groupConnections.length > 5) {
                return { value: createInvalidResult("AI image generation node ".concat(node.id.display, " group ").concat(group.label, " cannot contain more than 5 images.")) };
            }
            var sourceIds = groupConnections.map(function (connection) { return connection.sourceId; });
            if (new Set(sourceIds).size !== sourceIds.length) {
                return { value: createInvalidResult("AI image generation node ".concat(node.id.display, " group ").concat(group.label, " contains duplicate image connections.")) };
            }
        };
        for (var _c = 0, groups_1 = groups; _c < groups_1.length; _c++) {
            var group = groups_1[_c];
            var state_2 = _loop_2(group);
            if (typeof state_2 === "object")
                return state_2;
        }
    };
    for (var _i = 0, nodes_1 = nodes; _i < nodes_1.length; _i++) {
        var node = nodes_1[_i];
        var state_1 = _loop_1(node);
        if (typeof state_1 === "object")
            return state_1.value;
    }
    var viewportResult = validateViewport(wf.viewport);
    if (!viewportResult.valid) {
        return viewportResult;
    }
    var metadataResult = validateWorkflowMetadata(wf.metadata);
    if (!metadataResult.valid) {
        return metadataResult;
    }
    return createValidResult();
}
function isValidWorkflowRelatedTaskRef(task) {
    if (typeof task !== 'object' || task === null) {
        return false;
    }
    var candidate = task;
    return (typeof candidate.taskId === 'string' &&
        (candidate.taskNo === undefined || typeof candidate.taskNo === 'string') &&
        (candidate.batchId === undefined || typeof candidate.batchId === 'string') &&
        typeof candidate.nodeId === 'string' &&
        typeof candidate.nodeDisplayId === 'string' &&
        typeof candidate.nodeType === 'string');
}
function validateWorkflowMetadata(metadata) {
    if (typeof metadata !== 'object' || metadata === null) {
        return createInvalidResult('Workflow metadata must be an object.');
    }
    if (typeof metadata.nodeCount !== 'number' || metadata.nodeCount < 0) {
        return createInvalidResult('Workflow metadata nodeCount must be a non-negative number.');
    }
    if (typeof metadata.connectionCount !== 'number' || metadata.connectionCount < 0) {
        return createInvalidResult('Workflow metadata connectionCount must be a non-negative number.');
    }
    if (typeof metadata.lastNodeId !== 'number' || metadata.lastNodeId < 0) {
        return createInvalidResult('Workflow metadata lastNodeId must be a non-negative number.');
    }
    if (typeof metadata.canvasSize !== 'object' || metadata.canvasSize === null) {
        return createInvalidResult('Workflow metadata canvasSize must be an object.');
    }
    if (typeof metadata.canvasSize.width !== 'number' || typeof metadata.canvasSize.height !== 'number') {
        return createInvalidResult('Workflow metadata canvasSize must contain numeric width and height.');
    }
    if (metadata.relatedTasks !== undefined) {
        if (!Array.isArray(metadata.relatedTasks)) {
            return createInvalidResult('Workflow metadata relatedTasks must be an array.');
        }
        if (!metadata.relatedTasks.every(function (task) { return isValidWorkflowRelatedTaskRef(task); })) {
            return createInvalidResult('Workflow metadata relatedTasks must contain valid task references only.');
        }
    }
    return createValidResult();
}
function hasInvalidRawRelatedTasks(workflow) {
    if (typeof workflow !== 'object' || workflow === null) {
        return false;
    }
    var metadata = workflow.metadata;
    if (!metadata || metadata.relatedTasks === undefined) {
        return false;
    }
    if (!Array.isArray(metadata.relatedTasks)) {
        return true;
    }
    return !metadata.relatedTasks.every(function (task) { return isValidWorkflowRelatedTaskRef(task); });
}
export function validateWorkflowState(state) {
    if (typeof state !== 'object' || state === null) {
        return createInvalidResult('Workflow state must be an object.');
    }
    var s = state;
    if (s.current !== null && typeof s.current !== 'object') {
        return createInvalidResult('Workflow state current must be a workflow object or null.');
    }
    if (!Array.isArray(s.history)) {
        return createInvalidResult('Workflow state history must be an array.');
    }
    if (typeof s.historyIndex !== 'number' || s.historyIndex < 0) {
        return createInvalidResult('Workflow state historyIndex must be a non-negative number.');
    }
    if (typeof s.maxHistorySize !== 'number' || s.maxHistorySize <= 0) {
        return createInvalidResult('Workflow state maxHistorySize must be a positive number.');
    }
    if (s.historyIndex > s.history.length) {
        return createInvalidResult('Workflow state historyIndex cannot exceed history length.');
    }
    if (typeof s.isDirty !== 'boolean') {
        return createInvalidResult('Workflow state isDirty must be a boolean.');
    }
    if (typeof s.isSaving !== 'boolean') {
        return createInvalidResult('Workflow state isSaving must be a boolean.');
    }
    return createValidResult();
}
export function validateHistorySize(size, maxSize) {
    if (typeof size !== 'number' || size < 0) {
        return createInvalidResult('History size must be a non-negative number.');
    }
    if (size > maxSize) {
        return createInvalidResult("History size(".concat(size, ") exceeds the maximum limit(").concat(maxSize, ")."));
    }
    return createValidResult();
}
export function canUndo(state) {
    if (!state.current) {
        return createInvalidResult('There is no active workflow.');
    }
    if (state.historyIndex <= 0) {
        return createInvalidResult('There is no operation to undo.');
    }
    return createValidResult();
}
export function canRedo(state) {
    if (!state.current) {
        return createInvalidResult('There is no active workflow.');
    }
    if (state.historyIndex >= state.history.length) {
        return createInvalidResult('There is no operation to redo.');
    }
    return createValidResult();
}
export function validateNodeIdFormat(nodeId) {
    if (typeof nodeId !== 'string' || nodeId.length === 0) {
        return createInvalidResult('Node id must be a non-empty string.');
    }
    if (!/^\d{1,5}$/.test(nodeId)) {
        return createInvalidResult('Node id must be a 1-5 digit number string.');
    }
    var parsed = parseInt(nodeId, 10);
    if (parsed < 1 || parsed > 99999) {
        return createInvalidResult('Node id must be between 1 and 99999.');
    }
    return createValidResult();
}
export function validateNodeIdDisplay(display) {
    if (typeof display !== 'string' || display.length === 0) {
        return createInvalidResult('Node display id must be a non-empty string.');
    }
    if (!/^#\d{5}$/.test(display)) {
        return createInvalidResult('Node display id must use the format #00001.');
    }
    return createValidResult();
}
export function isSimplifiedView(zoom) {
    return zoom < CANVAS_DEFAULTS.simplifyThreshold;
}
export function getDefaultAutoSaveConfig() {
    return __assign({}, AUTO_SAVE_DEFAULTS);
}
export function getDefaultConnectionStyle() {
    return __assign({}, CONNECTION_STYLE_DEFAULTS);
}
