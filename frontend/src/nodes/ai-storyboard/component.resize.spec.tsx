import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_STORYBOARD_MIN_HEIGHT,
  AI_STORYBOARD_MIN_WIDTH,
} from './constants';
import { resolveAIStoryboardAutoDimensions } from './component';
import { resolveNodeResizeDimensions } from '../shared/useNodeResizeInteraction';

test('storyboard resize keeps canvas delta consistent across viewport zoom levels', () => {
  const startDimensions = { width: 920, height: 320 };
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

  assert.deepEqual(zoomOne, { width: 1020, height: 400 });
  assert.deepEqual(zoomTwo, { width: 970, height: 360 });
});

test('storyboard resize still clamps to storyboard minimum dimensions after zoom conversion', () => {
  const nextDimensions = resolveNodeResizeDimensions({
    startDimensions: { width: 800, height: 320 },
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

test('storyboard auto dimensions follow measured content height without jittering on tiny changes', () => {
  assert.deepEqual(resolveAIStoryboardAutoDimensions(
    { width: 920, height: 320 },
    684.2,
  ), {
    width: 920,
    height: 685,
  });

  assert.deepEqual(resolveAIStoryboardAutoDimensions(
    { width: 740, height: 260 },
    194.2,
  ), {
    width: AI_STORYBOARD_MIN_WIDTH,
    height: AI_STORYBOARD_MIN_HEIGHT,
  });

  assert.deepEqual(resolveAIStoryboardAutoDimensions(
    { width: 920, height: 320 },
    211.2,
  ), {
    width: 920,
    height: 212,
  });

  assert.equal(resolveAIStoryboardAutoDimensions(
    { width: 920, height: 684 },
    685.1,
  ), null);
});
