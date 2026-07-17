import type { NodeDefinition } from '../types';
import { aiImageToPlyGroupedDrop } from './drop-config';

export const aiImageToPlyDrop: NonNullable<NodeDefinition['drop']> =
  aiImageToPlyGroupedDrop;
