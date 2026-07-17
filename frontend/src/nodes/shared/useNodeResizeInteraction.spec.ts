import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeResizeInteractionZoom,
  resolveNodeResizeDimensions,
  resolveResizeCommitUpdate,
  resolveNodeResizeScale,
  toCanvasResizeDelta,
} from './useNodeResizeInteraction';

test('toCanvasResizeDelta normalizes pointer movement by viewport zoom', () => {
  assert.deepEqual(
    toCanvasResizeDelta({ x: 80, y: 40 }, 2),
    { x: 40, y: 20 },
  );
  assert.deepEqual(
    toCanvasResizeDelta({ x: 80, y: 40 }, 0.5),
    { x: 160, y: 80 },
  );
});

test('resolveNodeResizeDimensions keeps canvas-size changes consistent across zoom levels', () => {
  const startDimensions = { width: 320, height: 240 };
  const minDimensions = { width: 200, height: 160 };

  assert.deepEqual(
    resolveNodeResizeDimensions({
      startDimensions,
      minDimensions,
      screenDelta: { x: 80, y: 40 },
      zoom: 2,
    }),
    { width: 360, height: 260 },
  );
  assert.deepEqual(
    resolveNodeResizeDimensions({
      startDimensions,
      minDimensions,
      screenDelta: { x: 40, y: 20 },
      zoom: 1,
    }),
    { width: 360, height: 260 },
  );
});

test('resolveNodeResizeDimensions applies minimum dimensions after zoom conversion', () => {
  assert.deepEqual(
    resolveNodeResizeDimensions({
      startDimensions: { width: 320, height: 240 },
      minDimensions: { width: 300, height: 220 },
      screenDelta: { x: -200, y: -100 },
      zoom: 2,
    }),
    { width: 300, height: 220 },
  );
});

test('resolveNodeResizeScale uses canvas delta for dominant-axis file node scaling', () => {
  const clampScale = (scale: number): number => Math.min(2, Math.max(0.5, scale));

  assert.deepEqual(
    resolveNodeResizeScale({
      startDimensions: { width: 200, height: 100 },
      baseDimensions: { width: 100, height: 50 },
      startScale: 2,
      screenDelta: { x: -100, y: 0 },
      zoom: 2,
      clampScale,
    }),
    {
      scale: 1.5,
      dimensions: { width: 150, height: 75 },
    },
  );
});

test('normalizeResizeInteractionZoom falls back to one for invalid zoom', () => {
  assert.equal(normalizeResizeInteractionZoom(0), 1);
  assert.equal(normalizeResizeInteractionZoom(Number.NaN), 1);
  assert.equal(normalizeResizeInteractionZoom(1.5), 1.5);
});

test('resolveResizeCommitUpdate returns the last applied resize update', () => {
  const update = { config: { editorHeight: 520 } };
  assert.equal(resolveResizeCommitUpdate(update), update);
  assert.equal(resolveResizeCommitUpdate(null), null);
});
