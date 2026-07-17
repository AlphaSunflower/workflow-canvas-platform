import test from 'node:test';
import assert from 'node:assert/strict';

import { createCanvasDragRenderCoordinator } from './canvas-drag-render-coordinator';

test('canvas drag render coordinator tracks anchor viewport and computes drag transform from latest viewport', () => {
  const coordinator = createCanvasDragRenderCoordinator();

  coordinator.start({ x: 100, y: 40, zoom: 1 });
  coordinator.update({ x: 180, y: 120, zoom: 1.5 });

  const snapshot = coordinator.getSnapshot();
  const transform = coordinator.getTransform();

  assert.equal(snapshot.isDragging, true);
  assert.deepEqual(snapshot.anchorViewport, { x: 100, y: 40, zoom: 1 });
  assert.deepEqual(snapshot.currentViewport, { x: 180, y: 120, zoom: 1.5 });
  assert.deepEqual(transform, {
    scale: 1.5,
    translateX: 30,
    translateY: 60,
    matrix: 'matrix(1.5,0,0,1.5,30,60)',
  });
});

test('canvas drag render coordinator clears drag transform after end and keeps final viewport snapshot', () => {
  const coordinator = createCanvasDragRenderCoordinator();

  coordinator.start({ x: 0, y: 0, zoom: 1 });
  coordinator.update({ x: 40, y: 60, zoom: 0.8 });
  const ended = coordinator.end({ x: 48, y: 72, zoom: 0.75 });

  assert.equal(ended.isDragging, false);
  assert.equal(ended.anchorViewport, null);
  assert.deepEqual(ended.currentViewport, { x: 48, y: 72, zoom: 0.75 });
  assert.equal(coordinator.getTransform(), null);
});
