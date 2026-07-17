import type { NodeId } from '@/types';

export const MAX_NODE_ID = 99999;

export const NODE_ID_EXHAUSTED_ERROR = 'Node ID exhausted: maximum of 99999 nodes reached';

export function generateNodeId(sequence: number): NodeId {
  if (sequence < 1 || sequence > MAX_NODE_ID) {
    throw new Error(`Invalid node ID sequence: ${sequence}. Must be between 1 and ${MAX_NODE_ID}`);
  }

  const value = String(sequence);
  const display = `#${value.padStart(5, '0')}`;
  return { value, display };
}
