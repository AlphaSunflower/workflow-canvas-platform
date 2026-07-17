/**
 * AI config helpers.
 * @module utils/ai/config
 */

import type { AIModelType, AITaskType } from '@/types/ai.types';
import type { AIConfig } from '@/types/node.types';
import {
  AI_TASK_CANDIDATE_MODELS,
  AI_TASK_RECOMMENDED_MODELS,
} from '@/constants/ai.constants';

export function createDefaultAIConfig(taskType: AITaskType): AIConfig {
  const defaults: Record<AITaskType, AIConfig> = {
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
  return { ...defaults[taskType] };
}

export function mergeAIConfig(base: AIConfig, override: Partial<AIConfig>): AIConfig {
  return { ...base, ...override };
}

export function validateAIConfigForTask(config: AIConfig, taskType: AITaskType): boolean {
  const allowedModels = AI_TASK_CANDIDATE_MODELS[taskType] as readonly AIModelType[] | undefined;
  if (!allowedModels || !config.model) {
    return true;
  }

  return allowedModels.includes(config.model as AIModelType);
}
