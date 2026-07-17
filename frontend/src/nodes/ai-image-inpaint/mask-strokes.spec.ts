import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cloneAIImageInpaintMaskStrokes,
  createAIImageInpaintMaskSnapshotSignature,
  createAIImageInpaintMaskStrokesSignature,
  createEmptyAIImageInpaintMaskStrokes,
  isAIImageInpaintMaskPoint,
  isAIImageInpaintMaskStroke,
  isAIImageInpaintTool,
  normalizeAIImageInpaintMaskStrokes,
} from './mask-strokes';

test('createEmptyAIImageInpaintMaskStrokes returns a fresh empty array', () => {
  const first = createEmptyAIImageInpaintMaskStrokes();
  const second = createEmptyAIImageInpaintMaskStrokes();

  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.ok(first !== second);
});

test('mask stroke guards accept brush and eraser strokes with finite points', () => {
  const stroke = {
    id: 'stroke-1',
    tool: 'brush',
    brushSize: 24,
    points: [
      { x: 10, y: 12 },
      { x: 40, y: 48 },
    ],
  };

  assert.equal(isAIImageInpaintTool('brush'), true);
  assert.equal(isAIImageInpaintTool('eraser'), true);
  assert.equal(isAIImageInpaintMaskPoint(stroke.points[0]), true);
  assert.equal(isAIImageInpaintMaskStroke(stroke), true);
});

test('normalizeAIImageInpaintMaskStrokes drops malformed persisted strokes', () => {
  const normalized = normalizeAIImageInpaintMaskStrokes([
    {
      id: 'valid-brush',
      tool: 'brush',
      brushSize: 12,
      points: [{ x: 1, y: 2 }],
    },
    {
      id: 'valid-eraser',
      tool: 'eraser',
      brushSize: 32,
      points: [{ x: 3, y: 4 }],
    },
    {
      id: 'missing-points',
      tool: 'brush',
      brushSize: 12,
    },
    {
      id: 'bad-size',
      tool: 'brush',
      brushSize: 0,
      points: [{ x: 1, y: 2 }],
    },
    {
      id: 'bad-tool',
      tool: 'fill',
      brushSize: 12,
      points: [{ x: 1, y: 2 }],
    },
  ]);

  assert.deepEqual(normalized.map((stroke) => stroke.id), [
    'valid-brush',
    'valid-eraser',
  ]);
});

test('cloneAIImageInpaintMaskStrokes returns a deep stroke copy', () => {
  const strokes = [{
    id: 'stroke-1',
    tool: 'brush' as const,
    brushSize: 12,
    points: [{ x: 1, y: 2 }],
  }];

  const cloned = cloneAIImageInpaintMaskStrokes(strokes);
  assert.deepEqual(cloned, strokes);
  assert.ok(cloned !== strokes);
  assert.ok(cloned[0] !== strokes[0]);
  assert.ok(cloned[0].points !== strokes[0].points);
});

test('mask stroke signatures distinguish stroke and source changes', () => {
  const strokes = [{
    id: 'stroke-1',
    tool: 'brush' as const,
    brushSize: 12,
    points: [{ x: 1, y: 2 }],
  }];
  const sameStrokes = cloneAIImageInpaintMaskStrokes(strokes);
  const changedStrokes = [{
    ...strokes[0],
    points: [{ x: 1, y: 3 }],
  }];

  assert.equal(
    createAIImageInpaintMaskStrokesSignature(strokes),
    createAIImageInpaintMaskStrokesSignature(sameStrokes),
  );
  assert.ok(
    createAIImageInpaintMaskStrokesSignature(strokes)
      !== createAIImageInpaintMaskStrokesSignature(changedStrokes),
  );
  assert.ok(
    createAIImageInpaintMaskSnapshotSignature({
      strokes,
      sourceInfo: { fileId: 'file-1', width: 10, height: 10 },
      hasMarks: true,
    })
      !== createAIImageInpaintMaskSnapshotSignature({
      strokes,
      sourceInfo: { fileId: 'file-2', width: 10, height: 10 },
      hasMarks: true,
    }),
  );
});
