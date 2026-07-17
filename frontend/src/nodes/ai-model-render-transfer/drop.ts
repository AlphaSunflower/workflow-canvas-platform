import type { NodeDefinition } from '../types';
import { aiModelRenderTransferGroupedDrop } from './drop-config';

export const aiModelRenderTransferDrop: NonNullable<NodeDefinition['drop']> =
  aiModelRenderTransferGroupedDrop;
