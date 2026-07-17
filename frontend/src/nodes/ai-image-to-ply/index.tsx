import { createAIImageInputGroup } from '@/utils/node';
import { createSupersetNodeConfig } from '../shared/config';
import { aiImageToPlyDrop } from './drop';
import {
  aiImageToPlyInputGroups,
  resolveAIImageToPlyInputGroups,
  validateAIImageToPlyConnection,
} from './groups';
import { aiImageToPlyExecution } from './runtime';
import type { NodeDefinition } from '../types';

export const aiImageToPlyDefinition: NodeDefinition = {
  type: 'aiImageToPly',
  stage: 'full',
  displayName: '图转模型',
  icon: '3D',
  color: '#14b8a6',
  description: '最多 10 组，每组 1 张图片，运行后每组产出 1 个 PLY。',
  menu: {
    order: 2,
    group: 'ai',
  },
  defaultSize: {
    width: 320,
    height: 296,
  },
  defaultConfig: createSupersetNodeConfig({
    model: 'meshy-ai',
    textureQuality: 'high',
    cameraCount: 4,
    inputGroups: [createAIImageInputGroup(0)],
  }),
  inputGroups: aiImageToPlyInputGroups,
  drop: aiImageToPlyDrop,
  resolveInputGroups: resolveAIImageToPlyInputGroups,
  validateConnection: validateAIImageToPlyConnection,
  execution: aiImageToPlyExecution,
};
