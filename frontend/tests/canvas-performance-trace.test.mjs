import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearCanvasPerformanceTrace,
  exportCanvasPerformanceTrace,
  recordCanvasTraceEvent,
  setCanvasPerformanceTraceEnabled,
  startCanvasPerformanceTrace,
  stopCanvasPerformanceTrace,
} from '../dist-tests/src/utils/performance/canvas-performance-trace-adapter.js';
import {
  resetCanvasImagePerformanceSnapshot,
  setCanvasImageDiagnosticsConfig,
} from '../dist-tests/src/utils/performance/canvas-image-performance.js';

test.afterEach(() => {
  stopCanvasPerformanceTrace();
  clearCanvasPerformanceTrace();
  setCanvasPerformanceTraceEnabled(false);
  setCanvasImageDiagnosticsConfig({
    enabled: false,
    verbose: false,
    autoReport: false,
  });
  resetCanvasImagePerformanceSnapshot();
});

test('canvas performance trace adapter does not record while disabled', () => {
  setCanvasImageDiagnosticsConfig({
    enabled: true,
    verbose: false,
    autoReport: false,
  });
  setCanvasPerformanceTraceEnabled(false);
  startCanvasPerformanceTrace({ durationMs: 1000 });
  recordCanvasTraceEvent({
    type: 'operation.pan',
  });

  assert.equal(exportCanvasPerformanceTrace().timeline.length, 0);
});

test('canvas performance trace adapter records when diagnostics and trace are enabled', () => {
  setCanvasImageDiagnosticsConfig({
    enabled: true,
    verbose: false,
    autoReport: false,
  });
  setCanvasPerformanceTraceEnabled(true);
  startCanvasPerformanceTrace({ durationMs: 1000, preset: 'high-detail-2min' });
  recordCanvasTraceEvent({
    type: 'operation.pan',
    data: {
      nodeId: 'trace-node',
      fileName: 'secret.png',
    },
  });

  const exported = exportCanvasPerformanceTrace();
  assert.equal(exported.timeline.length, 1);
  assert.notEqual(exported.timeline[0].data.nodeId, 'trace-node');
  assert.equal(exported.timeline[0].data.fileName, '[redacted]');
});
