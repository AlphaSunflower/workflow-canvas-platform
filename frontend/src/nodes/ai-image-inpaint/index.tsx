import { createSupersetNodeConfig } from '../shared/config';
import type { NodeDefinition } from '../types';
import {
  AI_IMAGE_INPAINT_COLOR,
  AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
  AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
  AI_IMAGE_INPAINT_DEFAULT_MODEL,
  AI_IMAGE_INPAINT_DEFAULT_SIZE,
  AI_IMAGE_INPAINT_DESCRIPTION,
  AI_IMAGE_INPAINT_DISPLAY_NAME,
  AI_IMAGE_INPAINT_ICON,
} from './constants';
import { aiImageInpaintDrop } from './drop';
import {
  aiImageInpaintInputGroups,
  createAIImageInpaintInputGroup,
  resolveAIImageInpaintInputGroups,
  validateAIImageInpaintConnection,
} from './groups';
import { aiImageInpaintExecution } from './runtime';
export { AIImageInpaintNode } from './component';

export const aiImageInpaintDefinition: NodeDefinition = {
  type: 'aiImageInpaint',
  stage: 'full',
  displayName: AI_IMAGE_INPAINT_DISPLAY_NAME,
  icon: AI_IMAGE_INPAINT_ICON,
  color: AI_IMAGE_INPAINT_COLOR,
  description: AI_IMAGE_INPAINT_DESCRIPTION,
  menu: {
    order: 1,
    group: 'ai',
  },
  defaultSize: AI_IMAGE_INPAINT_DEFAULT_SIZE,
  defaultConfig: createSupersetNodeConfig({
    model: AI_IMAGE_INPAINT_DEFAULT_MODEL,
    prompt: '',
    aspectRatio: AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO,
    imageSize: AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE,
    resolutionPreset: undefined,
    editorHeight: AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
    maskMode: AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
    hasMaskMarks: false,
    maskStrokes: [],
    maskSourceFileId: undefined,
    maskSourceWidth: undefined,
    maskSourceHeight: undefined,
    inputGroups: createAIImageInpaintInputGroup(),
  }),
  inputGroups: aiImageInpaintInputGroups,
  resolveInputGroups: resolveAIImageInpaintInputGroups,
  drop: aiImageInpaintDrop,
  validateConnection: validateAIImageInpaintConnection,
  execution: aiImageInpaintExecution,
};
