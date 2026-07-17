import test from 'node:test';
import assert from 'node:assert/strict';

import { createViewportSyncController } from './viewport-sync';

function runScheduledTask(task: (() => void) | null): void {
  if (typeof task === 'function') {
    task();
  }
}

test('viewport sync controller throttles frequent viewport updates and only commits the latest pending viewport', () => {
  let scheduledTask: (() => void) | null = null;
  let timerIdSeed = 0;
  const committed: Array<{ x: number; y: number; zoom: number }> = [];

  const controller = createViewportSyncController({
    delayMs: 48,
    setTimeoutImpl: ((callback: () => void) => {
      scheduledTask = callback;
      timerIdSeed += 1;
      return timerIdSeed;
    }) as typeof window.setTimeout,
    clearTimeoutImpl: (() => {
      scheduledTask = null;
    }) as typeof window.clearTimeout,
    onCommit: (viewport) => {
      committed.push(viewport);
    },
  });

  controller.schedule({ x: 0, y: 0, zoom: 1 });
  controller.schedule({ x: 20, y: 30, zoom: 1.2 });
  controller.schedule({ x: 36, y: 42, zoom: 1.35 });

  assert.equal(committed.length, 0);
  assert.ok(scheduledTask);

  runScheduledTask(scheduledTask);

  assert.deepEqual(committed, [{ x: 36, y: 42, zoom: 1.35 }]);
});

test('viewport sync controller flush commits immediately and cancels pending timer state', () => {
  let clearCalled = 0;
  let scheduledTask: (() => void) | null = null;
  const committed: Array<{ x: number; y: number; zoom: number }> = [];

  const controller = createViewportSyncController({
    delayMs: 48,
    setTimeoutImpl: ((callback: () => void) => {
      scheduledTask = callback;
      return 1;
    }) as typeof window.setTimeout,
    clearTimeoutImpl: (() => {
      clearCalled += 1;
      scheduledTask = null;
    }) as typeof window.clearTimeout,
    onCommit: (viewport) => {
      committed.push(viewport);
    },
  });

  controller.schedule({ x: 12, y: 18, zoom: 1.1 });
  controller.flush();
  runScheduledTask(scheduledTask);

  assert.equal(clearCalled, 1);
  assert.deepEqual(committed, [{ x: 12, y: 18, zoom: 1.1 }]);
});

test('viewport sync controller flush can commit an explicit final viewport over pending state', () => {
  let scheduledTask: (() => void) | null = null;
  const committed: Array<{ x: number; y: number; zoom: number }> = [];

  const controller = createViewportSyncController({
    delayMs: 48,
    setTimeoutImpl: ((callback: () => void) => {
      scheduledTask = callback;
      return 1;
    }) as typeof window.setTimeout,
    clearTimeoutImpl: (() => {
      scheduledTask = null;
    }) as typeof window.clearTimeout,
    onCommit: (viewport) => {
      committed.push(viewport);
    },
  });

  controller.schedule({ x: 0, y: 0, zoom: 1 });
  const flushed = controller.flush({ x: 160, y: 120, zoom: 0.75 });
  runScheduledTask(scheduledTask);

  assert.equal(flushed, true);
  assert.deepEqual(committed, [{ x: 160, y: 120, zoom: 0.75 }]);
});

test('viewport sync controller suspend keeps latest viewport without committing until final flush', () => {
  let scheduledTask: (() => void) | null = null;
  let clearCalled = 0;
  const committed: Array<{ x: number; y: number; zoom: number }> = [];

  const controller = createViewportSyncController({
    delayMs: 48,
    setTimeoutImpl: ((callback: () => void) => {
      scheduledTask = callback;
      return 1;
    }) as typeof window.setTimeout,
    clearTimeoutImpl: (() => {
      clearCalled += 1;
      scheduledTask = null;
    }) as typeof window.clearTimeout,
    onCommit: (viewport) => {
      committed.push(viewport);
    },
  });

  controller.schedule({ x: 0, y: 0, zoom: 1 });
  controller.suspend();
  controller.schedule({ x: 20, y: 40, zoom: 1.2 });
  controller.schedule({ x: 48, y: 64, zoom: 1.4 });
  runScheduledTask(scheduledTask);

  assert.equal(controller.isSuspended(), true);
  assert.equal(clearCalled, 1);
  assert.deepEqual(committed, []);

  controller.resume();
  const flushed = controller.flush();

  assert.equal(flushed, true);
  assert.deepEqual(committed, [{ x: 48, y: 64, zoom: 1.4 }]);
});
