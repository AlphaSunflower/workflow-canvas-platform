import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(cwd, relativePath), 'utf8');
}

test('canvas performance recorder documents instrumentation and uses adapter boundary', () => {
  const map = read('tools/canvas-performance-recorder/docs/instrumentation-map.md');
  const checklist = read('tools/canvas-performance-recorder/docs/cleanup-checklist.md');
  const adapter = read('src/utils/performance/canvas-performance-trace-adapter.ts');
  const canvasSource = read('src/components/canvas/Canvas.tsx');

  assert.equal(map.includes('CPR-001'), true);
  assert.equal(map.includes('recorded fields'), false);
  assert.equal(map.includes('Event type'), true);
  assert.equal(checklist.includes('Remove the adapter calls'), true);
  assert.equal(adapter.includes('recordCanvasTraceEvent'), true);
  assert.equal(canvasSource.includes("from '../../utils/performance'"), true);
  assert.equal(canvasSource.includes('tools/canvas-performance-recorder'), false);
});
