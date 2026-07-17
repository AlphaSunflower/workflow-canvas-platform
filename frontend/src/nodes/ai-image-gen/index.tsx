import { getDefaultAIConfig } from '@/utils/node';
import {
  aiImageGenInputGroups,
  resolveAIImageGenInputGroups,
  validateAIImageGenConnection,
} from './groups';
import { aiImageGenDrop } from './drop';
import { aiImageGenExecution } from './runtime';
import type { NodeDefinition } from '../types';

export const aiImageGenDefinition: NodeDefinition = {
  type: 'aiImageGen',
  stage: 'full',
  displayName: 'AI 生图',
  icon: 'IMG+',
  color: '#ec4899',
  description: '支持动态输入组、按组并发执行的 AI 生图节点。',
  menu: {
    order: 0,
    group: 'ai',
  },
  defaultSize: {
    width: 320,
    height: 372,
  },
  defaultConfig: getDefaultAIConfig('aiImageGen'),
  inputGroups: aiImageGenInputGroups,
  drop: aiImageGenDrop,
  resolveInputGroups: resolveAIImageGenInputGroups,
  validateConnection: validateAIImageGenConnection,
  execution: aiImageGenExecution,
};
