import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_STORYBOARD_MIN_HEIGHT,
  AI_STORYBOARD_MIN_WIDTH,
} from './constants';
import { resolveNodeResizeDimensions } from '../shared/useNodeResizeInteraction';

test('storyboard resize keeps canvas delta consistent across viewport zoom levels', () => {
  const startDimensions = { width: 1080, height: 760 };
  const zoomOne = resolveNodeResizeDimensions({
    startDimensions,
    minDimensions: {
      width: AI_STORYBOARD_MIN_WIDTH,
      height: AI_STORYBOARD_MIN_HEIGHT,
    },
    screenDelta: { x: 100, y: 80 },
    zoom: 1,
  });
  const zoomTwo = resolveNodeResizeDimensions({
    startDimensions,
    minDimensions: {
      width: AI_STORYBOARD_MIN_WIDTH,
      height: AI_STORYBOARD_MIN_HEIGHT,
    },
    screenDelta: { x: 100, y: 80 },
    zoom: 2,
  });

  assert.deepEqual(zoomOne, { width: 1180, height: 840 });
  assert.deepEqual(zoomTwo, { width: 1130, height: 800 });
});

test('storyboard resize still clamps to storyboard minimum dimensions after zoom conversion', () => {
  const nextDimensions = resolveNodeResizeDimensions({
    startDimensions: { width: 900, height: 700 },
    minDimensions: {
      width: AI_STORYBOARD_MIN_WIDTH,
      height: AI_STORYBOARD_MIN_HEIGHT,
    },
    screenDelta: { x: -400, y: -400 },
    zoom: 2,
  });

  assert.deepEqual(nextDimensions, {
    width: AI_STORYBOARD_MIN_WIDTH,
    height: AI_STORYBOARD_MIN_HEIGHT,
  });
});
