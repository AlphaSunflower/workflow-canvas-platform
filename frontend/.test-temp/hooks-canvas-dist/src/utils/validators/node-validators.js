import { ensureAIImageInputGroups, normalizeAIImageGenInputHandle, normalizeAIImageGenOutputHandle } from '@/utils/node/create';
import { createGroupPortHandle } from '@/nodes/shared/group-port-handle';
import { AI_IMAGE_INPAINT_GROUP_ID, AI_IMAGE_INPAINT_GROUP_LABEL, AI_IMAGE_INPAINT_INPUT_PORT_ID, AI_IMAGE_INPAINT_RESULT_PORT_ID, } from '@/nodes/ai-image-inpaint/groups';
import { MAX_FILE_REFERENCES, MAX_GROUP_FILES, MIN_NODE_SIZE } from '@/constants/file.constants';
import { NODE_TYPE_INFO } from '@/constants/node.constants';
var GROUPED_AI_NODE_TYPES = new Set([
    'aiImageGen',
    'aiImageInpaint',
    'aiImageToPly',
    'aiMultiViewRestore',
    'aiModelRenderTransfer',
    'aiImageHd',
    'aiFloorplanColorize',
]);
export function createValidResult() {
    return { valid: true, message: '' };
}
export function createInvalidResult(message) {
    return { valid: false, message: message };
}
export function isValidNodeType(type) {
    return typeof type === 'string' && type in NODE_TYPE_INFO;
}
export function validateNodeType(type) {
    return isValidNodeType(type) ? createValidResult() : createInvalidResult("Invalid node type: ".concat(String(type)));
}
export function isFileNode(node) {
    return node.type === 'image' || node.type === 'video' || node.type === 'ply';
}
export function isAINode(node) {
    return (node.type === 'aiImageGen' ||
        node.type === 'aiImageInpaint' ||
        node.type === 'aiVideoGen' ||
        node.type === 'aiImageToPly' ||
        node.type === 'aiStoryboard' ||
        node.type === 'aiMultiViewRestore' ||
        node.type === 'aiModelRenderTransfer' ||
        node.type === 'aiImageHd' ||
        node.type === 'aiFloorplanColorize');
}
export function validateNodeId(nodeId) {
    if (typeof nodeId !== 'object' || nodeId === null) {
        return createInvalidResult('Node id must be an object.');
    }
    var id = nodeId;
    if (typeof id.value !== 'string' || id.value.length === 0) {
        return createInvalidResult('Node id.value must be a non-empty string.');
    }
    if (typeof id.display !== 'string' || !id.display.startsWith('#')) {
        return createInvalidResult('Node id.display must start with #.');
    }
    return createValidResult();
}
export function validatePosition(position) {
    if (typeof position !== 'object' || position === null) {
        return createInvalidResult('Position must be an object.');
    }
    var pos = position;
    if (typeof pos.x !== 'number' || typeof pos.y !== 'number') {
        return createInvalidResult('Position must contain numeric x and y.');
    }
    return createValidResult();
}
export function validateDimensions(dimensions) {
    if (typeof dimensions !== 'object' || dimensions === null) {
        return createInvalidResult('Dimensions must be an object.');
    }
    var dim = dimensions;
    if (typeof dim.width !== 'number' || typeof dim.height !== 'number') {
        return createInvalidResult('Dimensions must contain numeric width and height.');
    }
    if (dim.width < MIN_NODE_SIZE || dim.height < MIN_NODE_SIZE) {
        return createInvalidResult("Dimensions cannot be smaller than ".concat(MIN_NODE_SIZE, "px."));
    }
    return createValidResult();
}
export function validateNodeReferences(references) {
    if (!Array.isArray(references)) {
        return createInvalidResult('References must be an array.');
    }
    if (references.length > MAX_FILE_REFERENCES) {
        return createInvalidResult("References cannot exceed ".concat(MAX_FILE_REFERENCES, "."));
    }
    for (var _i = 0, references_1 = references; _i < references_1.length; _i++) {
        var ref = references_1[_i];
        if (!isValidNodeReference(ref)) {
            return createInvalidResult('Invalid node reference.');
        }
    }
    return createValidResult();
}
export function isValidNodeReference(ref) {
    if (typeof ref !== 'object' || ref === null) {
        return false;
    }
    var candidate = ref;
    return (typeof candidate.id === 'string' &&
        typeof candidate.nodeId === 'string' &&
        typeof candidate.fileId === 'string' &&
        (candidate.type === 'single' || candidate.type === 'group') &&
        typeof candidate.order === 'number');
}
function isValidNodeTaskRef(task) {
    if (typeof task !== 'object' || task === null) {
        return false;
    }
    var candidate = task;
    return (typeof candidate.taskId === 'string' &&
        (candidate.taskNo === undefined || typeof candidate.taskNo === 'string') &&
        (candidate.batchId === undefined || typeof candidate.batchId === 'string') &&
        (candidate.runId === undefined || typeof candidate.runId === 'string') &&
        (candidate.runNo === undefined || typeof candidate.runNo === 'string') &&
        (candidate.scope === 'node' || candidate.scope === 'group') &&
        (candidate.groupId === undefined || typeof candidate.groupId === 'string') &&
        (candidate.groupLabel === undefined || typeof candidate.groupLabel === 'string') &&
        (candidate.groupOrder === undefined || typeof candidate.groupOrder === 'number') &&
        (candidate.status === 'queued' ||
            candidate.status === 'processing' ||
            candidate.status === 'completed' ||
            candidate.status === 'failed' ||
            candidate.status === 'cancelled') &&
        typeof candidate.createdAt === 'number' &&
        (candidate.startedAt === undefined || typeof candidate.startedAt === 'number') &&
        (candidate.completedAt === undefined || typeof candidate.completedAt === 'number'));
}
function isValidFileSource(source) {
    if (typeof source !== 'object' || source === null) {
        return false;
    }
    var candidate = source;
    if (candidate.type === 'imported') {
        var localSource = candidate.localSource;
        return ((candidate.importMethod === undefined || candidate.importMethod === 'local') &&
            (candidate.sourceDisplayName === undefined || typeof candidate.sourceDisplayName === 'string') &&
            (localSource === undefined ||
                (typeof localSource === 'object' &&
                    localSource !== null &&
                    (localSource.status === 'runtime-only' ||
                        localSource.status === 'available' ||
                        localSource.status === 'linked' ||
                        localSource.status === 'permission-required' ||
                        localSource.status === 'missing' ||
                        localSource.status === 'unknown') &&
                    (localSource.referenceId === undefined || typeof localSource.referenceId === 'string') &&
                    (localSource.kind === undefined ||
                        localSource.kind === 'runtime' ||
                        localSource.kind === 'file-system-access' ||
                        localSource.kind === 'unknown') &&
                    (localSource.permissionState === undefined ||
                        localSource.permissionState === 'granted' ||
                        localSource.permissionState === 'prompt' ||
                        localSource.permissionState === 'denied') &&
                    (localSource.lastResolvedAt === undefined || typeof localSource.lastResolvedAt === 'number'))) &&
            (candidate.originalPath === undefined || typeof candidate.originalPath === 'string') &&
            (candidate.importedAt === undefined || typeof candidate.importedAt === 'number') &&
            (candidate.uploadedBy === undefined || typeof candidate.uploadedBy === 'string'));
    }
    if (candidate.type === 'node-output') {
        return (typeof candidate.producerNodeId === 'string' &&
            typeof candidate.producerNodeDisplayId === 'string' &&
            typeof candidate.producerNodeType === 'string' &&
            typeof candidate.taskId === 'string' &&
            typeof candidate.taskNo === 'string' &&
            typeof candidate.taskCreatedAt === 'number' &&
            (candidate.taskStartedAt === undefined || typeof candidate.taskStartedAt === 'number') &&
            (candidate.taskCompletedAt === undefined || typeof candidate.taskCompletedAt === 'number'));
    }
    return false;
}
export function validateFileGroup(group) {
    if (typeof group !== 'object' || group === null) {
        return createInvalidResult('File group must be an object.');
    }
    var candidate = group;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
        return createInvalidResult('File group id must be a non-empty string.');
    }
    if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
        return createInvalidResult('File group name must be a non-empty string.');
    }
    if (!Array.isArray(candidate.fileIds)) {
        return createInvalidResult('File group fileIds must be an array.');
    }
    if (candidate.fileIds.length > MAX_GROUP_FILES) {
        return createInvalidResult("File group cannot exceed ".concat(MAX_GROUP_FILES, " files."));
    }
    return createValidResult();
}
export function validateNodeData(data) {
    if (typeof data !== 'object' || data === null) {
        return createInvalidResult('Node data must be an object.');
    }
    var node = data;
    var typeResult = validateNodeType(node.type);
    if (!typeResult.valid)
        return typeResult;
    var idResult = validateNodeId(node.id);
    if (!idResult.valid)
        return idResult;
    var positionResult = validatePosition(node.position);
    if (!positionResult.valid)
        return positionResult;
    var dimensionsResult = validateDimensions(node.dimensions);
    if (!dimensionsResult.valid)
        return dimensionsResult;
    if (typeof node.rotation !== 'number') {
        return createInvalidResult('Rotation must be a number.');
    }
    if (typeof node.scale !== 'number' || node.scale <= 0) {
        return createInvalidResult('Scale must be a positive number.');
    }
    if (typeof node.locked !== 'boolean') {
        return createInvalidResult('Locked must be a boolean.');
    }
    if (typeof node.zIndex !== 'number') {
        return createInvalidResult('zIndex must be a number.');
    }
    if (isFileNode(node)) {
        var fileNode = node;
        if (typeof fileNode.fileId !== 'string' || fileNode.fileId.length === 0) {
            return createInvalidResult('File node must contain fileId.');
        }
        if (typeof fileNode.fileName !== 'string' || fileNode.fileName.length === 0) {
            return createInvalidResult('File node must contain fileName.');
        }
        if (typeof fileNode.fileSize !== 'number' || fileNode.fileSize < 0) {
            return createInvalidResult('File size must be a non-negative number.');
        }
        if (typeof fileNode.source !== 'object' || fileNode.source === null) {
            return createInvalidResult('File node must contain source.');
        }
        if (!isValidFileSource(fileNode.source)) {
            return createInvalidResult('File node source must be a valid imported or node-output source.');
        }
    }
    if (isAINode(node)) {
        var aiNode = node;
        var refResult = validateNodeReferences(aiNode.references);
        if (!refResult.valid)
            return refResult;
        if (!Array.isArray(aiNode.outputs)) {
            return createInvalidResult('AI node outputs must be an array.');
        }
        if (!aiNode.outputs.every(function (item) { return typeof item === 'string'; })) {
            return createInvalidResult('AI node outputs must contain strings only.');
        }
        if (!Array.isArray(aiNode.tasks)) {
            return createInvalidResult('AI node tasks must be an array.');
        }
        if (!aiNode.tasks.every(function (item) { return isValidNodeTaskRef(item); })) {
            return createInvalidResult('AI node tasks must contain valid task references only.');
        }
        if (typeof aiNode.config !== 'object' || aiNode.config === null) {
            return createInvalidResult('AI node config must be an object.');
        }
        var config = aiNode.config;
        var numericConfigRules = [
            { key: 'steps', min: 0 },
            { key: 'seed', min: 0 },
            { key: 'width', min: 1 },
            { key: 'height', min: 1 },
            { key: 'cfgScale', min: 0 },
            { key: 'outputCount', min: 1 },
            { key: 'strength', min: 0, max: 1 },
            { key: 'denoise', min: 0, max: 1 },
            { key: 'cameraCount', min: 1 },
            { key: 'fps', min: 1 },
            { key: 'duration', min: 1 },
        ];
        if (config.model !== undefined && typeof config.model !== 'string') {
            return createInvalidResult('AI node config.model must be a string.');
        }
        if (config.prompt !== undefined && typeof config.prompt !== 'string') {
            return createInvalidResult('AI node config.prompt must be a string.');
        }
        if (config.negativePrompt !== undefined && typeof config.negativePrompt !== 'string') {
            return createInvalidResult('AI node config.negativePrompt must be a string.');
        }
        if (config.aspectRatio !== undefined && typeof config.aspectRatio !== 'string') {
            return createInvalidResult('AI node config.aspectRatio must be a string.');
        }
        if (config.resolutionPreset !== undefined && typeof config.resolutionPreset !== 'string') {
            return createInvalidResult('AI node config.resolutionPreset must be a string.');
        }
        for (var _i = 0, numericConfigRules_1 = numericConfigRules; _i < numericConfigRules_1.length; _i++) {
            var rule = numericConfigRules_1[_i];
            var value = config[rule.key];
            if (value === undefined) {
                continue;
            }
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return createInvalidResult("AI node config.".concat(rule.key, " must be a finite number."));
            }
            if (value < rule.min) {
                return createInvalidResult("AI node config.".concat(rule.key, " must be greater than or equal to ").concat(rule.min, "."));
            }
            if (rule.max !== undefined && value > rule.max) {
                return createInvalidResult("AI node config.".concat(rule.key, " must be less than or equal to ").concat(rule.max, "."));
            }
        }
        if (aiNode.type && GROUPED_AI_NODE_TYPES.has(aiNode.type)) {
            var inputGroups = ensureAIImageInputGroups(aiNode.config);
            if (inputGroups.length === 0) {
                return createInvalidResult("".concat(aiNode.type, " requires at least one input group."));
            }
            if (inputGroups.length > 10) {
                return createInvalidResult("".concat(aiNode.type, " cannot exceed 10 input groups."));
            }
            var groupIds = new Set();
            for (var _a = 0, inputGroups_1 = inputGroups; _a < inputGroups_1.length; _a++) {
                var group = inputGroups_1[_a];
                if (typeof group.id !== 'string' || group.id.length === 0) {
                    return createInvalidResult("".concat(aiNode.type, " input group id must be a non-empty string."));
                }
                if (typeof group.label !== 'string' || group.label.length === 0) {
                    return createInvalidResult("".concat(aiNode.type, " input group label must be a non-empty string."));
                }
                if (typeof group.order !== 'number' || !Number.isFinite(group.order)) {
                    return createInvalidResult("".concat(aiNode.type, " input group order must be a finite number."));
                }
                if (groupIds.has(group.id)) {
                    return createInvalidResult("".concat(aiNode.type, " input group ids must be unique."));
                }
                groupIds.add(group.id);
                if (aiNode.type === 'aiImageGen') {
                    var normalizedInputHandle = normalizeAIImageGenInputHandle(group.id, aiNode.config);
                    var normalizedOutputHandle = normalizeAIImageGenOutputHandle(group.id, aiNode.config);
                    if (normalizedInputHandle !== createGroupPortHandle(group.id, 'images')) {
                        return createInvalidResult('AI image generation input group handle normalization failed.');
                    }
                    if (normalizedOutputHandle !== createGroupPortHandle(group.id, 'result')) {
                        return createInvalidResult('AI image generation output group handle normalization failed.');
                    }
                }
            }
            if (aiNode.type === 'aiImageInpaint') {
                if (inputGroups.length !== 1) {
                    return createInvalidResult('aiImageInpaint requires exactly one input group.');
                }
                var group = inputGroups[0];
                if (group.id !== AI_IMAGE_INPAINT_GROUP_ID ||
                    group.label !== AI_IMAGE_INPAINT_GROUP_LABEL ||
                    group.order !== 0) {
                    return createInvalidResult('aiImageInpaint input group must be the fixed main group.');
                }
                if (createGroupPortHandle(group.id, AI_IMAGE_INPAINT_INPUT_PORT_ID) !== 'main:image' ||
                    createGroupPortHandle(group.id, AI_IMAGE_INPAINT_RESULT_PORT_ID) !== 'main:result') {
                    return createInvalidResult('aiImageInpaint handle normalization failed.');
                }
            }
        }
    }
    return createValidResult();
}
export function validateNodeCount(count, maxCount) {
    if (typeof count !== 'number' || count < 0) {
        return createInvalidResult('Node count must be a non-negative number.');
    }
    if (count > maxCount) {
        return createInvalidResult("Node count ".concat(count, " exceeds maximum ").concat(maxCount, "."));
    }
    return createValidResult();
}
export function validateNodeRotation(rotation) {
    if (typeof rotation !== 'number' || !Number.isFinite(rotation)) {
        return createInvalidResult('Rotation must be a finite number.');
    }
    return createValidResult();
}
export function validateNodeScale(scale) {
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
        return createInvalidResult('Scale must be a positive finite number.');
    }
    return createValidResult();
}
export function validateNodeZIndex(zIndex) {
    if (typeof zIndex !== 'number' || !Number.isFinite(zIndex) || zIndex < 0) {
        return createInvalidResult('zIndex must be a non-negative finite number.');
    }
    return createValidResult();
}
export function canAddReference(currentCount) {
    if (currentCount >= MAX_FILE_REFERENCES) {
        return createInvalidResult("Reached maximum reference limit ".concat(MAX_FILE_REFERENCES, "."));
    }
    return createValidResult();
}
export function canAddToGroup(currentCount) {
    if (currentCount >= MAX_GROUP_FILES) {
        return createInvalidResult("Reached maximum file group limit ".concat(MAX_GROUP_FILES, "."));
    }
    return createValidResult();
}
export function validateNodeLocked(node, operation) {
    if (node.locked) {
        return createInvalidResult("Node is locked and cannot perform ".concat(operation, "."));
    }
    return createValidResult();
}
