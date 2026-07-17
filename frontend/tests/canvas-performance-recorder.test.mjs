import test from 'node:test';
import assert from 'node:assert/strict';

import { CanvasPerformanceRecorder } from '../dist-tests/tools/canvas-performance-recorder/recorder.js';
import {
  analyzeCanvasPerformanceTrace,
  buildCanvasPerformanceTraceSummary,
} from '../dist-tests/tools/canvas-performance-recorder/analyzer.js';

test('canvas performance recorder records start stop and export timeline', () => {
  const recorder = new CanvasPerformanceRecorder();
  recorder.start({
    durationMs: 10_000,
    preset: 'high-detail-2min',
  });
  recorder.record({
    type: 'operation.pan',
    phase: 'start',
    ts: 100,
  });
  recorder.record({
    type: 'operation.pan',
    phase: 'end',
    durationMs: 24,
    ts: 124,
  });
  recorder.stop();

  const exported = recorder.export();
  assert.equal(exported.timeline.length, 2);
  assert.equal(exported.summary.totalEvents, 2);
  assert.equal(exported.countersBySecond[0]?.['operation.pan'], 2);
});

test('canvas performance recorder aggregates high frequency events in default preset', () => {
  const recorder = new CanvasPerformanceRecorder();
  recorder.start({
    durationMs: 10_000,
    preset: '10min-default',
  });
  recorder.record({
    type: 'imageManager.emit',
    ts: 100,
  });
  recorder.record({
    type: 'imageManager.emit',
    ts: 120,
  });

  const exported = recorder.export();
  assert.equal(exported.timeline.some((event) => event.type === 'imageManager.emit'), false);
  assert.equal(exported.countersBySecond[0]?.['imageManager.emit'], 2);
  recorder.stop();
});

test('canvas performance recorder redacts sensitive event data', () => {
  const recorder = new CanvasPerformanceRecorder();
  recorder.start({
    preset: 'high-detail-2min',
  });
  recorder.record({
    type: 'imageManager.request',
    data: {
      nodeId: 'node-secret',
      fileName: 'private.png',
      src: 'blob:http://localhost/private',
    },
  });

  const event = recorder.export().timeline[0];
  assert.notEqual(event?.data?.nodeId, 'node-secret');
  assert.equal(event?.data?.fileName, '[redacted]');
  assert.equal(event?.data?.src, '[redacted]');
  recorder.stop();
});

test('canvas performance analyzer reports slow long task raster and patch suspects', () => {
  const events = [
    {
      ts: 100,
      type: 'longtask',
      phase: 'instant',
      durationMs: 80,
    },
    {
      ts: 140,
      type: 'raster.draw',
      phase: 'end',
      durationMs: 52,
      data: {
        itemCount: 300,
      },
    },
    {
      ts: 180,
      type: 'nodePatch.flush',
      phase: 'end',
      durationMs: 20,
    },
  ];

  const suspects = analyzeCanvasPerformanceTrace(events, []);
  assert.equal(suspects.some((suspect) => suspect.reason.includes('long task')), true);
  assert.equal(suspects.some((suspect) => suspect.reason.includes('raster draw')), true);
  assert.equal(suspects.some((suspect) => suspect.reason.includes('node patch flush')), true);
});

test('canvas performance summary reports max counters', () => {
  const summary = buildCanvasPerformanceTraceSummary([], [
    {
      second: 1,
      'imageManager.emit': 200,
      'reactFlow.nodesRefChange': 12,
    },
  ]);

  assert.equal(summary.maxImageEmitPerSec, 200);
  assert.equal(summary.maxNodesRefChangePerSec, 12);
});
