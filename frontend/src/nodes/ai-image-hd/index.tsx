import { createSupersetNodeConfig } from '../shared/config';
import type { NodeDefinition } from '../types';
import {
  AI_IMAGE_HD_COLOR,
  AI_IMAGE_HD_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_HD_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_HD_DEFAULT_MODEL,
  AI_IMAGE_HD_DEFAULT_SIZE,
  AI_IMAGE_HD_DESCRIPTION,
  AI_IMAGE_HD_DISPLAY_NAME,
  AI_IMAGE_HD_ICON,
} from './constants';
import {
  aiImageHdInputGroups,
  resolveAIImageHdInputGroups,
  validateAIImageHdConnection,
} from './groups';
import { aiImageHdDrop } from './drop';
import { aiImageHdExecution } from './runtime';
import { createAIImageInputGroup } from '@/utils/node';

export const aiImageHdDefinition: NodeDefinition = {
  type: 'aiImageHd',
  stage: 'full',
  displayName: AI_IMAGE_HD_DISPLAY_NAME,
  icon: AI_IMAGE_HD_ICON,
  color: AI_IMAGE_HD_COLOR,
  description: AI_IMAGE_HD_DESCRIPTION,
  menu: {
    order: 4,
    group: 'ai',
  },
  defaultSize: AI_IMAGE_HD_DEFAULT_SIZE,
  defaultConfig: createSupersetNodeConfig({
    model: AI_IMAGE_HD_DEFAULT_MODEL,
    steps: 20,
    aspectRatio: AI_IMAGE_HD_DEFAULT_ASPECT_RATIO,
    imageSize: AI_IMAGE_HD_DEFAULT_IMAGE_SIZE,
    resolutionPreset: undefined,
    inputGroups: [createAIImageInputGroup(0)],
  }),
  inputGroups: aiImageHdInputGroups,
  resolveInputGroups: resolveAIImageHdInputGroups,
  drop: aiImageHdDrop,
  validateConnection: validateAIImageHdConnection,
  execution: aiImageHdExecution,
};
