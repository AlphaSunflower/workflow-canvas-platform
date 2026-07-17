import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import { fileManifestStore } from './file-resource';
import { imageOriginalSourceRegistry } from './image/image-original-source-registry';
import { cacheBackendFileBinding, clearBackendFileBindingCache } from './backendFileService';
import { rebindLocalFileToNode } from './local-file-rebind';

function createNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: 'node-rebind-1',
      display: '#00991',
    },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 180 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId: 'backend-file-1',
    backendFileId: 'backend-file-1',
    fileName: 'scene.png',
    fileSize: 4,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      sourceDisplayName: 'scene.png',
      localSource: {
        status: 'missing',
      },
      importedAt: now,
    },
    metadata: {
      width: 1280,
      height: 720,
    },
    imageAsset: {
      assetId: 'backend-file-1',
      source: 'remote',
      version: 1,
      variants: {
        original: {
          url: '/api/v1/files/backend-file-1/download',
        },
      },
    },
    ...overrides,
  };
}

test('rebindLocalFileToNode registers runtime local original and updates imported source status', async () => {
  clearBackendFileBindingCache();
  fileManifestStore.clear();
  imageOriginalSourceRegistry.clear();
  const node = createNode();
  const file = new File(['data'], 'scene.png', { type: 'image/png' });

  const result = await rebindLocalFileToNode(node, file, {
    workflowId: 'workflow-rebind',
  });

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }

  assert.equal(result.node.source.type, 'imported');
  assert.equal(result.node.source.localSource?.status, 'runtime-only');
  assert.equal(result.node.source.sourceDisplayName, 'scene.png');
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-rebind',
  }), file);
  const manifest = fileManifestStore.get({
    workflowId: 'workflow-rebind',
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  });
  assert.equal(manifest?.hasLocalFile, true);
  assert.equal(manifest?.status, 'local-only');
  imageOriginalSourceRegistry.clear();
  fileManifestStore.clear();
  clearBackendFileBindingCache();
});

test('rebindLocalFileToNode records persistent handle metadata when provided', async () => {
  clearBackendFileBindingCache();
  imageOriginalSourceRegistry.clear();
  const node = createNode();
  const file = new File(['data'], 'scene.png', { type: 'image/png' });
  const handle = {
    kind: 'file' as const,
    name: 'scene.png',
    getFile: async () => file,
  };

  const result = await rebindLocalFileToNode(node, file, {
    localSourceHandle: handle,
    localSourceReferenceId: 'local-file-source:node-rebind-1:backend-file-1',
    permissionState: 'granted',
  });

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }

  assert.equal(result.node.source.type, 'imported');
  assert.equal(result.node.source.localSource?.status, 'available');
  assert.equal(result.node.source.localSource?.referenceId, 'local-file-source:node-rebind-1:backend-file-1');
  assert.equal(result.node.source.localSource?.kind, 'file-system-access');
  assert.equal(result.node.source.localSource?.permissionState, 'granted');
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId), file);
  imageOriginalSourceRegistry.clear();
  clearBackendFileBindingCache();
});

test('rebindLocalFileToNode rejects mismatched file names before replacing runtime binding', async () => {
  clearBackendFileBindingCache();
  imageOriginalSourceRegistry.clear();
  const node = createNode();
  const originalFile = new File(['keep'], 'scene.png', { type: 'image/png' });
  const mismatchedFile = new File(['data'], 'other.png', { type: 'image/png' });
  imageOriginalSourceRegistry.registerLocalFile(node.id.value, node.fileId, originalFile);

  const result = await rebindLocalFileToNode(node, mismatchedFile);

  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  assert.equal(result.code, 'NAME_MISMATCH');
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId), originalFile);
  imageOriginalSourceRegistry.clear();
  clearBackendFileBindingCache();
});

test('rebindLocalFileToNode blocks hash mismatches when a stable hash is available', async () => {
  clearBackendFileBindingCache();
  imageOriginalSourceRegistry.clear();
  const node = createNode();
  const file = new File(['data'], 'scene.png', { type: 'image/png' });
  cacheBackendFileBinding(node, {
    backendFileId: node.backendFileId ?? node.fileId,
    sha256: 'expected-hash',
    size: file.size,
    updatedAt: Date.now(),
  });

  const result = await rebindLocalFileToNode(node, file, {
    hashFile: async () => 'unexpected-hash',
  });

  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  assert.equal(result.code, 'HASH_MISMATCH');
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId), null);
  imageOriginalSourceRegistry.clear();
  clearBackendFileBindingCache();
});

test('rebindLocalFileToNode validates hash against the requested workflow binding only', async () => {
  clearBackendFileBindingCache();
  imageOriginalSourceRegistry.clear();
  const node = createNode();
  const file = new File(['data'], 'scene.png', { type: 'image/png' });
  cacheBackendFileBinding(node, {
    backendFileId: 'backend-workflow-a',
    sha256: 'workflow-a-hash',
    size: file.size,
    updatedAt: Date.now(),
  }, {
    workflowId: 'workflow-a',
  });
  cacheBackendFileBinding(node, {
    backendFileId: 'backend-workflow-b',
    sha256: 'workflow-b-hash',
    size: file.size,
    updatedAt: Date.now(),
  }, {
    workflowId: 'workflow-b',
  });

  const result = await rebindLocalFileToNode(node, file, {
    workflowId: 'workflow-b',
    hashFile: async () => 'workflow-b-hash',
  });

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }
  assert.equal(result.sha256, 'workflow-b-hash');
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-b',
  }), file);
  imageOriginalSourceRegistry.clear();
  clearBackendFileBindingCache();
});
