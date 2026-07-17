/**
 * AI config helpers.
 * @module utils/ai/config
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
import { AI_TASK_CANDIDATE_MODELS, AI_TASK_RECOMMENDED_MODELS, } from '@/constants/ai.constants';
export function createDefaultAIConfig(taskType) {
    var defaults = {
        'image-gen': { model: AI_TASK_RECOMMENDED_MODELS['image-gen'], steps: 30, cfgScale: 7, width: 1024, height: 1024 },
        'image-inpaint': { model: AI_TASK_RECOMMENDED_MODELS['image-inpaint'], steps: 30, cfgScale: 7, width: 1024, height: 1024 },
        'video-gen': { model: 'runway-gen2' },
        'model-gen': { model: 'meshy-ai' },
        'image-to-ply': { model: 'meshy-ai' },
        'multi-view-restore': { model: 'stable-diffusion-xl', steps: 20 },
        'model-render-transfer': { model: AI_TASK_RECOMMENDED_MODELS['model-render-transfer'], steps: 30 },
        'image-hd': { model: AI_TASK_RECOMMENDED_MODELS['image-hd'], steps: 20 },
        'floorplan-colorize': { model: AI_TASK_RECOMMENDED_MODELS['floorplan-colorize'], steps: 20 },
    };
    return __assign({}, defaults[taskType]);
}
export function mergeAIConfig(base, override) {
    return __assign(__assign({}, base), override);
}
export function validateAIConfigForTask(config, taskType) {
    var allowedModels = AI_TASK_CANDIDATE_MODELS[taskType];
    if (!allowedModels || !config.model) {
        return true;
    }
    return allowedModels.includes(config.model);
}
