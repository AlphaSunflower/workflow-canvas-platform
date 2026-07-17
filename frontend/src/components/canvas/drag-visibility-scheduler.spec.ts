import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveVisibilityBucketState,
  shouldScheduleIntermediateZoomVisibility,
  shouldEmitVisibilityDiff,
} from '@/hooks/canvas/visibility-buckets';
import {
  resolveRetainedVisibilityCandidateIds,
  type VisibleNodeMap,
  type VisibleNodeState,
} from '@/hooks/canvas/useVisibleNodes';
import { createDragVisibilityScheduler } from './drag-visibility-scheduler';

async function readCanvasSource(): Promise<string> {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  return readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/Canvas.tsx`,
    'utf8',
  );
}

function runScheduledTask(task: (() => void) | null): void {
  if (typeof task === 'function') {
    task();
  }
}

function createVisibilityMap(ids: string[]): VisibleNodeMap {
  return new Map(ids.map((id, index) => [id, {
    isVisible: index % 2 === 0,
    isNearViewport: true,
    displayWidth: 100,
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

function createVisibilityState(overrides: Partial<VisibleNodeState> = {}): VisibleNodeState {
  return {
    isVisible: false,
    isNearViewport: false,
    displayWidth: 0,
    displayHeight: 0,
    visibilityBucket: 'offscreen',
    visibilityScoreBucket: 'cancel',
    visibilityAreaBucket: 'none',
    visibleAreaRatio: 0,
    viewportZoom: 1,
    visibilityScore: 0,
    centerDistance: Number.POSITIVE_INFINITY,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    renderTier: 'minimal',
    ...overrides,
  };
}

test('drag visibility scheduler merges frame work and commits only the latest scheduled batch', () => {
  let frameTask: (() => void) | null = null;
  let frameIdSeed = 0;
  const appliedNodeCounts: number[] = [];
  const recordedReasons: string[] = [];

  const scheduler = createDragVisibilityScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      frameIdSeed += 1;
      return frameIdSeed;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
    now: (() => {
      let current = 0;
      return () => {
        current += 4;
        return current;
      };
    })(),
  });

  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['n1']), durationMs: 1 }),
    apply: (visibleNodes) => {
      appliedNodeCounts.push(visibleNodes.size);
      return { durationMs: 2 };
    },
    record: (metric) => {
      recordedReasons.push(metric.reason);
    },
  });
  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['n1', 'n2', 'n3']), durationMs: 3 }),
    apply: (visibleNodes) => {
      appliedNodeCounts.push(visibleNodes.size);
      return { durationMs: 1 };
    },
    record: (metric) => {
      recordedReasons.push(metric.reason);
    },
  });

  assert.equal(appliedNodeCounts.length, 0);
  assert.ok(frameTask);
  runScheduledTask(frameTask);

  assert.deepEqual(appliedNodeCounts, [3]);
  assert.deepEqual(recordedReasons, ['frame']);
});

test('drag visibility scheduler applies only the latest rapid drag viewport batch per frame', () => {
  let frameTask: (() => void) | null = null;
  let frameScheduleCount = 0;
  const appliedBatches: string[] = [];

  const scheduler = createDragVisibilityScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      frameScheduleCount += 1;
      return frameScheduleCount;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
  });

  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['viewport-start']), durationMs: 1 }),
    apply: () => {
      appliedBatches.push('viewport-start');
      return { durationMs: 1 };
    },
  });
  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['viewport-mid']), durationMs: 1 }),
    apply: () => {
      appliedBatches.push('viewport-mid');
      return { durationMs: 1 };
    },
  });
  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['viewport-latest']), durationMs: 1 }),
    apply: () => {
      appliedBatches.push('viewport-latest');
      return { durationMs: 1 };
    },
  });

  assert.equal(frameScheduleCount, 1);
  runScheduledTask(frameTask);

  assert.deepEqual(appliedBatches, ['viewport-latest']);
});

test('drag visibility scheduler flushes immediately and cancels pending frame state', () => {
  let frameTask: (() => void) | null = null;
  let cancelCount = 0;
  const appliedNodeCounts: number[] = [];
  const recordedReasons: string[] = [];

  const scheduler = createDragVisibilityScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      cancelCount += 1;
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
  });

  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['n1', 'n2']), durationMs: 1 }),
    apply: (visibleNodes) => {
      appliedNodeCounts.push(visibleNodes.size);
      return { durationMs: 1 };
    },
    record: (metric) => {
      recordedReasons.push(metric.reason);
    },
  });

  const flushed = scheduler.flush();
  runScheduledTask(frameTask);

  assert.equal(flushed, true);
  assert.equal(cancelCount, 1);
  assert.deepEqual(appliedNodeCounts, [2]);
  assert.deepEqual(recordedReasons, ['flush']);
});

test('drag visibility scheduler lets final flush override pending drag frame work', () => {
  let frameTask: (() => void) | null = null;
  let cancelCount = 0;
  const appliedBatches: string[] = [];
  const recordedReasons: string[] = [];

  const scheduler = createDragVisibilityScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      cancelCount += 1;
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
  });

  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['pending-frame']), durationMs: 1 }),
    apply: () => {
      appliedBatches.push('pending-frame');
      return { durationMs: 1 };
    },
    record: (metric) => {
      recordedReasons.push(metric.reason);
    },
  });

  const flushed = scheduler.flush({
    compute: () => ({ visibleNodes: createVisibilityMap(['final-flush']), durationMs: 1 }),
    apply: () => {
      appliedBatches.push('final-flush');
      return { durationMs: 1 };
    },
    record: (metric) => {
      recordedReasons.push(metric.reason);
    },
  });
  runScheduledTask(frameTask);

  assert.equal(flushed, true);
  assert.equal(cancelCount, 1);
  assert.deepEqual(appliedBatches, ['final-flush']);
  assert.deepEqual(recordedReasons, ['flush']);
});

test('drag visibility scheduler suspend stores latest work and does not compute until final flush', () => {
  let frameTask: (() => void) | null = null;
  let frameScheduleCount = 0;
  const appliedNodeCounts: number[] = [];
  const recordedReasons: string[] = [];

  const scheduler = createDragVisibilityScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      frameScheduleCount += 1;
      return frameScheduleCount;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
  });

  scheduler.suspend();
  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['n1']), durationMs: 1 }),
    apply: (visibleNodes) => {
      appliedNodeCounts.push(visibleNodes.size);
      return { durationMs: 1 };
    },
    record: (metric) => {
      recordedReasons.push(metric.reason);
    },
  });
  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['n1', 'n2', 'n3', 'n4']), durationMs: 1 }),
    apply: (visibleNodes) => {
      appliedNodeCounts.push(visibleNodes.size);
      return { durationMs: 1 };
    },
    record: (metric) => {
      recordedReasons.push(metric.reason);
    },
  });
  runScheduledTask(frameTask);

  assert.equal(scheduler.isSuspended(), true);
  assert.equal(frameScheduleCount, 0);
  assert.deepEqual(appliedNodeCounts, []);

  scheduler.resume();
  const flushed = scheduler.flush();

  assert.equal(flushed, true);
  assert.deepEqual(appliedNodeCounts, [4]);
  assert.deepEqual(recordedReasons, ['flush']);
});

test('drag visibility scheduler ignores async frame results after a newer schedule', async () => {
  let frameTask: (() => void) | null = null;
  const appliedNodeCounts: number[] = [];
  let resolveComputation!: (value: { visibleNodes: VisibleNodeMap; durationMs: number }) => void;
  const computationPromise = new Promise<{ visibleNodes: VisibleNodeMap; durationMs: number }>((resolve) => {
    resolveComputation = resolve;
  });
  const scheduler = createDragVisibilityScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
  });

  scheduler.schedule({
    compute: () => computationPromise,
    apply: (visibleNodes) => {
      appliedNodeCounts.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });
  runScheduledTask(frameTask);

  scheduler.schedule({
    compute: () => ({ visibleNodes: createVisibilityMap(['fresh', 'fresh-2']), durationMs: 1 }),
    apply: (visibleNodes) => {
      appliedNodeCounts.push(visibleNodes.size);
      return { durationMs: 1 };
    },
  });
  runScheduledTask(frameTask);

  resolveComputation({ visibleNodes: createVisibilityMap(['stale']), durationMs: 1 });
  await Promise.resolve();

  assert.deepEqual(appliedNodeCounts, [2]);
});

test('drag visibility scheduler ignores async flush results after a newer flush', async () => {
  const applied: string[] = [];
  let resolveComputation!: (value: { visibleNodes: VisibleNodeMap; durationMs: number }) => void;
  const computationPromise = new Promise<{ visibleNodes: VisibleNodeMap; durationMs: number }>((resolve) => {
    resolveComputation = resolve;
  });
  const scheduler = createDragVisibilityScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => undefined) as typeof window.cancelAnimationFrame,
  });

  scheduler.flush({
    compute: () => computationPromise,
    apply: () => {
      applied.push('stale-flush');
      return { durationMs: 1 };
    },
  });

  scheduler.flush({
    compute: () => ({ visibleNodes: createVisibilityMap(['fresh']), durationMs: 1 }),
    apply: () => {
      applied.push('fresh-flush');
      return { durationMs: 1 };
    },
  });

  resolveComputation({ visibleNodes: createVisibilityMap(['stale']), durationMs: 1 });
  await Promise.resolve();

  assert.deepEqual(applied, ['fresh-flush']);
});

test('drag visibility scheduler ignores async results after cancel invalidates the token', async () => {
  let frameTask: (() => void) | null = null;
  const applied: string[] = [];
  let resolveComputation!: (value: { visibleNodes: VisibleNodeMap; durationMs: number }) => void;
  const computationPromise = new Promise<{ visibleNodes: VisibleNodeMap; durationMs: number }>((resolve) => {
    resolveComputation = resolve;
  });
  const scheduler = createDragVisibilityScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
  });

  scheduler.schedule({
    compute: () => computationPromise,
    apply: () => {
      applied.push('stale-frame');
      return { durationMs: 1 };
    },
  });
  runScheduledTask(frameTask);

  scheduler.cancel();
  resolveComputation({ visibleNodes: createVisibilityMap(['stale']), durationMs: 1 });
  await Promise.resolve();

  assert.deepEqual(applied, []);
});

test('drag visibility scheduler ignores async results after suspend and resume without flush', async () => {
  let frameTask: (() => void) | null = null;
  const applied: string[] = [];
  let resolveComputation!: (value: { visibleNodes: VisibleNodeMap; durationMs: number }) => void;
  const computationPromise = new Promise<{ visibleNodes: VisibleNodeMap; durationMs: number }>((resolve) => {
    resolveComputation = resolve;
  });
  const scheduler = createDragVisibilityScheduler({
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameTask = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      frameTask = null;
    }) as typeof window.cancelAnimationFrame,
  });

  scheduler.schedule({
    compute: () => computationPromise,
    apply: () => {
      applied.push('stale-frame');
      return { durationMs: 1 };
    },
  });
  runScheduledTask(frameTask);

  scheduler.suspend();
  scheduler.resume();
  resolveComputation({ visibleNodes: createVisibilityMap(['stale']), durationMs: 1 });
  await Promise.resolve();

  assert.deepEqual(applied, []);
});

test('visibility candidate retention shortens importing nodes and ignores importing alone', () => {
  const retained = new Map<string, number>();
  const candidates = resolveRetainedVisibilityCandidateIds({
    baseCandidateNodeIds: ['spatial'],
    retainedCandidateExpirations: retained,
    lastAppliedVisibleNodes: new Map([
      ['spatial', createVisibilityState({ isVisible: true, renderTier: 'full' })],
      ['importing-visible', createVisibilityState({
        isVisible: true,
        isNearViewport: true,
        isImporting: true,
        renderTier: 'compact',
        visibilityBucket: 'visible',
      })],
      ['importing-only', createVisibilityState({
        isImporting: true,
        renderTier: 'minimal',
      })],
      ['compact-passive', createVisibilityState({
        renderTier: 'compact',
      })],
    ]),
    importingNodeIds: ['importing-visible', 'importing-only'],
    now: 10_000,
    retention: {
      defaultRetentionMs: 6_000,
      importingRetentionMs: 1_200,
    },
  });

  assert.equal(candidates.includes('spatial'), true);
  assert.equal(candidates.includes('importing-visible'), true);
  assert.equal(candidates.includes('compact-passive'), true);
  assert.equal(candidates.includes('importing-only'), false);
  assert.equal(retained.get('spatial'), 16_000);
  assert.equal(retained.get('importing-visible'), 11_200);
  assert.equal(retained.get('compact-passive'), 16_000);
  assert.equal(retained.has('importing-only'), false);
});

test('visibility candidate retention expires old importing candidates faster than passive candidates', () => {
  const retained = new Map<string, number>([
    ['old-importing', 11_200],
    ['old-passive', 16_000],
  ]);
  const candidates = resolveRetainedVisibilityCandidateIds({
    baseCandidateNodeIds: [],
    retainedCandidateExpirations: retained,
    lastAppliedVisibleNodes: new Map(),
    now: 12_000,
    retention: {
      defaultRetentionMs: 6_000,
      importingRetentionMs: 1_200,
    },
  });

  assert.equal(candidates.includes('old-importing'), false);
  assert.equal(candidates.includes('old-passive'), true);
  assert.equal(retained.has('old-importing'), false);
  assert.equal(retained.get('old-passive'), 16_000);
});

test('visibility buckets suppress small zoom display-size churn', () => {
  const previous = deriveVisibilityBucketState({
    isVisible: true,
    isNearViewport: true,
    visibleAreaRatio: 0.5,
    visibilityScore: 0.75,
    centerDistance: 100,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 210,
    displayHeight: 160,
  });
  const next = deriveVisibilityBucketState({
    isVisible: true,
    isNearViewport: true,
    visibleAreaRatio: 0.5,
    visibilityScore: 0.75,
    centerDistance: 100,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 255,
    displayHeight: 184,
  });

  assert.equal(shouldEmitVisibilityDiff(previous, next), false);
});

test('visibility scheduler throttles intermediate zoom viewport churn', () => {
  const lastScheduledViewport = { x: 0, y: 0, zoom: 1 };

  assert.equal(shouldScheduleIntermediateZoomVisibility({
    lastScheduledViewport,
    nextViewport: { x: 4, y: 3, zoom: 1.02 },
    lastScheduledAt: 1_000,
    now: 1_030,
  }), false);

  assert.equal(shouldScheduleIntermediateZoomVisibility({
    lastScheduledViewport,
    nextViewport: { x: 4, y: 3, zoom: 1.1 },
    lastScheduledAt: 1_000,
    now: 1_030,
  }), true);

  assert.equal(shouldScheduleIntermediateZoomVisibility({
    lastScheduledViewport,
    nextViewport: { x: 220, y: 0, zoom: 1.02 },
    lastScheduledAt: 1_000,
    now: 1_030,
  }), true);

  assert.equal(shouldScheduleIntermediateZoomVisibility({
    lastScheduledViewport,
    nextViewport: { x: 4, y: 3, zoom: 1.02 },
    lastScheduledAt: 1_000,
    now: 1_130,
  }), true);
});

test('canvas drag visibility candidates use short importing retention without retaining importing alone', async () => {
  const source = await readCanvasSource();
  const candidateBlock = source.slice(
    source.indexOf('const getVisibleCandidateNodeIds = useCallback((viewport: Viewport'),
    source.indexOf('  const computeVisibleNodeMapForViewportAsync = useCallback(', source.indexOf('const getVisibleCandidateNodeIds = useCallback((viewport: Viewport')),
  );

  assert.equal(source.includes('const IMAGE_VISIBILITY_CANDIDATE_RETENTION_MS = 6_000;'), true);
  assert.equal(source.includes('const IMAGE_VISIBILITY_IMPORTING_CANDIDATE_RETENTION_MS = 1_200;'), true);
  assert.equal(candidateBlock.includes('resolveRetainedVisibilityCandidateIds({'), true);
  assert.equal(candidateBlock.includes('importingRetentionMs: IMAGE_VISIBILITY_IMPORTING_CANDIDATE_RETENTION_MS'), true);
  assert.equal(candidateBlock.includes('visibility.isImporting'), false);
});

test('canvas throttles zoom move visibility and defers final visibility work after release', async () => {
  const source = await readCanvasSource();
  const onMoveBlock = source.slice(
    source.indexOf('const onMove = useCallback((_: unknown, viewport: Viewport) => {'),
    source.indexOf('  const onMoveStart = useCallback(', source.indexOf('const onMove = useCallback((_: unknown, viewport: Viewport) => {')),
  );
  const onMoveEndBlock = source.slice(
    source.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {'),
    source.indexOf('  const onInit = useCallback(', source.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {')),
  );

  assert.equal(source.includes('lastMoveViewportRef'), true);
  assert.equal(source.includes('lastZoomVisibilityViewportRef'), true);
  assert.equal(source.includes('lastZoomVisibilityScheduledAtRef'), true);
  assert.equal(onMoveBlock.includes('const isZoomMove = hasViewportZoomChanged(previousViewport, viewport);'), true);
  assert.equal(onMoveBlock.includes('shouldScheduleIntermediateZoomVisibility({'), true);
  assert.ok(
    onMoveBlock.indexOf('shouldScheduleIntermediateZoomVisibility({') <
      onMoveBlock.indexOf("scheduleDragVisibility(buildDragVisibilityScheduleOptions(viewport, 'frame'));"),
  );
  assert.equal(onMoveEndBlock.includes("flushDragVisibility(buildDragVisibilityScheduleOptions(viewport, 'flush'));"), false);
  assert.equal(onMoveEndBlock.includes('cancelDragVisibility();'), true);
  assert.equal(onMoveEndBlock.includes("phase: importing ? 'post-drag-importing' : 'post-drag'"), true);
  assert.equal(onMoveEndBlock.includes('lastZoomVisibilityViewportRef.current = null;'), true);
});
