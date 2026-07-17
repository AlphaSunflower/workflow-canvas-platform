import test from 'node:test';
import assert from 'node:assert/strict';

import {
  exportInpaintMaskImageData,
  exportInpaintMaskImageDataFromMask,
  exportInpaintMaskImageDataFromStrokes,
  hasInpaintMaskStrokeMarks,
  hasMaskMarks,
  type InpaintImageDataLike,
} from './mask-export';

function imageData(
  width: number,
  height: number,
  pixels: number[],
): InpaintImageDataLike {
  return {
    width,
    height,
    data: new Uint8ClampedArray(pixels),
  };
}

test('hasMaskMarks returns false for an empty transparent mask and true when any alpha exists', () => {
  assert.equal(hasMaskMarks(imageData(2, 1, [
    0, 0, 0, 0,
    255, 0, 0, 0,
  ])), false);

  assert.equal(hasMaskMarks(imageData(2, 1, [
    0, 0, 0, 0,
    255, 0, 0, 1,
  ])), true);
});

test('exportInpaintMaskImageData preserves dimensions', () => {
  const exported = exportInpaintMaskImageData({
    mode: 'strong-mask',
    source: imageData(2, 2, [
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
    ]),
    mask: imageData(2, 2, [
      0, 0, 0, 0,
      0, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 255,
    ]),
  });

  assert.equal(exported.width, 2);
  assert.equal(exported.height, 2);
  assert.equal(exported.data.length, 16);
});

test('original-markup export keeps source pixels and applies opaque red where marked', () => {
  const exported = exportInpaintMaskImageData({
    mode: 'original-markup',
    source: imageData(2, 1, [
      10, 20, 30, 128,
      40, 50, 60, 255,
    ]),
    mask: imageData(2, 1, [
      0, 0, 0, 0,
      255, 0, 0, 64,
    ]),
  });

  assert.deepEqual(Array.from(exported.data), [
    10, 20, 30, 128,
    255, 0, 0, 255,
  ]);
});

test('strong-mask export emits black background and white marked pixels', () => {
  const exported = exportInpaintMaskImageData({
    mode: 'strong-mask',
    source: imageData(3, 1, [
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
    ]),
    mask: imageData(3, 1, [
      0, 0, 0, 0,
      255, 0, 0, 255,
      0, 0, 0, 0,
    ]),
  });

  assert.deepEqual(Array.from(exported.data), [
    0, 0, 0, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
  ]);
});

