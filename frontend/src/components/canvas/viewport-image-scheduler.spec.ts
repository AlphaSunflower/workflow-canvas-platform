import test from 'node:test';
import assert from 'node:assert/strict';

import type { VisibleNodeMap } from '@/hooks/canvas/useVisibleNodes';
import { createViewportImageScheduler } from './viewport-image-scheduler';

function createVisibilityMap(ids: string[]): VisibleNodeMap {
  return new Map(ids.map((id, index) => [id, {
    isVisible: index % 2 === 0,
    isNearViewport: true,
    displayWidth: 120,
    displayHeight: 80,
    visibilityBucket: index % 2 === 0 ? 'visible' : 'near',
    visibilityScoreBucket: 'ready',
    visibilityAreaBucket: 'ready',
    visibleAreaRatio: 1,
    viewportZoom: 1,
    visibilityScore: 1,
    centerDistance: 0,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    renderTier: index % 2 === 0 ? 'full' : 'compact',
  }]));
}

test('viewport image scheduler defers work to post-frame idle phase and only keeps latest viewport', () => {
  let frameTask: unknown = null;
  let idleTask: unknown = null;
  let frameIdSeed = 0;
  let idleIdSeed = 0;
  const applied: number[] = [];

  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameIdSeed += 1;
      frameTask = () => callback(16);
      return frameIdSeed;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      idleIdSeed += 1;
      idleTask = () => callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return idleIdSeed;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => {
      idleTask = null;
    }) as typeof window.cancelIdleCallback,
  });

  scheduler.schedule({
    viewport: { x: 0, y: 0, zoom: 1 },
    compute: () => ({ visibleNodes: createVisibilityMap(['n1']), durationMs: 1 }),
    apply: (visibleNodes) => {
      applied.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });
  scheduler.schedule({
    viewport: { x: 100, y: 80, zoom: 1.2 },
    compute: () => ({ visibleNodes: createVisibilityMap(['n1', 'n2', 'n3']), durationMs: 2 }),
    apply: (visibleNodes) => {
      applied.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });

  assert.deepEqual(applied, []);
  const scheduledFrameTask = frameTask;
  assert.equal(typeof scheduledFrameTask, 'function');
  if (typeof scheduledFrameTask !== 'function') {
    throw new Error('Expected scheduled frame task.');
  }
  scheduledFrameTask();
  assert.deepEqual(applied, []);
  const scheduledIdleTask = idleTask;
  assert.equal(typeof scheduledIdleTask, 'function');
  if (typeof scheduledIdleTask !== 'function') {
    throw new Error('Expected scheduled idle task.');
  }
  scheduledIdleTask();

  assert.deepEqual(applied, [3]);
});

test('viewport image scheduler runs post-drag work after one frame and calls commit callback', () => {
  let frameTask: unknown = null;
  let idleTask: unknown = null;
  const applied: number[] = [];
  const committed: Array<{ nodeCount: number; phase: string }> = [];

  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      idleTask = () => callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 2;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => {
      idleTask = null;
    }) as typeof window.cancelIdleCallback,
  });

  scheduler.schedule({
    viewport: { x: 120, y: 80, zoom: 1 },
    phase: 'post-drag',
    compute: () => ({ visibleNodes: createVisibilityMap(['n1', 'n2']), durationMs: 1 }),
    apply: (visibleNodes) => {
      applied.push(visibleNodes.size);
      return { durationMs: 1 };
    },
    onCommitted: (metric) => {
      committed.push({
        nodeCount: metric.nodeCount,
        phase: metric.phase,
      });
    },
  });

  assert.equal(scheduler.isScheduled(), true);
  assert.equal(typeof frameTask, 'function');
  if (typeof frameTask !== 'function') {
    throw new Error('Expected scheduled frame task.');
  }
  frameTask();
  assert.deepEqual(applied, []);
  assert.equal(typeof idleTask, 'function');
  if (typeof idleTask !== 'function') {
    throw new Error('Expected scheduled idle task.');
  }
  idleTask();

  assert.deepEqual(applied, [2]);
  assert.deepEqual(committed, [{ nodeCount: 2, phase: 'post-drag' }]);
  assert.equal(scheduler.isScheduled(), false);
});

