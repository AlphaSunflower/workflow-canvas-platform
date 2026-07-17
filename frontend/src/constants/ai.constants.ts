import type {
  AI3DModelType,
  AIChatModelType,
  AIImageModelType,
  AILaozhangImageModelType,
  AIModelType,
  AIProvider,
  AITaskType,
  AIVideoModelType,
} from '@/types/ai.types';

export const AI_TASK_DEFAULTS = {
  maxRetries: 3,
  timeout: {
    'image-gen': 300000,
    'image-inpaint': 300000,
    'video-gen': 600000,
    'model-gen': 900000,
    'image-to-ply': 900000,
    'multi-view-restore': 300000,
    'model-render-transfer': 300000,
    'image-hd': 300000,
    'floorplan-colorize': 300000,
  } as Record<AITaskType, number>,
  priority: {
    'image-gen': 'normal' as const,
    'image-inpaint': 'normal' as const,
    'video-gen': 'low' as const,
    'model-gen': 'low' as const,
    'image-to-ply': 'low' as const,
    'multi-view-restore': 'normal' as const,
    'model-render-transfer': 'normal' as const,
    'image-hd': 'normal' as const,
    'floorplan-colorize': 'normal' as const,
  },
} as const;

export const AI_CHAT_MODELS = [
  'gpt-4',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
] as const satisfies readonly AIChatModelType[];

export const AI_LAOZHANG_IMAGE_MODELS = [
  'gemini-3-pro-image-preview',
  'gpt-image-2',
  'gpt-image-2-vip',
  'gpt-image-2-official',
] as const satisfies readonly AILaozhangImageModelType[];

export const AI_IMAGE_MODELS = [
  'stable-diffusion-xl',
  'stable-diffusion-3',
  ...AI_LAOZHANG_IMAGE_MODELS,
  'dall-e-3',
] as const satisfies readonly AIImageModelType[];

export const AI_VIDEO_MODELS = [
  'runway-gen2',
  'runway-gen3',
  'pika-labs',
] as const satisfies readonly AIVideoModelType[];

export const AI_3D_MODELS = [
  'meshy-ai',
  'tripo',
] as const satisfies readonly AI3DModelType[];

export const AI_TASK_RECOMMENDED_MODELS: Record<AITaskType, AIModelType> = {
  'image-gen': 'gpt-image-2',
  'image-inpaint': 'gpt-image-2',
  'video-gen': 'runway-gen2',
  'model-gen': 'meshy-ai',
  'image-to-ply': 'meshy-ai',
  'multi-view-restore': 'stable-diffusion-xl',
  'model-render-transfer': 'gpt-image-2',
  'image-hd': 'gpt-image-2',
  'floorplan-colorize': 'gpt-image-2',
};

export const AI_TASK_CANDIDATE_MODELS: Record<AITaskType, readonly AIModelType[]> = {
  'image-gen': [
    'gemini-3-pro-image-preview',
    'gpt-image-2',
    'gpt-image-2-vip',
    'gpt-image-2-official',
    'dall-e-3',
    'stable-diffusion-3',
    'stable-diffusion-xl',
  ],
  'image-inpaint': ['gemini-3-pro-image-preview', 'gpt-image-2', 'gpt-image-2-vip'],
  'video-gen': ['runway-gen2', 'runway-gen3', 'pika-labs'],
  'model-gen': ['meshy-ai', 'tripo'],
  'image-to-ply': ['meshy-ai', 'tripo'],
  'multi-view-restore': ['stable-diffusion-xl', 'stable-diffusion-3'],
  'model-render-transfer': ['gemini-3-pro-image-preview', 'gpt-image-2', 'gpt-image-2-vip'],
  'image-hd': ['gemini-3-pro-image-preview', 'gpt-image-2', 'gpt-image-2-vip'],
  'floorplan-colorize': ['gemini-3-pro-image-preview', 'gpt-image-2', 'gpt-image-2-vip'],
};

export const AI_PROVIDER_MODELS: Partial<Record<AIProvider, AIModelType[]>> = {
  openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'dall-e-3'],
  anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
  stability: ['stable-diffusion-xl', 'stable-diffusion-3'],
  runway: ['runway-gen2', 'runway-gen3'],
  pika: ['pika-labs'],
  meshy: ['meshy-ai'],
  tripo: ['tripo'],
  laozhang: [...AI_LAOZHANG_IMAGE_MODELS],
  'laozhang-veo': [],
} as const;
