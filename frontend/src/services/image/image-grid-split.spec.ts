import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createImageGridSplitTileRects,
  validateImageGridSplitGrid,
} from './image-grid-split';

function assertThrowsMessage(action: () => void, pattern: RegExp): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof Error);
  const error = thrown as Error;
  assert.ok(pattern.test(error.message), error.message);
}

test('validateImageGridSplitGrid accepts supported custom rectangular grids', () => {
  assert.deepEqual(validateImageGridSplitGrid({ rows: 1, cols: 6 }), { rows: 1, cols: 6 });
  assert.deepEqual(validateImageGridSplitGrid({ rows: 6, cols: 1 }), { rows: 6, cols: 1 });
});

test('validateImageGridSplitGrid rejects invalid grid values', () => {
  assertThrowsMessage(() => validateImageGridSplitGrid({ rows: 0, cols: 2 }), /Rows must be between/);
  assertThrowsMessage(() => validateImageGridSplitGrid({ rows: 2, cols: 7 }), /Columns must be between/);
  assertThrowsMessage(() => validateImageGridSplitGrid({ rows: 2.5, cols: 2 }), /Rows must be an integer/);
});

test('createImageGridSplitTileRects creates preset grid tile counts', () => {
  assert.equal(createImageGridSplitTileRects(400, 400, { rows: 2, cols: 2 }).length, 4);
  assert.equal(createImageGridSplitTileRects(900, 900, { rows: 3, cols: 3 }).length, 9);
  assert.equal(createImageGridSplitTileRects(800, 800, { rows: 4, cols: 4 }).length, 16);
});

test('createImageGridSplitTileRects assigns remainder pixels to final row and column', () => {
  const rects = createImageGridSplitTileRects(10, 8, { rows: 3, cols: 4 });
  const last = rects[rects.length - 1];

  assert.equal(rects.length, 12);
  assert.deepEqual(last, {
    row: 3,
    col: 4,
    sourceX: 6,
    sourceY: 4,
    width: 4,
    height: 4,
  });

  const rowWidths = rects
    .filter((rect) => rect.row === 1)
    .reduce((sum, rect) => sum + rect.width, 0);
  const colHeights = rects
    .filter((rect) => rect.col === 1)
    .reduce((sum, rect) => sum + rect.height, 0);

  assert.equal(rowWidths, 10);
  assert.equal(colHeights, 8);
});

test('createImageGridSplitTileRects rejects grids larger than image dimensions', () => {
  assertThrowsMessage(
    () => createImageGridSplitTileRects(4, 6, { rows: 6, cols: 5 }),
    /smaller than the split grid/,
  );
});