test('viewport image scheduler reports importing post-drag phase in metrics', () => {
  let frameTask: unknown = null;
  let timeoutTask: unknown = null;
  let idleTask: unknown = null;
  const phases: string[] = [];

  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      idleTask = () => callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 2;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => {
      idleTask = null;
    }) as typeof window.cancelIdleCallback,
    setTimeoutImpl: (callback) => {
      timeoutTask = callback;
      return 3;
    },
    clearTimeoutImpl: () => {
      timeoutTask = null;
    },
  });

  scheduler.schedule({
    viewport: { x: 120, y: 80, zoom: 1 },
    phase: 'post-drag-importing',
    compute: () => ({ visibleNodes: createVisibilityMap(['n1']), durationMs: 1 }),
    apply: () => ({ durationMs: 1 }),
    record: (metric) => {
      phases.push(metric.phase);
    },
  });

  if (typeof frameTask !== 'function') {
    throw new Error('Expected scheduled frame task.');
  }
  frameTask();
  if (typeof timeoutTask !== 'function') {
    throw new Error('Expected delayed timeout task.');
  }
  timeoutTask();
  if (typeof idleTask !== 'function') {
    throw new Error('Expected delayed idle task.');
  }
  idleTask();

  assert.deepEqual(phases, ['post-drag-importing']);
});

test('viewport image scheduler delays importing drag-end image work until short timeout then idle', () => {
  let frameTask: unknown = null;
  let timeoutTask: unknown = null;
  let idleTask: unknown = null;
  let scheduledTimeoutDelay: number | undefined;
  const applied: number[] = [];

  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      idleTask = () => callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 2;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => {
      idleTask = null;
    }) as typeof window.cancelIdleCallback,
    setTimeoutImpl: (callback, delay) => {
      scheduledTimeoutDelay = delay;
      timeoutTask = callback;
      return 3;
    },
    clearTimeoutImpl: () => {
      timeoutTask = null;
    },
  });

  scheduler.schedule({
    viewport: { x: 120, y: 80, zoom: 1 },
    phase: 'post-drag-importing',
    compute: () => ({ visibleNodes: createVisibilityMap(['n1', 'n2', 'n3']), durationMs: 1 }),
    apply: (visibleNodes) => {
      applied.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });

  assert.equal(typeof frameTask, 'function');
  if (typeof frameTask !== 'function') {
    throw new Error('Expected scheduled frame task.');
  }
  frameTask();
  assert.deepEqual(applied, []);
  assert.equal(scheduledTimeoutDelay, 48);
  assert.equal(typeof timeoutTask, 'function');
  assert.equal(idleTask, null);
  if (typeof timeoutTask !== 'function') {
    throw new Error('Expected delayed timeout task.');
  }
  timeoutTask();
  assert.deepEqual(applied, []);
  assert.equal(typeof idleTask, 'function');
  if (typeof idleTask !== 'function') {
    throw new Error('Expected delayed idle task.');
  }
  idleTask();

  assert.deepEqual(applied, [3]);
  assert.equal(scheduler.isScheduled(), false);
});

test('viewport image scheduler flush applies immediately and cancels pending frame/idle work', () => {
  let cancelFrameCount = 0;
  let cancelIdleCount = 0;
  let frameTask: unknown = null;
  let idleTask: unknown = null;
  const applied: number[] = [];

  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      cancelFrameCount += 1;
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      idleTask = () => callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 2;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => {
      cancelIdleCount += 1;
      idleTask = null;
    }) as typeof window.cancelIdleCallback,
  });

  scheduler.schedule({
    viewport: { x: 0, y: 0, zoom: 1 },
    compute: () => ({ visibleNodes: createVisibilityMap(['n1']), durationMs: 1 }),
    apply: (visibleNodes) => {
      applied.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });

  const flushed = scheduler.flush({
    viewport: { x: 24, y: 36, zoom: 1.1 },
    compute: () => ({ visibleNodes: createVisibilityMap(['n1', 'n2']), durationMs: 1 }),
    apply: (visibleNodes) => {
      applied.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });

  const residualFrameTask = frameTask;
  if (typeof residualFrameTask === 'function') {
    residualFrameTask();
  }
  const residualIdleTask = idleTask;
  if (typeof residualIdleTask === 'function') {
    residualIdleTask();
  }

  assert.equal(flushed, true);
  assert.equal(cancelFrameCount, 1);
  assert.equal(cancelIdleCount, 0);
  assert.deepEqual(applied, [2]);
});

