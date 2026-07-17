import { getDefaultAIConfig } from '@/utils/node';
import type { NodeDefinition } from '../types';
import { aiVideoGenDrop } from './drop';
import {
  aiVideoGenInputGroups,
  resolveAIVideoGenInputGroups,
  validateAIVideoGenConnection,
} from './groups';
import { aiVideoGenExecution } from './runtime';

export const aiVideoGenDefinition: NodeDefinition = {
  type: 'aiVideoGen',
  stage: 'full',
  displayName: 'AI 生成视频',
  icon: 'VID+',
  color: '#06b6d4',
  description: '按组接入 1-2 张参考图，并根据同一组提示词生成视频结果。',
  menu: {
    order: 5,
    group: 'ai',
  },
  defaultSize: {
    width: 360,
    height: 420,
  },
  defaultConfig: getDefaultAIConfig('aiVideoGen'),
  inputGroups: aiVideoGenInputGroups,
  drop: aiVideoGenDrop,
  resolveInputGroups: resolveAIVideoGenInputGroups,
  validateConnection: validateAIVideoGenConnection,
  execution: aiVideoGenExecution,
};
