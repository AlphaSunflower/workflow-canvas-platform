import { createGroupedDropCapability } from '../shared/grouped-drop/capability';
import {
  buildGroupedImageDropConfig,
  createAINodeTargetResolver,
} from '../shared/drop-config-builder';
import { resolveAIModelRenderTransferInputGroups } from './groups';
import {
  MODEL_RENDER_TRANSFER_MAX_GROUPS,
  MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
  MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
} from './constants';

export type AIModelRenderTransferDropSide =
  | typeof MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID
  | typeof MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID;

export const aiModelRenderTransferDropConfig = buildGroupedImageDropConfig({
  getTargetNode: createAINodeTargetResolver('aiModelRenderTransfer'),
  resolveInputGroups: resolveAIModelRenderTransferInputGroups,
  sidePortMap: Object.freeze({
    [MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID]: MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
    [MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID]: MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
  }),
  maxGroups: MODEL_RENDER_TRANSFER_MAX_GROUPS,
  allowCtrl: true,
  allowShift: true,
  ctrlSingleBroadcast: true,
});

export const aiModelRenderTransferGroupedDrop = createGroupedDropCapability(aiModelRenderTransferDropConfig);