test('viewport image scheduler metrics reflect candidate-filtered visibility maps without requiring full node count', () => {
  const recorded: Array<{ nodeCount: number; visibleNodeCount: number; nearViewportNodeCount: number }> = [];
  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => undefined) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 1;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => undefined) as typeof window.cancelIdleCallback,
  });

  scheduler.schedule({
    viewport: { x: 0, y: 0, zoom: 1 },
    compute: () => ({ visibleNodes: createVisibilityMap(['near-1', 'near-2']), durationMs: 1 }),
    apply: () => ({ durationMs: 1 }),
    record: (metric) => {
      recorded.push({
        nodeCount: metric.nodeCount,
        visibleNodeCount: metric.visibleNodeCount,
        nearViewportNodeCount: metric.nearViewportNodeCount,
      });
    },
  });

  assert.deepEqual(recorded, [{
    nodeCount: 2,
    visibleNodeCount: 1,
    nearViewportNodeCount: 2,
  }]);
});

test('viewport image scheduler suspend keeps latest pending work but does not schedule frame or idle work', () => {
  let frameTask: unknown = null;
  let frameScheduleCount = 0;
  const applied: number[] = [];
  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameScheduleCount += 1;
      frameTask = () => callback(16);
      return frameScheduleCount;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 1;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => undefined) as typeof window.cancelIdleCallback,
  });

  scheduler.suspend();
  scheduler.schedule({
    viewport: { x: 0, y: 0, zoom: 1 },
    compute: () => ({ visibleNodes: createVisibilityMap(['n1']), durationMs: 1 }),
    apply: (visibleNodes) => {
      applied.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });
  scheduler.schedule({
    viewport: { x: 20, y: 30, zoom: 1.2 },
    compute: () => ({ visibleNodes: createVisibilityMap(['n1', 'n2', 'n3']), durationMs: 1 }),
    apply: (visibleNodes) => {
      applied.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });

  assert.equal(scheduler.isSuspended(), true);
  assert.equal(frameScheduleCount, 0);
  assert.equal(frameTask, null);
  assert.deepEqual(applied, []);

  scheduler.resume();
  const flushed = scheduler.flush();

  assert.equal(flushed, true);
  assert.deepEqual(applied, [3]);
});

test('viewport image scheduler ignores stale async scheduled results that resolve while suspended', async () => {
  let frameTask: unknown = null;
  let idleTask: unknown = null;
  const applied: number[] = [];
  let resolveComputation!: (value: { visibleNodes: VisibleNodeMap; durationMs: number }) => void;
  const computationPromise = new Promise<{ visibleNodes: VisibleNodeMap; durationMs: number }>((resolve) => {
    resolveComputation = resolve;
  });
  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      idleTask = () => callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 1;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => {
      idleTask = null;
    }) as typeof window.cancelIdleCallback,
  });

  scheduler.schedule({
    viewport: { x: 0, y: 0, zoom: 1 },
    compute: () => computationPromise,
    apply: (visibleNodes) => {
      applied.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });

  if (typeof frameTask !== 'function') {
    throw new Error('Expected scheduled frame task.');
  }
  frameTask();
  if (typeof idleTask !== 'function') {
    throw new Error('Expected scheduled idle task.');
  }
  idleTask();

  scheduler.suspend();
  resolveComputation({ visibleNodes: createVisibilityMap(['stale']), durationMs: 1 });
  await Promise.resolve();

  assert.deepEqual(applied, []);
});

