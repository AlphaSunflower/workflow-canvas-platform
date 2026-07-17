import type { NodeDefinition } from '../types';
import { aiFloorplanColorizeGroupedDrop } from './drop-config';

export const aiFloorplanColorizeDrop: NonNullable<NodeDefinition['drop']> =
  aiFloorplanColorizeGroupedDrop;
