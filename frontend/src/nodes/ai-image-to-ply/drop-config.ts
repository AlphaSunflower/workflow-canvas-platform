import { createGroupedDropCapability } from '../shared/grouped-drop/capability';
import {
  buildGroupedImageDropConfig,
  createAINodeTargetResolver,
  validateUniqueDraggedImageNodes,
} from '../shared/drop-config-builder';
import { resolveAIImageToPlyInputGroups } from './groups';
import {
  AI_IMAGE_TO_PLY_INPUT_PORT_ID,
  AI_IMAGE_TO_PLY_MAX_GROUPS,
} from './groups';

export type AIImageToPlyDropSide = 'input';

export const aiImageToPlyDropConfig = buildGroupedImageDropConfig({
  getTargetNode: createAINodeTargetResolver('aiImageToPly'),
  resolveInputGroups: resolveAIImageToPlyInputGroups,
  validateDraggedNodes: validateUniqueDraggedImageNodes,
  sidePortMap: Object.freeze({
    input: AI_IMAGE_TO_PLY_INPUT_PORT_ID,
  }),
  maxGroups: AI_IMAGE_TO_PLY_MAX_GROUPS,
  allowCtrl: false,
  allowShift: true,
  ctrlSingleBroadcast: false,
});

export const aiImageToPlyGroupedDrop = createGroupedDropCapability(aiImageToPlyDropConfig);
