/**
 * AI display helpers.
 * @module utils/ai/display
 */

import type { AIProvider, AIModelType, AITaskType } from '@/types/ai.types';
import {
  AI_3D_MODELS,
  AI_CHAT_MODELS,
  AI_IMAGE_MODELS,
  AI_LAOZHANG_IMAGE_MODELS,
  AI_VIDEO_MODELS,
} from '@/constants/ai.constants';

export function getTaskTypeDisplayName(taskType: AITaskType): string {
  const names: Record<AITaskType, string> = {
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
  return names[taskType] ?? taskType;
}

export function getProviderDisplayName(provider: AIProvider): string {
  const names: Partial<Record<AIProvider, string>> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    stability: 'Stability AI',
    runway: 'Runway',
    meshy: 'Meshy',
    pika: 'Pika Labs',
    tripo: 'Tripo',
    laozhang: '老张 API',
  };
  return names[provider] ?? provider;
}

export function getModelDisplayName(model: AIModelType): string {
  const names: Record<AIModelType, string> = {
    'gpt-4': 'GPT-4',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'gpt-3.5-turbo': 'GPT-3.5 Turbo',
    'claude-3-opus': 'Claude 3 Opus',
    'claude-3-sonnet': 'Claude 3 Sonnet',
    'claude-3-haiku': 'Claude 3 Haiku',
    'stable-diffusion-xl': 'Stable Diffusion XL',
    'stable-diffusion-3': 'Stable Diffusion 3',
    'gemini-3-pro-image-preview': 'Gemini 3 Pro Image Preview',
    'gpt-image-2': 'GPT Image 2',
    'gpt-image-2-vip': 'GPT Image 2 VIP',
    'gpt-image-2-official': 'GPT Image 2 Official',
    'dall-e-3': 'DALL-E 3',
    'runway-gen2': 'Runway Gen-2',
    'runway-gen3': 'Runway Gen-3',
    'pika-labs': 'Pika Labs',
    'meshy-ai': 'Meshy AI',
    tripo: 'Tripo',
  };
  return names[model] ?? model;
}

export function getModelGroupDisplayName(model: AIModelType): string {
  if ((AI_LAOZHANG_IMAGE_MODELS as readonly AIModelType[]).includes(model)) {
    return 'LaoZhang Image';
  }

  if ((AI_IMAGE_MODELS as readonly AIModelType[]).includes(model)) {
    return 'Image';
  }

  if ((AI_VIDEO_MODELS as readonly AIModelType[]).includes(model)) {
    return 'Video';
  }

  if ((AI_3D_MODELS as readonly AIModelType[]).includes(model)) {
    return '3D';
  }

  if ((AI_CHAT_MODELS as readonly AIModelType[]).includes(model)) {
    return 'Chat';
  }

  return 'Model';
}

export function getModelOptionLabel(model: AIModelType): string {
  return getModelDisplayName(model);
}

export function getTaskTypeIcon(taskType: AITaskType): string {
  const icons: Record<AITaskType, string> = {
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
  return icons[taskType] ?? 'AI';
}

export function getTaskTypeColor(taskType: AITaskType): string {
  const colors: Record<AITaskType, string> = {
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
  return colors[taskType] ?? '#6B7280';
}
