/**
 * AI display helpers.
 * @module utils/ai/display
 */
import { AI_3D_MODELS, AI_CHAT_MODELS, AI_IMAGE_MODELS, AI_LAOZHANG_IMAGE_MODELS, AI_VIDEO_MODELS, } from '@/constants/ai.constants';
export function getTaskTypeDisplayName(taskType) {
    var _a;
    var names = {
        'image-gen': 'AI 生图',
        'image-inpaint': '图片局部重绘',
        'video-gen': 'AI 生成视频',
        'model-gen': 'AI 生成模型',
        'image-to-ply': 'AI 图转模型',
        'multi-view-restore': '多视角修复',
        'model-render-transfer': '白模图迁移渲染',
        'image-hd': '图片高清化',
        'floorplan-colorize': '平面图转彩平',
    };
    return (_a = names[taskType]) !== null && _a !== void 0 ? _a : taskType;
}
export function getProviderDisplayName(provider) {
    var _a;
    var names = {
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        stability: 'Stability AI',
        runway: 'Runway',
        meshy: 'Meshy',
        pika: 'Pika Labs',
        tripo: 'Tripo',
        laozhang: '老张 API',
    };
    return (_a = names[provider]) !== null && _a !== void 0 ? _a : provider;
}
export function getModelDisplayName(model) {
    var _a;
    var names = {
        'gpt-4': 'GPT-4',
        'gpt-4-turbo': 'GPT-4 Turbo',
        'gpt-3.5-turbo': 'GPT-3.5 Turbo',
        'claude-3-opus': 'Claude 3 Opus',
        'claude-3-sonnet': 'Claude 3 Sonnet',
        'claude-3-haiku': 'Claude 3 Haiku',
        'stable-diffusion-xl': 'Stable Diffusion XL',
        'stable-diffusion-3': 'Stable Diffusion 3',
        'gemini-3-pro-image-preview': 'Gemini 3 Pro Image Preview',
        'gpt-image-2-vip': 'GPT Image 2',
        'gpt-image-2-official': 'GPT Image 2 Official',
        'dall-e-3': 'DALL-E 3',
        'runway-gen2': 'Runway Gen-2',
        'runway-gen3': 'Runway Gen-3',
        'pika-labs': 'Pika Labs',
        'meshy-ai': 'Meshy AI',
        tripo: 'Tripo',
    };
    return (_a = names[model]) !== null && _a !== void 0 ? _a : model;
}
export function getModelGroupDisplayName(model) {
    if (AI_LAOZHANG_IMAGE_MODELS.includes(model)) {
        return 'LaoZhang Image';
    }
    if (AI_IMAGE_MODELS.includes(model)) {
        return 'Image';
    }
    if (AI_VIDEO_MODELS.includes(model)) {
        return 'Video';
    }
    if (AI_3D_MODELS.includes(model)) {
        return '3D';
    }
    if (AI_CHAT_MODELS.includes(model)) {
        return 'Chat';
    }
    return 'Model';
}
export function getModelOptionLabel(model) {
    return getModelDisplayName(model);
}
export function getTaskTypeIcon(taskType) {
    var _a;
    var icons = {
        'image-gen': 'IMG',
        'image-inpaint': 'INP',
        'video-gen': 'VID',
        'model-gen': '3D',
        'image-to-ply': 'PLY',
        'multi-view-restore': 'MVR',
        'model-render-transfer': 'WMR',
        'image-hd': 'HD',
        'floorplan-colorize': 'CLR',
    };
    return (_a = icons[taskType]) !== null && _a !== void 0 ? _a : 'AI';
}
export function getTaskTypeColor(taskType) {
    var _a;
    var colors = {
        'image-gen': '#EC4899',
        'image-inpaint': '#EF4444',
        'video-gen': '#06B6D4',
        'model-gen': '#14B8A6',
        'image-to-ply': '#10B981',
        'multi-view-restore': '#7C3AED',
        'model-render-transfer': '#F59E0B',
        'image-hd': '#0EA5E9',
        'floorplan-colorize': '#F97316',
    };
    return (_a = colors[taskType]) !== null && _a !== void 0 ? _a : '#6B7280';
}
