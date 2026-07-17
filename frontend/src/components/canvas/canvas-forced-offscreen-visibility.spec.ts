import test from 'node:test';
import assert from 'node:assert/strict';

import type { VisibleNodeMap, VisibleNodeState } from '@/hooks/canvas/useVisibleNodes';
import { resolveForcedOffscreenImportNodeIds } from './canvas-forced-offscreen-visibility';

function createVisibility(overrides: Partial<VisibleNodeState> = {}): VisibleNodeState {
  return {
    isVisible: false,
    isNearViewport: false,
    displayWidth: 0,
    displayHeight: 0,
    visibilityBucket: 'offscreen',
    visibilityScoreBucket: 'cancel',
    visibilityAreaBucket: 'none',
    visibleAreaRatio: 0,
    viewportZoom: 1,
    visibilityScore: 0,
    centerDistance: Number.POSITIVE_INFINITY,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: true,
    renderTier: 'minimal',
    ...overrides,
  };
}

test('resolveForcedOffscreenImportNodeIds does not force importing nodes that are current candidates', () => {
  const lastAppliedVisibleNodes: VisibleNodeMap = new Map([
    ['candidate-importing', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'compact',
    })],
  ]);

  assert.deepEqual(resolveForcedOffscreenImportNodeIds({
    candidateNodeIds: ['candidate-importing'],
    importingNodeIds: ['candidate-importing'],
    lastAppliedVisibleNodes,
  }), []);
});

test('resolveForcedOffscreenImportNodeIds skips initial offscreen imports without visibility history', () => {
  assert.deepEqual(resolveForcedOffscreenImportNodeIds({
    candidateNodeIds: [],
    importingNodeIds: ['initial-offscreen-importing'],
    lastAppliedVisibleNodes: new Map(),
  }), []);
});

test('resolveForcedOffscreenImportNodeIds emits fallback only for previously renderable imports leaving candidates', () => {
  const lastAppliedVisibleNodes: VisibleNodeMap = new Map([
    ['visible-importing', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'compact',
    })],
    ['near-importing', createVisibility({
      isNearViewport: true,
      visibilityBucket: 'near',
      renderTier: 'minimal',
    })],
    ['compact-importing', createVisibility({
      visibilityBucket: 'far',
      renderTier: 'compact',
    })],
    ['minimal-offscreen-importing', createVisibility()],
  ]);

  assert.deepEqual(resolveForcedOffscreenImportNodeIds({
    candidateNodeIds: [],
    importingNodeIds: [
      'visible-importing',
      'near-importing',
      'compact-importing',
      'minimal-offscreen-importing',
    ],
    lastAppliedVisibleNodes,
  }), [
    'visible-importing',
    'near-importing',
    'compact-importing',
  ]);
});
