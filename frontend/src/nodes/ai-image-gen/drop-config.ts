import { createSequenceGroupedDropCapability } from '../shared/grouped-drop/sequence-capability';
import {
  buildSequenceImageDropConfig,
  createAINodeTargetResolver,
  validateUniqueDraggedImageNodes,
} from '../shared/drop-config-builder';
import { resolveAIImageGenInputGroups } from './groups';
import {
  AI_IMAGE_GEN_MAX_GROUPS,
  AI_IMAGE_INPUT_PORT_ID,
} from './groups';

export type AIImageGenDropSide = 'input';

export const aiImageGenDropConfig = buildSequenceImageDropConfig({
  getTargetNode: createAINodeTargetResolver('aiImageGen'),
  resolveInputGroups: resolveAIImageGenInputGroups,
  validateDraggedNodes: validateUniqueDraggedImageNodes,
  sidePortMap: Object.freeze({
    input: AI_IMAGE_INPUT_PORT_ID,
  }),
  maxGroups: AI_IMAGE_GEN_MAX_GROUPS,
  allowCtrl: true,
  allowShift: true,
  ctrlSingleBroadcast: true,
  shiftPlacementStrategy: 'single-per-group',
  disallowHandleDuplicates: true,
  resolveDropTarget: (context, mode) => {
    if (context.target.nodeType !== 'group' || !context.target.groupId) {
      return null;
    }

    const parts = context.target.groupId.split('|');
    if (mode === 'normal') {
      if (parts[0] !== 'slot' || !parts[1] || !parts[2]) {
        return null;
      }

      return {
        kind: 'slot',
        groupId: parts[1],
        portId: parts[2],
      };
    }

    if (parts[0] !== 'panel' || !parts[1]) {
      return null;
    }

    return {
      kind: 'panel',
      side: parts[1] as AIImageGenDropSide,
    };
  },
});

export const aiImageGenGroupedDrop = createSequenceGroupedDropCapability(aiImageGenDropConfig);
