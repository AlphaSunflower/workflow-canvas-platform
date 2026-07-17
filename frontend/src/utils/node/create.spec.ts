import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateFileNodeDimensions, createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from './create';

test('media node creation dimensions use doubled default width and height', () => {
  const dimensions = calculateFileNodeDimensions('image', { width: 220, height: 160 });

  assert.deepEqual(dimensions, { width: 440, height: 320 });
});

test('ply node creation uses doubled default dimensions', () => {
  const node = createDefaultFileNodeData(
    createSequentialNodeId(1),
    { x: 0, y: 0 },
    'ply',
    'file-1',
    'mesh.ply',
    1024,
    'application/octet-stream',
  );

  assert.deepEqual(node.dimensions, { width: 440, height: 320 });
  assert.equal(node.source.type, 'imported');
  assert.equal(node.source.sourceDisplayName, 'mesh.ply');
  assert.equal(node.source.localSource?.status, 'runtime-only');
});

test('ai node creation uses doubled default dimensions', () => {
  const node = createDefaultAINodeData(
    createSequentialNodeId(1),
    { x: 0, y: 0 },
    'aiImageGen',
  );

  assert.deepEqual(node.dimensions, { width: 640, height: 592 });
});
