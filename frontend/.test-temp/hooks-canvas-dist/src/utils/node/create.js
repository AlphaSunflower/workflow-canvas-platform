/**
 * Node creation utilities.
 * @module utils/node/create
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
import { createEmptyImageAsset } from '@/services/image/image-asset';
import { createLocalImportFileSource } from '@/services/file/file-service';
import { PREVIEW_SIZE_1080P, MAX_FILE_REFERENCES, MAX_GROUP_FILES } from '@/constants/file.constants';
import { createGroupPortHandle, parseGroupPortHandle } from '@/nodes/shared/group-port-handle';
import { AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT, AI_IMAGE_INPAINT_DEFAULT_SIZE, } from '@/nodes/ai-image-inpaint/constants';
import { isAINodeData } from './type-guards';
var DEFAULT_NODE_CREATION_SCALE = 2;
var DEFAULT_NODE_CREATION_AREA_SCALE = DEFAULT_NODE_CREATION_SCALE * DEFAULT_NODE_CREATION_SCALE;
function scaleNodeCreationDimensions(dimensions) {
    return {
        width: Math.max(1, Math.round(dimensions.width * DEFAULT_NODE_CREATION_SCALE)),
        height: Math.max(1, Math.round(dimensions.height * DEFAULT_NODE_CREATION_SCALE)),
    };
}
var DEFAULT_FILE_NODE_BASE_DIMENSIONS = {
    width: Math.max(220, PREVIEW_SIZE_1080P.width + 100),
    height: Math.max(160, PREVIEW_SIZE_1080P.height + 92),
};
var DEFAULT_MEDIA_NODE_ASPECT_RATIO = PREVIEW_SIZE_1080P.width / PREVIEW_SIZE_1080P.height;
var DEFAULT_FILE_NODE_DIMENSIONS = scaleNodeCreationDimensions(DEFAULT_FILE_NODE_BASE_DIMENSIONS);
var DEFAULT_MEDIA_NODE_AREA = DEFAULT_FILE_NODE_BASE_DIMENSIONS.width * DEFAULT_FILE_NODE_BASE_DIMENSIONS.height * DEFAULT_NODE_CREATION_AREA_SCALE;
var DEFAULT_AI_IMAGE_MODEL = 'gpt-image-2-vip';
var DEFAULT_AI_IMAGE_ASPECT_RATIO = '1:1';
var DEFAULT_AI_IMAGE_RESOLUTION = '1024x1024';
var DEFAULT_AI_IMAGE_SIZE = '1K';
var DEFAULT_STORYBOARD_VIEW_MODE = 'list';
var DEFAULT_STORYBOARD_IMAGE_MODEL = 'gpt-image-2-vip';
var DEFAULT_STORYBOARD_IMAGE_ASPECT_RATIO = '1:1';
var DEFAULT_STORYBOARD_IMAGE_SIZE = DEFAULT_AI_IMAGE_SIZE;
var DEFAULT_STORYBOARD_VIDEO_MODEL = 'veo-3.1-landscape-fast-fl';
var DEFAULT_STORYBOARD_VIDEO_DURATION = 8;
var DEFAULT_STORYBOARD_VIDEO_ASPECT_RATIO = '16:9';
var DEFAULT_STORYBOARD_VIDEO_RESOLUTION = '720P';
var DEFAULT_AI_GROUP_LIMIT = 10;
var AI_IMAGE_INPUT_PORT_ID = 'images';
var AI_IMAGE_RESULT_PORT_ID = 'result';
function createAIConfigSuperset(overrides) {
    if (overrides === void 0) { overrides = {}; }
    return __assign({ model: DEFAULT_AI_IMAGE_MODEL, prompt: '', negativePrompt: '', steps: 30, seed: 0, width: 1024, height: 1024, cfgScale: 7, sampler: 'default', aspectRatio: DEFAULT_AI_IMAGE_ASPECT_RATIO, imageSize: DEFAULT_AI_IMAGE_SIZE, resolutionPreset: DEFAULT_AI_IMAGE_RESOLUTION, outputCount: 1, strength: 0.75, denoise: 0.5, cameraCount: 4, textureQuality: 'high', fps: 24, duration: 4 }, overrides);
}
function createDefaultStoryboardConfig() {
    return {
        shots: [],
        viewMode: DEFAULT_STORYBOARD_VIEW_MODE,
        defaultImageModel: DEFAULT_STORYBOARD_IMAGE_MODEL,
        defaultImageAspectRatio: DEFAULT_STORYBOARD_IMAGE_ASPECT_RATIO,
        defaultImageSize: DEFAULT_STORYBOARD_IMAGE_SIZE,
        batchVideoModel: DEFAULT_STORYBOARD_VIDEO_MODEL,
        batchVideoDuration: DEFAULT_STORYBOARD_VIDEO_DURATION,
        batchVideoAspectRatio: DEFAULT_STORYBOARD_VIDEO_ASPECT_RATIO,
        batchVideoResolution: DEFAULT_STORYBOARD_VIDEO_RESOLUTION,
        processedInputFileIds: [],
        inputGroups: [createAIImageInputGroup(0)],
    };
}
export function createAIImageInputGroup(order, id) {
    if (id === void 0) { id = "group-".concat(order + 1); }
    return {
        id: id,
        label: "Group ".concat(order + 1),
        order: order,
    };
}
export function createDefaultAIInputGroups(count) {
    if (count === void 0) { count = DEFAULT_AI_GROUP_LIMIT; }
    return Array.from({ length: Math.max(0, count) }, function (_, index) { return createAIImageInputGroup(index); });
}
export function ensureAIImageInputGroups(config) {
    var rawGroups = Array.isArray(config === null || config === void 0 ? void 0 : config.inputGroups) ? config.inputGroups : [];
    if (rawGroups.length === 0) {
        return [createAIImageInputGroup(0)];
    }
    return rawGroups.map(function (group, index) { return ({
        id: typeof group.id === 'string' && group.id.length > 0 ? group.id : "group-".concat(index + 1),
        label: typeof group.label === 'string' && group.label.length > 0 ? group.label : "Group ".concat(index + 1),
        order: typeof group.order === 'number' && Number.isFinite(group.order) ? group.order : index,
    }); });
}
export function normalizeAIImageGenInputHandle(handle, config) {
    var _a;
    var defaultGroupId = (_a = ensureAIImageInputGroups(config)[0]) === null || _a === void 0 ? void 0 : _a.id;
    if (!handle) {
        return defaultGroupId ? createGroupPortHandle(defaultGroupId, AI_IMAGE_INPUT_PORT_ID) : undefined;
    }
    var parsedHandle = parseGroupPortHandle(handle);
    if (parsedHandle) {
        return parsedHandle.portId === AI_IMAGE_INPUT_PORT_ID
            ? handle
            : createGroupPortHandle(parsedHandle.groupId, AI_IMAGE_INPUT_PORT_ID);
    }
    return createGroupPortHandle(handle, AI_IMAGE_INPUT_PORT_ID);
}
export function normalizeAIImageGenOutputHandle(handle, config) {
    var _a;
    var defaultGroupId = (_a = ensureAIImageInputGroups(config)[0]) === null || _a === void 0 ? void 0 : _a.id;
    if (!handle) {
        return defaultGroupId ? createGroupPortHandle(defaultGroupId, AI_IMAGE_RESULT_PORT_ID) : undefined;
    }
    var parsedHandle = parseGroupPortHandle(handle);
    if (parsedHandle) {
        return parsedHandle.portId === AI_IMAGE_RESULT_PORT_ID
            ? handle
            : createGroupPortHandle(parsedHandle.groupId, AI_IMAGE_RESULT_PORT_ID);
    }
    return createGroupPortHandle(handle, AI_IMAGE_RESULT_PORT_ID);
}
export function ensureFixedAIInputGroups(config, count) {
    if (count === void 0) { count = DEFAULT_AI_GROUP_LIMIT; }
    var normalized = ensureAIImageInputGroups(config);
    return Array.from({ length: Math.max(0, count) }, function (_, index) {
        var _a, _b;
        var existing = normalized[index];
        return {
            id: (_a = existing === null || existing === void 0 ? void 0 : existing.id) !== null && _a !== void 0 ? _a : "group-".concat(index + 1),
            label: (_b = existing === null || existing === void 0 ? void 0 : existing.label) !== null && _b !== void 0 ? _b : "Group ".concat(index + 1),
            order: index,
        };
    });
}
export function calculateFileNodeDimensions(fileType, metadata, targetArea) {
    if (metadata === void 0) { metadata = {}; }
    if (targetArea === void 0) { targetArea = DEFAULT_MEDIA_NODE_AREA; }
    if (fileType === 'ply') {
        return __assign({}, DEFAULT_FILE_NODE_DIMENSIONS);
    }
    var safeArea = Math.max(targetArea, 1);
    var hasValidSize = typeof metadata.width === 'number' &&
        metadata.width > 0 &&
        typeof metadata.height === 'number' &&
        metadata.height > 0;
    var sourceWidth = hasValidSize ? metadata.width : PREVIEW_SIZE_1080P.width;
    var sourceHeight = hasValidSize ? metadata.height : PREVIEW_SIZE_1080P.height;
    var aspectRatio = sourceWidth / sourceHeight || DEFAULT_MEDIA_NODE_ASPECT_RATIO;
    return {
        width: Math.max(1, Math.round(Math.sqrt(safeArea * aspectRatio))),
        height: Math.max(1, Math.round(Math.sqrt(safeArea / aspectRatio))),
    };
}
export function buildFileNodeMediaLayoutPatch(fileNode, width, height, duration) {
    if (width <= 0 || height <= 0) {
        return null;
    }
    var currentArea = Math.max(fileNode.dimensions.width * fileNode.dimensions.height, 1);
    var nextDimensions = calculateFileNodeDimensions(fileNode.type, { width: width, height: height }, currentArea);
    var normalizedDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? duration
        : undefined;
    var shouldUpdateDimensions = nextDimensions.width !== fileNode.dimensions.width ||
        nextDimensions.height !== fileNode.dimensions.height;
    var shouldUpdateMetadata = fileNode.metadata.width !== width ||
        fileNode.metadata.height !== height ||
        (normalizedDuration !== undefined && fileNode.metadata.duration !== normalizedDuration);
    if (!shouldUpdateDimensions && !shouldUpdateMetadata) {
        return null;
    }
    return __assign(__assign({}, (shouldUpdateDimensions ? { dimensions: nextDimensions } : {})), (shouldUpdateMetadata
        ? {
            metadata: __assign(__assign(__assign({}, fileNode.metadata), { width: width, height: height }), (normalizedDuration !== undefined ? { duration: normalizedDuration } : {})),
        }
        : {}));
}
export function createDefaultFileNodeData(id, position, fileType, fileId, fileName, fileSize, mimeType, metadata, source) {
    if (metadata === void 0) { metadata = {}; }
    var now = Date.now();
    var resolvedSource = source !== null && source !== void 0 ? source : createLocalImportFileSource({
        sourceDisplayName: fileName,
        localSource: {
            status: 'runtime-only',
        },
        importedAt: now,
    });
    return {
        id: id,
        type: fileType,
        position: position,
        dimensions: calculateFileNodeDimensions(fileType, metadata),
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 0,
        timestamp: { created: now, updated: now },
        fileId: fileId,
        fileName: fileName,
        fileSize: fileSize,
        mimeType: mimeType,
        source: resolvedSource,
        imageAsset: fileType === 'image' ? createEmptyImageAsset(fileId, metadata) : undefined,
        metadata: metadata,
    };
}
export function createSequentialNodeId(sequence) {
    return {
        value: String(sequence),
        display: "#".concat(String(sequence).padStart(5, '0')),
    };
}
export function createDefaultAINodeData(id, position, aiType) {
    var now = Date.now();
    var defaultDimensions = aiType === 'aiImageInpaint'
        ? __assign({}, AI_IMAGE_INPAINT_DEFAULT_SIZE) : scaleNodeCreationDimensions({ width: 320, height: 296 });
    return {
        id: id,
        type: aiType,
        position: position,
        dimensions: defaultDimensions,
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 0,
        timestamp: { created: now, updated: now },
        references: [],
        outputs: [],
        config: getDefaultAIConfig(aiType),
        tasks: [],
    };
}
export function canAddReferenceToNode(node) {
    if (!isAINodeData(node)) {
        return false;
    }
    return node.references.length < MAX_FILE_REFERENCES;
}
export function getReferenceCount(node) {
    if (!isAINodeData(node)) {
        return 0;
    }
    return node.references.length;
}
export function getRemainingReferenceSlots(node) {
    if (!isAINodeData(node)) {
        return 0;
    }
    return Math.max(0, MAX_FILE_REFERENCES - node.references.length);
}
export function createNodeReference(nodeId, fileId, type, order) {
    if (type === void 0) { type = 'single'; }
    if (order === void 0) { order = 0; }
    return {
        id: "ref-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 11)),
        nodeId: nodeId,
        fileId: fileId,
        type: type,
        order: order,
    };
}
export function createFileGroup(name, fileIds) {
    var limitedFileIds = fileIds.slice(0, MAX_GROUP_FILES);
    return {
        id: "group-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 11)),
        name: name,
        fileIds: limitedFileIds,
    };
}
export function getDefaultAIConfig(type) {
    var _a;
    var defaults = {
        aiImageGen: createAIConfigSuperset({
            quality: 'auto',
            inputGroups: [createAIImageInputGroup(0)],
        }),
        aiImageInpaint: createAIConfigSuperset({
            aspectRatio: DEFAULT_AI_IMAGE_ASPECT_RATIO,
            imageSize: DEFAULT_AI_IMAGE_SIZE,
            editorHeight: AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
            maskMode: 'original-markup',
            hasMaskMarks: false,
            maskStrokes: [],
            maskSourceFileId: undefined,
            maskSourceWidth: undefined,
            maskSourceHeight: undefined,
            inputGroups: [{ id: 'main', label: '原图', order: 0 }],
        }),
        aiVideoGen: createAIConfigSuperset({
            model: 'veo-3.1-landscape-fast-fl',
            duration: 8,
            fps: undefined,
            aspectRatio: undefined,
            imageSize: undefined,
            camera: undefined,
            lighting: undefined,
            inputGroups: [createAIImageInputGroup(0)],
        }),
        aiImageToPly: createAIConfigSuperset({
            model: 'meshy-ai',
            textureQuality: 'high',
            cameraCount: 4,
            inputGroups: createDefaultAIInputGroups(),
        }),
        aiStoryboard: createDefaultStoryboardConfig(),
        aiMultiViewRestore: createAIConfigSuperset({
            steps: 20,
            denoise: 0.35,
            inputGroups: createDefaultAIInputGroups(),
        }),
        aiModelRenderTransfer: createAIConfigSuperset({
            steps: 30,
            strength: 0.8,
            inputGroups: createDefaultAIInputGroups(),
        }),
        aiImageHd: createAIConfigSuperset({
            steps: 20,
            aspectRatio: DEFAULT_AI_IMAGE_ASPECT_RATIO,
            imageSize: '1K',
            resolutionPreset: undefined,
            inputGroups: createDefaultAIInputGroups(),
        }),
        aiFloorplanColorize: createAIConfigSuperset({
            steps: 20,
            aspectRatio: DEFAULT_AI_IMAGE_ASPECT_RATIO,
            imageSize: '1K',
            model: DEFAULT_AI_IMAGE_MODEL,
            resolutionPreset: undefined,
            stylePreset: 'three-d-render',
            inputGroups: [createAIImageInputGroup(0)],
        }),
    };
    return (_a = defaults[type]) !== null && _a !== void 0 ? _a : {};
}
