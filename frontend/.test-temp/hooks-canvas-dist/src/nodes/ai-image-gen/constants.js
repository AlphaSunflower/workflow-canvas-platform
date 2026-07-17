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
export var AI_IMAGE_GEN_NODE_SUPPORTED_MODELS = [
    'gemini-3-pro-image-preview',
    'gpt-image-2-vip',
    'gpt-image-2-official',
];
export var AI_IMAGE_GEN_NODE_SUPPORTED_IMAGE_SIZES = [
    '1K',
    '2K',
    '4K',
];
export var AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS = [
    'auto',
    '1:1',
    '16:9',
    '9:16',
    '4:3',
    '3:4',
    '21:9',
    '3:2',
    '2:3',
    '5:4',
    '4:5',
];
export var AI_IMAGE_GEN_NODE_OFFICIAL_QUALITIES = [
    'auto',
    'low',
    'medium',
    'high',
];
export var AI_IMAGE_GEN_NODE_DEFAULT_MODEL = 'gpt-image-2-vip';
export var AI_IMAGE_GEN_NODE_DEFAULT_IMAGE_SIZE = '1K';
export var AI_IMAGE_GEN_NODE_DEFAULT_ASPECT_RATIO = '1:1';
export var AI_IMAGE_GEN_NODE_OFFICIAL_MODEL = 'gpt-image-2-official';
export var AI_IMAGE_GEN_NODE_DEFAULT_OFFICIAL_QUALITY = 'auto';
export var AI_IMAGE_GEN_NODE_MODEL_OPTIONS = [
    { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
    { value: 'gpt-image-2-vip', label: 'GPT Image 2' },
    { value: 'gpt-image-2-official', label: 'GPT Image 2 Official' },
];
export var AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS = AI_IMAGE_GEN_NODE_MODEL_OPTIONS.filter(function (option) { return option.value !== AI_IMAGE_GEN_NODE_OFFICIAL_MODEL; });
export var AI_IMAGE_GEN_NODE_IMAGE_SIZE_OPTIONS = [
    { value: '1K', label: '1K' },
    { value: '2K', label: '2K' },
    { value: '4K', label: '4K' },
];
export var AI_IMAGE_GEN_NODE_ASPECT_RATIO_OPTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: '1:1', label: '1:1' },
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
    { value: '21:9', label: '21:9' },
    { value: '3:2', label: '3:2' },
    { value: '2:3', label: '2:3' },
    { value: '5:4', label: '5:4' },
    { value: '4:5', label: '4:5' },
];
export var AI_IMAGE_GEN_NODE_OFFICIAL_QUALITY_OPTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
];
var AI_IMAGE_GEN_NODE_MODEL_ASPECT_RATIOS = {
    'gemini-3-pro-image-preview': AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS,
    'gpt-image-2-vip': [
        '1:1',
        '16:9',
        '9:16',
        '4:3',
        '3:4',
        '21:9',
        '3:2',
        '2:3',
        '5:4',
        '4:5',
    ],
    'gpt-image-2-official': AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS,
};
var AI_IMAGE_GEN_NODE_MODEL_DEFAULT_ASPECT_RATIOS = {
    'gemini-3-pro-image-preview': 'auto',
    'gpt-image-2-vip': '1:1',
    'gpt-image-2-official': 'auto',
};
var AI_IMAGE_GEN_NODE_MODEL_SET = new Set(AI_IMAGE_GEN_NODE_SUPPORTED_MODELS);
var AI_IMAGE_GEN_NODE_IMAGE_SIZE_SET = new Set(AI_IMAGE_GEN_NODE_SUPPORTED_IMAGE_SIZES);
var AI_IMAGE_GEN_NODE_OFFICIAL_QUALITY_SET = new Set(AI_IMAGE_GEN_NODE_OFFICIAL_QUALITIES);
export function isAIImageGenNodeModel(value) {
    return typeof value === 'string' && AI_IMAGE_GEN_NODE_MODEL_SET.has(value);
}
export function normalizeAIImageGenNodeModel(value) {
    return isAIImageGenNodeModel(value) ? value : AI_IMAGE_GEN_NODE_DEFAULT_MODEL;
}
export function isAIImageGenNodeOfficialModel(value) {
    return value === AI_IMAGE_GEN_NODE_OFFICIAL_MODEL;
}
export function isAIImageGenNodeImageSize(value) {
    return typeof value === 'string' && AI_IMAGE_GEN_NODE_IMAGE_SIZE_SET.has(value);
}
export function normalizeAIImageGenNodeImageSize(value) {
    return isAIImageGenNodeImageSize(value)
        ? value
        : AI_IMAGE_GEN_NODE_DEFAULT_IMAGE_SIZE;
}
export function isAIImageGenNodeOfficialQuality(value) {
    return typeof value === 'string' && AI_IMAGE_GEN_NODE_OFFICIAL_QUALITY_SET.has(value);
}
export function normalizeAIImageGenNodeOfficialQuality(value) {
    return isAIImageGenNodeOfficialQuality(value)
        ? value
        : AI_IMAGE_GEN_NODE_DEFAULT_OFFICIAL_QUALITY;
}
export function getAIImageGenNodeSupportedAspectRatios(model) {
    return AI_IMAGE_GEN_NODE_MODEL_ASPECT_RATIOS[model];
}
export function getAIImageGenNodeDefaultAspectRatio(model) {
    return AI_IMAGE_GEN_NODE_MODEL_DEFAULT_ASPECT_RATIOS[model];
}
export function getAIImageGenNodeAspectRatioOptions(model) {
    var supportedAspectRatios = new Set(AI_IMAGE_GEN_NODE_MODEL_ASPECT_RATIOS[model]);
    return AI_IMAGE_GEN_NODE_ASPECT_RATIO_OPTIONS.filter(function (option) {
        return supportedAspectRatios.has(option.value);
    });
}
export function isAIImageGenNodeAspectRatio(model, value) {
    return typeof value === 'string'
        && AI_IMAGE_GEN_NODE_MODEL_ASPECT_RATIOS[model].includes(value);
}
export function normalizeAIImageGenNodeAspectRatio(model, value) {
    return isAIImageGenNodeAspectRatio(model, value)
        ? value
        : getAIImageGenNodeDefaultAspectRatio(model);
}
export function normalizeAIImageGenNodeConfig(config) {
    var model = normalizeAIImageGenNodeModel(config.model);
    return __assign({ model: model, imageSize: normalizeAIImageGenNodeImageSize(config.imageSize), aspectRatio: normalizeAIImageGenNodeAspectRatio(model, config.aspectRatio) }, (isAIImageGenNodeOfficialModel(model)
        ? { quality: normalizeAIImageGenNodeOfficialQuality(config.quality) }
        : {}));
}
