import { createGroupedDropCapability } from '../shared/grouped-drop/capability';
import {
  buildGroupedImageDropConfig,
  createAINodeTargetResolver,
} from '../shared/drop-config-builder';
import { resolveAIMultiViewRestoreInputGroups } from './groups';
import {
  MULTI_VIEW_RESTORE_MAX_GROUPS,
  MULTI_VIEW_RESTORE_REFERENCE_PORT_ID,
  MULTI_VIEW_RESTORE_RENDER_PORT_ID,
} from './constants';

export type AIMultiViewRestoreDropSide =
  | typeof MULTI_VIEW_RESTORE_RENDER_PORT_ID
  | typeof MULTI_VIEW_RESTORE_REFERENCE_PORT_ID;

export const aiMultiViewRestoreDropConfig = buildGroupedImageDropConfig({
  getTargetNode: createAINodeTargetResolver('aiMultiViewRestore'),
  resolveInputGroups: resolveAIMultiViewRestoreInputGroups,
  sidePortMap: Object.freeze({
    [MULTI_VIEW_RESTORE_RENDER_PORT_ID]: MULTI_VIEW_RESTORE_RENDER_PORT_ID,
    [MULTI_VIEW_RESTORE_REFERENCE_PORT_ID]: MULTI_VIEW_RESTORE_REFERENCE_PORT_ID,
  }),
  maxGroups: MULTI_VIEW_RESTORE_MAX_GROUPS,
  allowCtrl: true,
  allowShift: true,
  ctrlSingleBroadcast: true,
});

export const aiMultiViewRestoreGroupedDrop = createGroupedDropCapability(aiMultiViewRestoreDropConfig);