test('viewport image scheduler ignores async flush results after a newer viewport commit', async () => {
  const applied: string[] = [];
  let resolveFlushComputation!: (value: { visibleNodes: VisibleNodeMap; durationMs: number }) => void;
  const flushComputationPromise = new Promise<{ visibleNodes: VisibleNodeMap; durationMs: number }>((resolve) => {
    resolveFlushComputation = resolve;
  });
  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => undefined) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 1;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => undefined) as typeof window.cancelIdleCallback,
  });

  scheduler.flush({
    viewport: { x: 0, y: 0, zoom: 1 },
    compute: () => flushComputationPromise,
    apply: () => {
      applied.push('stale-flush');
      return { durationMs: 1 };
    },
  });

  scheduler.flush({
    viewport: { x: 240, y: 120, zoom: 1.1 },
    compute: () => ({ visibleNodes: createVisibilityMap(['fresh']), durationMs: 1 }),
    apply: () => {
      applied.push('fresh-flush');
      return { durationMs: 1 };
    },
  });

  resolveFlushComputation({ visibleNodes: createVisibilityMap(['stale']), durationMs: 1 });
  await Promise.resolve();

  assert.deepEqual(applied, ['fresh-flush']);
});

test('viewport image scheduler lets final drag viewport visibility win over stale offscreen work', async () => {
  const applied: Array<{ label: string; ids: string[] }> = [];
  let resolveScheduledComputation!: (value: { visibleNodes: VisibleNodeMap; durationMs: number }) => void;
  const scheduledComputationPromise = new Promise<{ visibleNodes: VisibleNodeMap; durationMs: number }>((resolve) => {
    resolveScheduledComputation = resolve;
  });
  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => undefined) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 1;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => undefined) as typeof window.cancelIdleCallback,
  });

  scheduler.schedule({
    viewport: { x: 0, y: 0, zoom: 1 },
    compute: () => scheduledComputationPromise,
    apply: (visibleNodes) => {
      applied.push({ label: 'stale-offscreen', ids: Array.from(visibleNodes.keys()) });
      return { durationMs: 1 };
    },
  });

  scheduler.flush({
    viewport: { x: -1600, y: 0, zoom: 1 },
    compute: () => ({ visibleNodes: createVisibilityMap(['returning-node']), durationMs: 1 }),
    apply: (visibleNodes) => {
      applied.push({ label: 'final-viewport', ids: Array.from(visibleNodes.keys()) });
      return { durationMs: 1 };
    },
  });

  resolveScheduledComputation({ visibleNodes: createVisibilityMap(['stale-hidden-node']), durationMs: 1 });
  await Promise.resolve();

  assert.deepEqual(applied, [{ label: 'final-viewport', ids: ['returning-node'] }]);
});

test('viewport image scheduler ignores async results after cancel invalidates the token', async () => {
  const applied: string[] = [];
  let resolveComputation!: (value: { visibleNodes: VisibleNodeMap; durationMs: number }) => void;
  const computationPromise = new Promise<{ visibleNodes: VisibleNodeMap; durationMs: number }>((resolve) => {
    resolveComputation = resolve;
  });
  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => undefined) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 1;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => undefined) as typeof window.cancelIdleCallback,
  });

  scheduler.schedule({
    viewport: { x: 0, y: 0, zoom: 1 },
    compute: () => computationPromise,
    apply: () => {
      applied.push('stale-scheduled');
      return { durationMs: 1 };
    },
  });

  scheduler.cancel();
  resolveComputation({ visibleNodes: createVisibilityMap(['stale']), durationMs: 1 });
  await Promise.resolve();

  assert.deepEqual(applied, []);
});

test('viewport image scheduler ignores async results after suspend and resume without flush', async () => {
  const applied: string[] = [];
  let resolveComputation!: (value: { visibleNodes: VisibleNodeMap; durationMs: number }) => void;
  const computationPromise = new Promise<{ visibleNodes: VisibleNodeMap; durationMs: number }>((resolve) => {
    resolveComputation = resolve;
  });
  const scheduler = createViewportImageScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => undefined) as typeof window.cancelAnimationFrame,
    requestIdleCallbackImpl: ((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 20,
      });
      return 1;
    }) as typeof window.requestIdleCallback,
    cancelIdleCallbackImpl: (() => undefined) as typeof window.cancelIdleCallback,
  });

  scheduler.schedule({
    viewport: { x: 0, y: 0, zoom: 1 },
    compute: () => computationPromise,
    apply: () => {
      applied.push('stale-scheduled');
      return { durationMs: 1 };
    },
  });

  scheduler.suspend();
  scheduler.resume();
  resolveComputation({ visibleNodes: createVisibilityMap(['stale']), durationMs: 1 });
  await Promise.resolve();

  assert.deepEqual(applied, []);
});
