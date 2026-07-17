import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearCanvasImageFirstPaint,
  clearCanvasImageFirstPaintState,
  hasCanvasImageFirstPainted,
  markCanvasImageFirstPainted,
  retainCanvasImageFirstPaintNodeIds,
} from './canvas-image-first-paint-store';

test('canvas image first-paint store tracks painted state by node id and current src', () => {
  clearCanvasImageFirstPaintState();

  markCanvasImageFirstPainted('node-1', 'blob:thumb-1');

  assert.equal(hasCanvasImageFirstPainted('node-1', 'blob:thumb-1'), true);
  assert.equal(hasCanvasImageFirstPainted('node-1', 'blob:thumb-2'), false);
  assert.equal(hasCanvasImageFirstPainted('node-2', 'blob:thumb-1'), false);

  clearCanvasImageFirstPaintState();
});

test('canvas image first-paint store overwrites stale src and supports targeted clearing', () => {
  clearCanvasImageFirstPaintState();

  markCanvasImageFirstPainted('node-1', 'blob:thumb-1');
  markCanvasImageFirstPainted('node-1', 'blob:thumb-2');

  assert.equal(hasCanvasImageFirstPainted('node-1', 'blob:thumb-1'), false);
  assert.equal(hasCanvasImageFirstPainted('node-1', 'blob:thumb-2'), true);

  clearCanvasImageFirstPaint('node-1');
  assert.equal(hasCanvasImageFirstPainted('node-1', 'blob:thumb-2'), false);

  clearCanvasImageFirstPaintState();
});

test('canvas image first-paint store retains only live node ids so workflow switches do not keep stale painted entries', () => {
  clearCanvasImageFirstPaintState();

  markCanvasImageFirstPainted('node-1', 'blob:thumb-1');
  markCanvasImageFirstPainted('node-2', 'blob:thumb-2');

  retainCanvasImageFirstPaintNodeIds(['node-2']);

  assert.equal(hasCanvasImageFirstPainted('node-1', 'blob:thumb-1'), false);
  assert.equal(hasCanvasImageFirstPainted('node-2', 'blob:thumb-2'), true);

  clearCanvasImageFirstPaintState();
});

test('canvas image first-paint store reset clears reused node ids before a new workflow or reimport can inherit painted state', () => {
  clearCanvasImageFirstPaintState();

  markCanvasImageFirstPainted('node-reused', 'blob:thumb-shared');
  assert.equal(hasCanvasImageFirstPainted('node-reused', 'blob:thumb-shared'), true);

  clearCanvasImageFirstPaintState();

  assert.equal(hasCanvasImageFirstPainted('node-reused', 'blob:thumb-shared'), false);
});
