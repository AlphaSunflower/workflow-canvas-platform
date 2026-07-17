import type { NodeDefinition } from '../types';
import { aiMultiViewRestoreGroupedDrop } from './drop-config';

export const aiMultiViewRestoreDrop: NonNullable<NodeDefinition['drop']> =
  aiMultiViewRestoreGroupedDrop;
