import { createGroupedDropCapability } from '../shared/grouped-drop/capability';
import {
  buildGroupedImageDropConfig,
  createAINodeTargetResolver,
  validateUniqueDraggedImageNodes,
} from '../shared/drop-config-builder';
import { resolveAIImageHdInputGroups } from './groups';
import {
  AI_IMAGE_HD_INPUT_PORT_ID,
  AI_IMAGE_HD_MAX_GROUPS,
} from './constants';

export type AIImageHdDropSide = 'input';
export const aiImageHdDropConfig = buildGroupedImageDropConfig({
  getTargetNode: createAINodeTargetResolver('aiImageHd'),
  resolveInputGroups: resolveAIImageHdInputGroups,
  validateDraggedNodes: validateUniqueDraggedImageNodes,
  sidePortMap: Object.freeze({
    input: AI_IMAGE_HD_INPUT_PORT_ID,
  }),
  maxGroups: AI_IMAGE_HD_MAX_GROUPS,
  allowCtrl: false,
  allowShift: true,
  ctrlSingleBroadcast: false,
});

export const aiImageHdGroupedDrop = createGroupedDropCapability(aiImageHdDropConfig);
