import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearCanvasActiveNodeStateSnapshot,
  createCanvasActiveNodeStateEntry,
  getCanvasActiveNodeState,
  promoteCanvasNode,
  clearPromotedCanvasNodeReason,
  resolveCanvasActiveNodeState,
  resolveFileNodeActiveState,
  syncCanvasActiveNodeStateSnapshot,
} from './canvas-active-node-state';

test('resolveCanvasActiveNodeState marks selected nodes as active', () => {
  const snapshot = resolveCanvasActiveNodeState({
    selected: true,
  });

  assert.equal(snapshot.activeState, 'active');
  assert.deepEqual(snapshot.activeReasons, ['selected']);
});

test('resolveCanvasActiveNodeState merges multiple active reasons and deduplicates them', () => {
  const snapshot = resolveCanvasActiveNodeState({
    hovered: true,
    dragging: true,
    contextMenuTarget: true,
    importError: true,
  });

  assert.equal(snapshot.activeState, 'active');
  assert.deepEqual(snapshot.activeReasons, [
    'context-menu',
    'dragging',
    'hovered',
    'import-error',
  ]);
});

test('resolveCanvasActiveNodeState leaves inactive nodes passive', () => {
  const snapshot = resolveCanvasActiveNodeState({});

  assert.equal(snapshot.activeState, 'passive');
  assert.deepEqual(snapshot.activeReasons, []);
});

test('syncCanvasActiveNodeStateSnapshot stores and clears node snapshots', () => {
  clearCanvasActiveNodeStateSnapshot();

  syncCanvasActiveNodeStateSnapshot([
    ['node-a', resolveCanvasActiveNodeState({ selected: true })],
    ['node-b', resolveCanvasActiveNodeState({ hovered: true })],
  ]);

  assert.deepEqual(getCanvasActiveNodeState('node-a').activeReasons, ['selected']);
  assert.deepEqual(getCanvasActiveNodeState('node-b').activeReasons, ['hovered']);

  clearCanvasActiveNodeStateSnapshot();

  assert.equal(getCanvasActiveNodeState('node-a').activeState, 'passive');
  assert.deepEqual(getCanvasActiveNodeState('node-a').activeReasons, []);
});

test('createCanvasActiveNodeStateEntry derives import-error reason from file node status', () => {
  clearCanvasActiveNodeStateSnapshot();

  const [nodeId, snapshot] = createCanvasActiveNodeStateEntry({
    id: {
      value: 'node-import-error',
      display: '#00001',
    },
    status: 'error',
  }, {});

  assert.equal(nodeId, 'node-import-error');
  assert.equal(snapshot.activeState, 'active');
  assert.deepEqual(snapshot.activeReasons, ['import-error']);
});

test('resolveFileNodeActiveState merges canvas state with local interaction and upload reasons', () => {
  const snapshot = resolveFileNodeActiveState({
    canvasState: resolveCanvasActiveNodeState({
      selected: true,
      contextMenuTarget: true,
    }),
    uploadStatus: 'uploading',
    isViewerOpen: true,
    isPreviewPlaying: true,
    isResizing: true,
  });

  assert.equal(snapshot.activeState, 'active');
  assert.deepEqual(snapshot.activeReasons, [
    'context-menu',
    'preview-playing',
    'resizing',
    'selected',
    'upload-active',
    'viewer',
  ]);
});

test('getCanvasActiveNodeState returns stable snapshot references until active reasons change', () => {
  clearCanvasActiveNodeStateSnapshot();

  const passiveA = getCanvasActiveNodeState('node-stable');
  const passiveB = getCanvasActiveNodeState('node-stable');
  assert.equal(passiveA, passiveB);

  syncCanvasActiveNodeStateSnapshot([
    ['node-stable', resolveCanvasActiveNodeState({ selected: true })],
  ]);

  const baseA = getCanvasActiveNodeState('node-stable');
  const baseB = getCanvasActiveNodeState('node-stable');
  assert.equal(baseA, baseB);
  assert.notStrictEqual(baseA, passiveA);

  promoteCanvasNode('node-stable', ['viewer']);
  const promotedA = getCanvasActiveNodeState('node-stable');
  const promotedB = getCanvasActiveNodeState('node-stable');
  assert.equal(promotedA, promotedB);
  assert.notStrictEqual(promotedA, baseA);

  clearPromotedCanvasNodeReason('node-stable', 'viewer');
  const restored = getCanvasActiveNodeState('node-stable');
  assert.equal(restored, getCanvasActiveNodeState('node-stable'));
  assert.notStrictEqual(restored, promotedA);
});
