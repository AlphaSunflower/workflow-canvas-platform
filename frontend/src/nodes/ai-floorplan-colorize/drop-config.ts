import { createGroupedDropCapability } from '../shared/grouped-drop/capability';
import {
  buildGroupedImageDropConfig,
  createAINodeTargetResolver,
  validateUniqueDraggedImageNodes,
} from '../shared/drop-config-builder';
import {
  AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID,
  AI_FLOORPLAN_COLORIZE_MAX_GROUPS,
} from './constants';
import { resolveAIFloorplanColorizeInputGroups } from './groups';

export type AIFloorplanColorizeDropSide = 'input';

export const aiFloorplanColorizeDropConfig = buildGroupedImageDropConfig({
  getTargetNode: createAINodeTargetResolver('aiFloorplanColorize'),
  resolveInputGroups: resolveAIFloorplanColorizeInputGroups,
  validateDraggedNodes: validateUniqueDraggedImageNodes,
  sidePortMap: Object.freeze({
    input: AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID,
  }),
  maxGroups: AI_FLOORPLAN_COLORIZE_MAX_GROUPS,
  allowCtrl: false,
  allowShift: true,
  ctrlSingleBroadcast: false,
});

export const aiFloorplanColorizeGroupedDrop = createGroupedDropCapability(
  aiFloorplanColorizeDropConfig
);
