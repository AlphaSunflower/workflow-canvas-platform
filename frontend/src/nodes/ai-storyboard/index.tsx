import { getDefaultAIConfig } from '@/utils/node';
import type { NodeDefinition } from '../types';
import { aiStoryboardDrop } from './drop';
import {
  aiStoryboardInputGroups,
  resolveAIStoryboardInputGroups,
  validateAIStoryboardConnection,
} from './groups';
import {
  aiStoryboardExecution,
  aiStoryboardNodeActions,
} from './runtime';
import {
  AI_STORYBOARD_COLOR,
  AI_STORYBOARD_DEFAULT_SIZE,
  AI_STORYBOARD_DISPLAY_NAME,
  AI_STORYBOARD_DESCRIPTION,
  AI_STORYBOARD_ICON,
} from './constants';

export const AI_STORYBOARD_EXECUTION_BOUNDARY = 'node-internal-workbench-only';

export const aiStoryboardDefinition: NodeDefinition = {
  type: 'aiStoryboard',
  stage: 'full',
  displayName: AI_STORYBOARD_DISPLAY_NAME,
  icon: AI_STORYBOARD_ICON,
  color: AI_STORYBOARD_COLOR,
  description: AI_STORYBOARD_DESCRIPTION,
  menu: {
    order: 1,
    group: 'ai',
  },
  defaultSize: AI_STORYBOARD_DEFAULT_SIZE,
  defaultConfig: getDefaultAIConfig('aiStoryboard'),
  inputGroups: aiStoryboardInputGroups,
  drop: aiStoryboardDrop,
  actions: aiStoryboardNodeActions,
  resolveInputGroups: resolveAIStoryboardInputGroups,
  validateConnection: validateAIStoryboardConnection,
  execution: aiStoryboardExecution,
};
