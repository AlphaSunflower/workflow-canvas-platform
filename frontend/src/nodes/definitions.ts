import { aiFloorplanColorizeDefinition } from './ai-floorplan-colorize';
import { aiImageGenDefinition } from './ai-image-gen';
import { aiImageHdDefinition } from './ai-image-hd';
import { aiImageInpaintDefinition } from './ai-image-inpaint';
import { aiImageToPlyDefinition } from './ai-image-to-ply';
import { aiModelRenderTransferDefinition } from './ai-model-render-transfer';
import { aiMultiViewRestoreDefinition } from './ai-multi-view-restore';
import { aiStoryboardDefinition } from './ai-storyboard';
import { aiVideoGenDefinition } from './ai-video-gen';
import type { NodeDefinition } from './types';

export const aiNodeDefinitions: NodeDefinition[] = [
  aiImageGenDefinition,
  aiImageInpaintDefinition,
  aiStoryboardDefinition,
  aiModelRenderTransferDefinition,
  aiImageToPlyDefinition,
  aiMultiViewRestoreDefinition,
  aiImageHdDefinition,
  {
    ...aiFloorplanColorizeDefinition,
    menu: {
      ...aiFloorplanColorizeDefinition.menu,
      visible: true,
    },
  },
  aiVideoGenDefinition,
];

export const placeholderNodeDefinitions: NodeDefinition[] = aiNodeDefinitions.filter(
  (definition) => definition.stage === 'placeholder',
);
