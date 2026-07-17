import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearCanvasNodeLocalActiveState,
  clearCanvasRuntimeVisualStateSnapshot,
  getCanvasRuntimeVisualState,
  resolveCanvasRuntimeVisualState,
  syncCanvasNodeLocalActiveState,
  syncCanvasRuntimeVisualStateSnapshot,
} from './canvas-runtime-visual-state';

test('resolveCanvasRuntimeVisualState merges canvas and local active reasons into final render tier', () => {
  const snapshot = resolveCanvasRuntimeVisualState({
    scheduledRenderTier: 'compact',
    canvasState: {
      activeState: 'active',
      activeReasons: ['selected'],
    },
    localState: {
      activeState: 'active',
      activeReasons: ['viewer', 'upload-active'],
    },
  });

  assert.equal(snapshot.scheduledRenderTier, 'compact');
  assert.equal(snapshot.canvasActiveState, 'active');
  assert.equal(snapshot.localActiveState, 'active');
  assert.equal(snapshot.activeState, 'active');
  assert.deepEqual(snapshot.activeReasons, ['selected', 'upload-active', 'viewer']);
  assert.equal(snapshot.renderTier, 'full');
});

test('canvas runtime visual state snapshot sync tracks scheduled render tier and local active state separately', () => {
  clearCanvasRuntimeVisualStateSnapshot();

  syncCanvasRuntimeVisualStateSnapshot([
    ['node-a', {
      scheduledRenderTier: 'minimal',
      canvasState: {
        activeState: 'passive',
        activeReasons: [],
      },
    }],
  ]);

  let snapshot = getCanvasRuntimeVisualState('node-a');
  assert.equal(snapshot.scheduledRenderTier, 'minimal');
  assert.equal(snapshot.activeState, 'passive');
  assert.equal(snapshot.renderTier, 'minimal');

  syncCanvasNodeLocalActiveState('node-a', {
    activeState: 'active',
    activeReasons: ['viewer'],
  });

  snapshot = getCanvasRuntimeVisualState('node-a');
  assert.equal(snapshot.localActiveState, 'active');
  assert.deepEqual(snapshot.localActiveReasons, ['viewer']);
  assert.equal(snapshot.activeState, 'active');
  assert.equal(snapshot.renderTier, 'full');

  clearCanvasNodeLocalActiveState('node-a');
  snapshot = getCanvasRuntimeVisualState('node-a');
  assert.equal(snapshot.localActiveState, 'passive');
  assert.equal(snapshot.renderTier, 'minimal');

  clearCanvasRuntimeVisualStateSnapshot();
  snapshot = getCanvasRuntimeVisualState('node-a', 'compact');
  assert.equal(snapshot.scheduledRenderTier, 'compact');
  assert.equal(snapshot.activeState, 'passive');
  assert.equal(snapshot.renderTier, 'compact');
});

test('getCanvasRuntimeVisualState returns stable snapshot references until state changes', () => {
  clearCanvasRuntimeVisualStateSnapshot();

  const fallbackA = getCanvasRuntimeVisualState('node-stable', 'compact');
  const fallbackB = getCanvasRuntimeVisualState('node-stable', 'compact');
  assert.equal(fallbackA, fallbackB);

  syncCanvasRuntimeVisualStateSnapshot([
    ['node-stable', {
      scheduledRenderTier: 'minimal',
      canvasState: {
        activeState: 'passive',
        activeReasons: [],
      },
    }],
  ]);

  const syncedA = getCanvasRuntimeVisualState('node-stable', 'compact');
  const syncedB = getCanvasRuntimeVisualState('node-stable', 'compact');
  assert.equal(syncedA, syncedB);
  assert.notStrictEqual(syncedA, fallbackA);

  syncCanvasNodeLocalActiveState('node-stable', {
    activeState: 'active',
    activeReasons: ['viewer'],
  });

  const localA = getCanvasRuntimeVisualState('node-stable', 'compact');
  const localB = getCanvasRuntimeVisualState('node-stable', 'compact');
  assert.equal(localA, localB);
  assert.notStrictEqual(localA, syncedA);

  clearCanvasNodeLocalActiveState('node-stable');
  const cleared = getCanvasRuntimeVisualState('node-stable', 'compact');
  assert.notStrictEqual(cleared, localA);
  assert.equal(cleared, getCanvasRuntimeVisualState('node-stable', 'compact'));
});
