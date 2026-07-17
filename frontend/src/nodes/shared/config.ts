import type { AIConfig } from '@/types';
import { createDefaultAIInputGroups } from '@/utils/node';

export function createSupersetNodeConfig(overrides: AIConfig = {}): AIConfig {
  return {
    model: 'stable-diffusion-xl',
    prompt: '',
    negativePrompt: '',
    steps: 30,
    seed: 0,
    width: 1024,
    height: 1024,
    cfgScale: 7,
    sampler: 'default',
    aspectRatio: '1:1',
    resolutionPreset: '1024x1024',
    outputCount: 1,
    strength: 0.75,
    denoise: 0.5,
    cameraCount: 4,
    textureQuality: 'high',
    fps: 24,
    duration: 4,
    inputGroups: createDefaultAIInputGroups(),
    ...overrides,
  };
}
