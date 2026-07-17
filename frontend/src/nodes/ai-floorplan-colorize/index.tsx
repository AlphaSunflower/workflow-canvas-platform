import { createAIImageInputGroup } from '@/utils/node';
import { createSupersetNodeConfig } from '../shared/config';
import type { NodeDefinition } from '../types';
import {
  AI_FLOORPLAN_COLORIZE_COLOR,
  AI_FLOORPLAN_COLORIZE_DEFAULT_ASPECT_RATIO,
  AI_FLOORPLAN_COLORIZE_DEFAULT_IMAGE_SIZE,
  AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL,
  AI_FLOORPLAN_COLORIZE_DEFAULT_SIZE,
  AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
  AI_FLOORPLAN_COLORIZE_DESCRIPTION,
  AI_FLOORPLAN_COLORIZE_DISPLAY_NAME,
  AI_FLOORPLAN_COLORIZE_ICON,
  AI_FLOORPLAN_COLORIZE_MIN_GROUPS,
} from './constants';
import {
  aiFloorplanColorizeInputGroups,
  resolveAIFloorplanColorizeInputGroups,
  validateAIFloorplanColorizeConnection,
} from './groups';
import { aiFloorplanColorizeDrop } from './drop';
import { aiFloorplanColorizeExecution } from './runtime';

export const aiFloorplanColorizeDefinition: NodeDefinition = {
  type: 'aiFloorplanColorize',
  stage: 'full',
  displayName: AI_FLOORPLAN_COLORIZE_DISPLAY_NAME,
  icon: AI_FLOORPLAN_COLORIZE_ICON,
  color: AI_FLOORPLAN_COLORIZE_COLOR,
  description: AI_FLOORPLAN_COLORIZE_DESCRIPTION,
  menu: {
    order: 6,
    group: 'ai',
    visible: false,
  },
  defaultSize: AI_FLOORPLAN_COLORIZE_DEFAULT_SIZE,
  defaultConfig: createSupersetNodeConfig({
    steps: 20,
    aspectRatio: AI_FLOORPLAN_COLORIZE_DEFAULT_ASPECT_RATIO,
    imageSize: AI_FLOORPLAN_COLORIZE_DEFAULT_IMAGE_SIZE,
    model: AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL,
    resolutionPreset: undefined,
    stylePreset: AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
    inputGroups: Array.from(
      { length: AI_FLOORPLAN_COLORIZE_MIN_GROUPS },
      (_, index) => createAIImageInputGroup(index)
    ),
  }),
  inputGroups: aiFloorplanColorizeInputGroups,
  resolveInputGroups: resolveAIFloorplanColorizeInputGroups,
  drop: aiFloorplanColorizeDrop,
  validateConnection: validateAIFloorplanColorizeConnection,
  execution: aiFloorplanColorizeExecution,
};
