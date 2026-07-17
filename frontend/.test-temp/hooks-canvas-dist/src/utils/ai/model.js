/**
 * AI model helpers.
 * @module utils/ai/model
 */
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { AI_3D_MODELS, AI_CHAT_MODELS, AI_IMAGE_MODELS, AI_PROVIDER_MODELS, AI_TASK_CANDIDATE_MODELS, AI_TASK_RECOMMENDED_MODELS, AI_VIDEO_MODELS, } from '@/constants/ai.constants';
export function getProviderForModel(model) {
    for (var _i = 0, _a = Object.entries(AI_PROVIDER_MODELS); _i < _a.length; _i++) {
        var _b = _a[_i], provider = _b[0], models = _b[1];
        if (models && models.includes(model)) {
            return provider;
        }
    }
    return null;
}
export function getModelsForProvider(provider) {
    var _a;
    return (_a = AI_PROVIDER_MODELS[provider]) !== null && _a !== void 0 ? _a : [];
}
export function isModelSupportedByProvider(model, provider) {
    var models = AI_PROVIDER_MODELS[provider];
    return models ? models.includes(model) : false;
}
export function isImageModel(model) {
    return AI_IMAGE_MODELS.includes(model);
}
export function isVideoModel(model) {
    return AI_VIDEO_MODELS.includes(model);
}
export function is3DModel(model) {
    return AI_3D_MODELS.includes(model);
}
export function isChatModel(model) {
    return AI_CHAT_MODELS.includes(model);
}
export function getTaskTypeFromModel(model) {
    if (isImageModel(model))
        return 'image-gen';
    if (isVideoModel(model))
        return 'video-gen';
    if (is3DModel(model))
        return 'model-gen';
    return null;
}
export function getRecommendedModel(taskType) {
    return AI_TASK_RECOMMENDED_MODELS[taskType];
}
export function getCandidateModels(taskType) {
    return __spreadArray([], AI_TASK_CANDIDATE_MODELS[taskType], true);
}
export function getAlternativeModels(taskType) {
    var recommendedModel = getRecommendedModel(taskType);
    return getCandidateModels(taskType).filter(function (model) { return model !== recommendedModel; });
}
