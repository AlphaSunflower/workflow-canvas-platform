import { AI_IMAGE_GEN_NODE_ASPECT_RATIO_OPTIONS, AI_IMAGE_GEN_NODE_DEFAULT_ASPECT_RATIO, AI_IMAGE_GEN_NODE_DEFAULT_IMAGE_SIZE, AI_IMAGE_GEN_NODE_DEFAULT_MODEL, AI_IMAGE_GEN_NODE_IMAGE_SIZE_OPTIONS, AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS, AI_IMAGE_GEN_NODE_SUPPORTED_IMAGE_SIZES, AI_IMAGE_GEN_NODE_SUPPORTED_MODELS, AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS, getAIImageGenNodeAspectRatioOptions, normalizeAIImageGenNodeConfig, normalizeAIImageGenNodeModel, } from '../ai-image-gen/constants';
export var AI_IMAGE_INPAINT_DISPLAY_NAME = '图片局部重绘';
export var AI_IMAGE_INPAINT_DESCRIPTION = '拖入 1 张原图，在节点内标记区域后按提示词进行局部重绘。';
export var AI_IMAGE_INPAINT_ICON = 'INP';
export var AI_IMAGE_INPAINT_COLOR = '#ef4444';
export var AI_IMAGE_INPAINT_GROUP_ID = 'main';
export var AI_IMAGE_INPAINT_GROUP_LABEL = '原图';
export var AI_IMAGE_INPAINT_INPUT_PORT_ID = 'image';
export var AI_IMAGE_INPAINT_RESULT_PORT_ID = 'result';
export var AI_IMAGE_INPAINT_INPUT_LABEL = '原图';
export var AI_IMAGE_INPAINT_RESULT_LABEL = '重绘结果';
export var AI_IMAGE_INPAINT_INPUT_LIMIT = 1;
export var AI_IMAGE_INPAINT_SUPPORTED_MODELS = AI_IMAGE_GEN_NODE_SUPPORTED_MODELS;
export var AI_IMAGE_INPAINT_SUPPORTED_IMAGE_SIZES = AI_IMAGE_GEN_NODE_SUPPORTED_IMAGE_SIZES;
export var AI_IMAGE_INPAINT_SUPPORTED_ASPECT_RATIOS = AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS;
export var AI_IMAGE_INPAINT_DEFAULT_MODEL = AI_IMAGE_GEN_NODE_DEFAULT_MODEL;
export var AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE = AI_IMAGE_GEN_NODE_DEFAULT_IMAGE_SIZE;
export var AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO = AI_IMAGE_GEN_NODE_DEFAULT_ASPECT_RATIO;
export var AI_IMAGE_INPAINT_NODE_MODEL_OPTIONS = AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS;
export var AI_IMAGE_INPAINT_NODE_IMAGE_SIZE_OPTIONS = AI_IMAGE_GEN_NODE_IMAGE_SIZE_OPTIONS;
export var AI_IMAGE_INPAINT_NODE_ASPECT_RATIO_OPTIONS = AI_IMAGE_GEN_NODE_ASPECT_RATIO_OPTIONS;
export var AI_IMAGE_INPAINT_MASK_MODES = [
    'original-markup',
    'strong-mask',
];
export var AI_IMAGE_INPAINT_DEFAULT_MASK_MODE = 'original-markup';
export var AI_IMAGE_INPAINT_MASK_MODE_OPTIONS = [
    { value: 'original-markup', label: '原图遮罩' },
    { value: 'strong-mask', label: '强遮罩' },
];
var AI_IMAGE_INPAINT_MASK_MODE_SET = new Set(AI_IMAGE_INPAINT_MASK_MODES);
export function isAIImageInpaintMaskMode(value) {
    return typeof value === 'string' && AI_IMAGE_INPAINT_MASK_MODE_SET.has(value);
}
export function normalizeAIImageInpaintMaskMode(value) {
    return isAIImageInpaintMaskMode(value)
        ? value
        : AI_IMAGE_INPAINT_DEFAULT_MASK_MODE;
}
export function normalizeAIImageInpaintNodeModel(value) {
    return normalizeAIImageGenNodeModel(value);
}
export function getAIImageInpaintNodeAspectRatioOptions(model) {
    return getAIImageGenNodeAspectRatioOptions(model);
}
export function normalizeAIImageInpaintNodeConfig(config) {
    return normalizeAIImageGenNodeConfig(config);
}
export var AI_IMAGE_INPAINT_DEFAULT_SIZE = {
    width: 500,
    height: 460,
};
export var AI_IMAGE_INPAINT_MIN_WIDTH = 420;
export var AI_IMAGE_INPAINT_MIN_HEIGHT = 430;
export var AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT = 360;
export var AI_IMAGE_INPAINT_MIN_EDITOR_HEIGHT = 260;
export var AI_IMAGE_INPAINT_DEFAULT_EDITOR_WIDTH = AI_IMAGE_INPAINT_DEFAULT_SIZE.width;
export var AI_IMAGE_INPAINT_MIN_EDITOR_WIDTH = 220;
export var AI_IMAGE_INPAINT_MAX_EDITOR_WIDTH = 960;
export var AI_IMAGE_INPAINT_BODY_MIN_HEIGHT = 320;
export var AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP = 12;
export var AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT = 39;
export var AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP = 6;
function normalizePositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;
}
export function normalizeAIImageInpaintEditorHeight(value) {
    var numericValue = normalizePositiveNumber(value);
    return Math.max(AI_IMAGE_INPAINT_MIN_EDITOR_HEIGHT, numericValue ? Math.round(numericValue) : AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT);
}
export function resolveAIImageInpaintEditorSize(params) {
    var height = normalizeAIImageInpaintEditorHeight(params.editorHeight);
    var sourceWidth = normalizePositiveNumber(params.sourceWidth);
    var sourceHeight = normalizePositiveNumber(params.sourceHeight);
    var aspectRatio = sourceWidth && sourceHeight
        ? sourceWidth / sourceHeight
        : null;
    var width = aspectRatio
        ? Math.round(Math.min(AI_IMAGE_INPAINT_MAX_EDITOR_WIDTH, Math.max(AI_IMAGE_INPAINT_MIN_EDITOR_WIDTH, height * aspectRatio)))
        : AI_IMAGE_INPAINT_DEFAULT_EDITOR_WIDTH;
    return {
        width: width,
        height: height,
        aspectRatio: aspectRatio,
    };
}
