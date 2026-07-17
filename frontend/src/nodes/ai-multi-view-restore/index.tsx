import { createAIImageInputGroup } from '@/utils/node';
import { createSupersetNodeConfig } from '../shared/config';
import type { NodeDefinition } from '../types';
import {
  MULTI_VIEW_RESTORE_COLOR,
  MULTI_VIEW_RESTORE_DEFAULT_CONFIG,
  MULTI_VIEW_RESTORE_DEFAULT_SIZE,
  MULTI_VIEW_RESTORE_DESCRIPTION,
  MULTI_VIEW_RESTORE_DISPLAY_NAME,
  MULTI_VIEW_RESTORE_ICON,
  MULTI_VIEW_RESTORE_MIN_GROUPS,
} from './constants';
import {
  aiMultiViewRestoreInputGroups,
  resolveAIMultiViewRestoreInputGroups,
  validateAIMultiViewRestoreConnection,
} from './groups';
import { aiMultiViewRestoreDrop } from './drop';
import { aiMultiViewRestoreExecution } from './runtime';

export const aiMultiViewRestoreDefinition: NodeDefinition = {
  type: 'aiMultiViewRestore',
  stage: 'full',
  displayName: MULTI_VIEW_RESTORE_DISPLAY_NAME,
  icon: MULTI_VIEW_RESTORE_ICON,
  color: MULTI_VIEW_RESTORE_COLOR,
  description: MULTI_VIEW_RESTORE_DESCRIPTION,
  menu: {
    order: 3,
    group: 'ai',
  },
  defaultSize: MULTI_VIEW_RESTORE_DEFAULT_SIZE,
  defaultConfig: createSupersetNodeConfig({
    ...MULTI_VIEW_RESTORE_DEFAULT_CONFIG,
    inputGroups: Array.from(
      { length: MULTI_VIEW_RESTORE_MIN_GROUPS },
      (_, index) => createAIImageInputGroup(index)
    ),
  }),
  inputGroups: aiMultiViewRestoreInputGroups,
  resolveInputGroups: resolveAIMultiViewRestoreInputGroups,
  drop: aiMultiViewRestoreDrop,
  validateConnection: validateAIMultiViewRestoreConnection,
  execution: aiMultiViewRestoreExecution,
};