test('exportInpaintMaskImageData rejects dimension mismatch', () => {
  let caughtError: unknown = null;

  try {
    exportInpaintMaskImageData({
      mode: 'original-markup',
      source: imageData(1, 1, [10, 20, 30, 255]),
      mask: imageData(2, 1, [
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    });
  } catch (error) {
    caughtError = error;
  }

  if (!(caughtError instanceof Error)) {
    throw new Error('Expected dimension mismatch to throw an Error.');
  }

  assert.ok(caughtError.message.includes('dimensions must match'));
});

test('exportInpaintMaskImageDataFromStrokes replays persisted strokes for original-markup', () => {
  const exported = exportInpaintMaskImageDataFromStrokes({
    mode: 'original-markup',
    source: imageData(5, 1, [
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
      130, 140, 150, 255,
    ]),
    strokes: [{
      id: 'stroke-1',
      tool: 'brush',
      brushSize: 2,
      points: [{ x: 2, y: 0 }],
    }],
  });

  assert.deepEqual(Array.from(exported.data.slice(0, 4)), [10, 20, 30, 255]);
  assert.deepEqual(Array.from(exported.data.slice(8, 12)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(exported.data.slice(16, 20)), [130, 140, 150, 255]);
});

test('exportInpaintMaskImageDataFromStrokes replays persisted strokes for strong-mask', () => {
  const exported = exportInpaintMaskImageDataFromStrokes({
    mode: 'strong-mask',
    source: imageData(5, 1, [
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
      130, 140, 150, 255,
    ]),
    strokes: [{
      id: 'stroke-1',
      tool: 'brush',
      brushSize: 2,
      points: [{ x: 2, y: 0 }],
    }],
  });

  assert.deepEqual(Array.from(exported.data.slice(0, 4)), [0, 0, 0, 255]);
  assert.deepEqual(Array.from(exported.data.slice(8, 12)), [255, 255, 255, 255]);
  assert.deepEqual(Array.from(exported.data.slice(16, 20)), [0, 0, 0, 255]);
});

test('hasInpaintMaskStrokeMarks treats erased final masks as empty', () => {
  assert.equal(hasInpaintMaskStrokeMarks([
    {
      id: 'brush',
      tool: 'brush',
      brushSize: 3,
      points: [{ x: 1, y: 1 }],
    },
    {
      id: 'eraser',
      tool: 'eraser',
      brushSize: 3,
      points: [{ x: 1, y: 1 }],
    },
  ], { width: 3, height: 3 }), false);
});

test('stroke replay preserves brush areas that are not erased', () => {
  const exported = exportInpaintMaskImageDataFromStrokes({
    mode: 'strong-mask',
    source: imageData(11, 1, [
      10, 20, 30, 255,
      20, 30, 40, 255,
      30, 40, 50, 255,
      40, 50, 60, 255,
      50, 60, 70, 255,
      60, 70, 80, 255,
      70, 80, 90, 255,
      80, 90, 100, 255,
      90, 100, 110, 255,
      100, 110, 120, 255,
      110, 120, 130, 255,
    ]),
    strokes: [
      {
        id: 'brush',
        tool: 'brush',
        brushSize: 2,
        points: [
          { x: 2, y: 0 },
          { x: 8, y: 0 },
        ],
      },
      {
        id: 'eraser',
        tool: 'eraser',
        brushSize: 2,
        points: [{ x: 5, y: 0 }],
      },
    ],
  });

  assert.deepEqual(Array.from(exported.data.slice(8, 12)), [255, 255, 255, 255]);
  assert.deepEqual(Array.from(exported.data.slice(20, 24)), [0, 0, 0, 255]);
  assert.deepEqual(Array.from(exported.data.slice(32, 36)), [255, 255, 255, 255]);
});

test('exportInpaintMaskImageDataFromStrokes rejects empty final marks', () => {
  let caughtError: unknown = null;

  try {
    exportInpaintMaskImageDataFromStrokes({
      mode: 'original-markup',
      source: imageData(1, 1, [10, 20, 30, 255]),
      strokes: [],
    });
  } catch (error) {
    caughtError = error;
  }

  if (!(caughtError instanceof Error)) {
    throw new Error('Expected empty final marks to throw an Error.');
  }

  assert.ok(caughtError.message.includes('no marked pixels'));
});

test('exportInpaintMaskImageDataFromMask preserves original-markup and strong-mask contracts', () => {
  const source = imageData(2, 1, [
    10, 20, 30, 128,
    40, 50, 60, 255,
  ]);
  const mask = imageData(2, 1, [
    0, 0, 0, 0,
    255, 0, 0, 255,
  ]);

  assert.deepEqual(Array.from(exportInpaintMaskImageDataFromMask({
    source,
    mask,
    mode: 'original-markup',
  }).data), [
    10, 20, 30, 128,
    255, 0, 0, 255,
  ]);

  assert.deepEqual(Array.from(exportInpaintMaskImageDataFromMask({
    source,
    mask,
    mode: 'strong-mask',
  }).data), [
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]);
});

test('exportInpaintMaskImageDataFromMask rejects empty masks before export', () => {
  let caughtError: unknown = null;

  try {
    exportInpaintMaskImageDataFromMask({
      mode: 'strong-mask',
      source: imageData(1, 1, [10, 20, 30, 255]),
      mask: imageData(1, 1, [0, 0, 0, 0]),
    });
  } catch (error) {
    caughtError = error;
  }

  if (!(caughtError instanceof Error)) {
    throw new Error('Expected empty final mask to throw an Error.');
  }

  assert.ok(caughtError.message.includes('no marked pixels'));
});
