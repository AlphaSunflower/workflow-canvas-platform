import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import { shouldActivateNodeUploadSubscription } from './useNodeUploadSnapshot';

function createNodeData(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: { value: 'upload-node', display: '#00901' },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 150 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    fileId: 'local-upload-node',
    fileName: 'upload-node.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 640,
      height: 480,
    },
    ...overrides,
  };
}

test('shouldActivateNodeUploadSubscription keeps local imported nodes active before backend binding exists', () => {
  const node = createNodeData();
  assert.equal(shouldActivateNodeUploadSubscription(node), true);
});

test('shouldActivateNodeUploadSubscription disables subscription once backend binding exists', () => {
  const node = createNodeData({
    backendFileId: 'backend-upload-node',
  });
  assert.equal(shouldActivateNodeUploadSubscription(node), false);
});

test('shouldActivateNodeUploadSubscription keeps pending and processing nodes active', () => {
  const pendingNode = createNodeData({ status: 'pending' });
  const processingNode = createNodeData({ status: 'processing' });
  assert.equal(shouldActivateNodeUploadSubscription(pendingNode), true);
  assert.equal(shouldActivateNodeUploadSubscription(processingNode), true);
});
