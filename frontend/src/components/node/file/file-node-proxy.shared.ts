import { resolveNodeRenderTierWithActiveState } from '@/hooks/canvas/node-render-tier';
import type { FileNodeData, NodeActiveState, NodeRenderTier } from '@/types';

export interface ResolveImageNodeProxyRoutingInput {
  nodeType: FileNodeData['type'];
  scheduledRenderTier: NodeRenderTier;
  canvasActiveState?: NodeActiveState;
}

export interface ImageNodeProxyRoutingDecision {
  activeState: NodeActiveState;
  renderTier: NodeRenderTier;
  useProxy: boolean;
  imageResourceOwner?: FileNodeData['imageResourceOwner'];
}

export function resolveImageNodeProxyRouting(
  input: ResolveImageNodeProxyRoutingInput,
): ImageNodeProxyRoutingDecision {
  const activeState: NodeActiveState = input.canvasActiveState === 'active'
    ? 'active'
    : 'passive';
  const renderTier = resolveNodeRenderTierWithActiveState(input.scheduledRenderTier, activeState);

  return {
    activeState,
    renderTier,
    useProxy: input.nodeType === 'image' && renderTier !== 'full',
  };
}

export function resolveFileNodeProxyStatusLabel(status: FileNodeData['status']): string | undefined {
  if (status === 'error') {
    return 'ERROR';
  }

  if (status === 'pending' || status === 'processing') {
    return 'IMPORTING';
  }

  return undefined;
}
