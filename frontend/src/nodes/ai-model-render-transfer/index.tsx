import { ensureFixedAIInputGroups } from '@/utils/node';
import { createSupersetNodeConfig } from '../shared/config';
import type { NodeDefinition } from '../types';
import {
  MODEL_RENDER_TRANSFER_COLOR,
  MODEL_RENDER_TRANSFER_DEFAULT_CONFIG,
  MODEL_RENDER_TRANSFER_DEFAULT_SIZE,
  MODEL_RENDER_TRANSFER_DESCRIPTION,
  MODEL_RENDER_TRANSFER_DISPLAY_NAME,
  MODEL_RENDER_TRANSFER_ICON,
  MODEL_RENDER_TRANSFER_MIN_GROUPS,
} from './constants';
import {
  aiModelRenderTransferInputGroups,
  resolveAIModelRenderTransferInputGroups,
  validateAIModelRenderTransferConnection,
} from './groups';
import { aiModelRenderTransferDrop } from './drop';
import { aiModelRenderTransferExecution } from './runtime';

export const aiModelRenderTransferDefinition: NodeDefinition = {
  type: 'aiModelRenderTransfer',
  stage: 'full',
  displayName: MODEL_RENDER_TRANSFER_DISPLAY_NAME,
  icon: MODEL_RENDER_TRANSFER_ICON,
  color: MODEL_RENDER_TRANSFER_COLOR,
  description: MODEL_RENDER_TRANSFER_DESCRIPTION,
  menu: {
    order: 1,
    group: 'ai',
  },
  defaultSize: MODEL_RENDER_TRANSFER_DEFAULT_SIZE,
  defaultConfig: createSupersetNodeConfig({
    ...MODEL_RENDER_TRANSFER_DEFAULT_CONFIG,
    inputGroups: ensureFixedAIInputGroups(undefined, MODEL_RENDER_TRANSFER_MIN_GROUPS),
  }),
  inputGroups: aiModelRenderTransferInputGroups,
  drop: aiModelRenderTransferDrop,
  resolveInputGroups: resolveAIModelRenderTransferInputGroups,
  validateConnection: validateAIModelRenderTransferConnection,
  execution: aiModelRenderTransferExecution,
};
