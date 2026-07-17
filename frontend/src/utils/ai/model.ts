/**
 * AI model helpers.
 * @module utils/ai/model
 */

import type {
  AI3DModelType,
  AIChatModelType,
  AIImageModelType,
  AIModelType,
  AIProvider,
  AITaskType,
  AIVideoModelType,
} from '@/types/ai.types';
import {
  AI_3D_MODELS,
  AI_CHAT_MODELS,
  AI_IMAGE_MODELS,
  AI_PROVIDER_MODELS,
  AI_TASK_CANDIDATE_MODELS,
  AI_TASK_RECOMMENDED_MODELS,
  AI_VIDEO_MODELS,
} from '@/constants/ai.constants';

export function getProviderForModel(model: AIModelType): AIProvider | null {
  for (const [provider, models] of Object.entries(AI_PROVIDER_MODELS)) {
    if (models && models.includes(model)) {
      return provider as AIProvider;
    }
  }
  return null;
}

export function getModelsForProvider(provider: AIProvider): AIModelType[] {
  return AI_PROVIDER_MODELS[provider] ?? [];
}

export function isModelSupportedByProvider(model: AIModelType, provider: AIProvider): boolean {
  const models = AI_PROVIDER_MODELS[provider];
  return models ? models.includes(model) : false;
}

export function isImageModel(model: AIModelType): model is AIImageModelType {
  return (AI_IMAGE_MODELS as readonly AIModelType[]).includes(model);
}

export function isVideoModel(model: AIModelType): model is AIVideoModelType {
  return (AI_VIDEO_MODELS as readonly AIModelType[]).includes(model);
}

export function is3DModel(model: AIModelType): model is AI3DModelType {
  return (AI_3D_MODELS as readonly AIModelType[]).includes(model);
}

export function isChatModel(model: AIModelType): model is AIChatModelType {
  return (AI_CHAT_MODELS as readonly AIModelType[]).includes(model);
}

export function getTaskTypeFromModel(model: AIModelType): AITaskType | null {
  if (isImageModel(model)) return 'image-gen';
  if (isVideoModel(model)) return 'video-gen';
  if (is3DModel(model)) return 'model-gen';

  return null;
}

export function getRecommendedModel(taskType: AITaskType): AIModelType {
  return AI_TASK_RECOMMENDED_MODELS[taskType];
}

export function getCandidateModels(taskType: AITaskType): AIModelType[] {
  return [...AI_TASK_CANDIDATE_MODELS[taskType]];
}

export function getAlternativeModels(taskType: AITaskType): AIModelType[] {
  const recommendedModel = getRecommendedModel(taskType);
  return getCandidateModels(taskType).filter((model) => model !== recommendedModel);
}
