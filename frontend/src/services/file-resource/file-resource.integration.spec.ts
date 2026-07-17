import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import {
  clearRuntimeNodeFileSources,
  getFileBlobFromNodeWithOptions,
  registerRuntimeNodeFileSource,
  syncRuntimeNodeFileSources,
} from '@/services/backendFileService';
import { clearAllImageResources } from '@/services/image/image-node';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import {
  FileResourceService,
  fileManifestStore,
  fileResourceLeaseManager,
  resolveFileResource,
} from './index';

function createNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: 'node-resource-integration',
      display: '#09001',
    },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 180 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    fileId: 'file-resource-integration',
    fileName: 'integration.png',
    fileSize: 16,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    imageAsset: {
      assetId: 'file-resource-integration',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-resource-integration/thumbnail',
        },
        original: {
          url: '/api/v1/files/file-resource-integration/download',
        },
      },
    },
    thumbnailUrl: '/api/v1/files/file-resource-integration/thumbnail',
    metadata: {
      width: 512,
      height: 512,
    },
    ...overrides,
  };
}

function resetFileResources(): void {
  imageOriginalSourceRegistry.clear({ force: true });
  fileResourceLeaseManager.clear();
  fileManifestStore.clear();
  clearRuntimeNodeFileSources();
}

test('unified file resource lifecycle keeps local originals across viewer inpaint upload export and prompt-reference use', async () => {
  resetFileResources();
  const file = new File(['integration-original'], 'integration.png', { type: 'image/png' });
  const node = createNode();

  registerRuntimeNodeFileSource(node.id.value, node.fileId, file, {
    workflowId: 'workflow-a',
  });

  const viewerHandle = await resolveFileResource(node, {
    purpose: 'viewer-original',
    require: 'file',
    workflowId: 'workflow-a',
    owner: 'viewer-test',
  });
  const inpaintHandle = await resolveFileResource(node, {
    purpose: 'inpaint-editor-original',
    require: 'file',
    workflowId: 'workflow-a',
    owner: 'inpaint-test',
  });
  const exportHandle = await resolveFileResource(node, {
    purpose: 'export-original',
    require: 'file',
    workflowId: 'workflow-a',
    owner: 'export-test',
  });
  const promptHandle = await resolveFileResource(node, {
    purpose: 'prompt-reference',
    require: 'file',
    workflowId: 'workflow-a',
    owner: 'prompt-test',
  });

  assert.equal(viewerHandle.selectedSource, 'registry-file');
  assert.equal(inpaintHandle.selectedSource, 'registry-file');
  assert.equal(exportHandle.selectedSource, 'registry-file');
  assert.equal(promptHandle.selectedSource, 'registry-file');
  assert.equal(viewerHandle.file, file);
  assert.equal(inpaintHandle.file, file);
  assert.equal(exportHandle.file, file);
  assert.equal(promptHandle.file, file);
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    workflowId: 'workflow-a',
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 4);

  clearAllImageResources({ workflowId: 'workflow-a' });
  syncRuntimeNodeFileSources([], { workflowId: 'workflow-a' });

  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-a',
  }), file);

  viewerHandle.release();
  inpaintHandle.release();
  exportHandle.release();
  promptHandle.release();

  assert.equal(fileResourceLeaseManager.getLeaseCount({
    workflowId: 'workflow-a',
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 0);

  clearRuntimeNodeFileSources({ workflowId: 'workflow-a' });
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-a',
  }), null);
  resetFileResources();
});

test('upload input resolution leases the original while backend preparation is in progress and releases after use', async () => {
  resetFileResources();
  const file = new File(['upload-original'], 'upload.png', { type: 'image/png' });
  const node = createNode({
    id: { value: 'node-upload-integration', display: '#09002' },
    fileId: 'file-upload-integration',
    fileName: 'upload.png',
    fileSize: file.size,
  });

  registerRuntimeNodeFileSource(node.id.value, node.fileId, file, {
    workflowId: 'workflow-upload',
  });

  const resolvedFile = await getFileBlobFromNodeWithOptions(node, {
    workflowId: 'workflow-upload',
  });

  assert.equal(resolvedFile, file);
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    workflowId: 'workflow-upload',
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 0);
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-upload',
  }), file);
  resetFileResources();
});

test('workflow scoped resources do not contaminate each other and inactive cleanup only removes matching unleased workflow', () => {
  resetFileResources();
  const fileA = new File(['workflow-a'], 'a.png', { type: 'image/png' });
  const fileB = new File(['workflow-b'], 'b.png', { type: 'image/png' });
  const node = createNode();

  registerRuntimeNodeFileSource(node.id.value, node.fileId, fileA, {
    workflowId: 'workflow-a',
  });
  registerRuntimeNodeFileSource(node.id.value, node.fileId, fileB, {
    workflowId: 'workflow-b',
  });

  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-a',
  }), fileA);
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-b',
  }), fileB);

  clearRuntimeNodeFileSources({ workflowId: 'workflow-a' });

  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-a',
  }), null);
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-b',
  }), fileB);
  resetFileResources();
});

test('canvas thumbnail resolution never downloads original even when original exists', async () => {
  resetFileResources();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['unexpected'], { type: 'image/png' });
    },
  });
  const node = createNode({
    imageAsset: {
      assetId: 'file-resource-integration',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-resource-integration/thumbnail',
        },
        original: {
          url: '/api/v1/files/file-resource-integration/download',
        },
      },
    },
  });

  const handle = await service.resolveFileResource(node, {
    purpose: 'canvas-thumbnail',
    require: 'displayUrl',
  });

  assert.equal(handle.selectedSource, 'thumbnail');
  assert.equal(handle.displayUrl, '/api/v1/files/file-resource-integration/thumbnail');
  assert.deepEqual(fetchCalls, []);
  assert.equal(handle.fallbackChain.includes('remote-download'), false);
  handle.release();
  resetFileResources();
});

test('local import AI input resolution uses upload-input without downloading original', async () => {
  resetFileResources();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['unexpected-remote-original'], { type: 'image/png' });
    },
  });
  const localFile = new File(['local-import-original'], 'local-import.png', { type: 'image/png' });
  const node = createNode({
    id: { value: 'node-local-import-ai-input', display: '#09004' },
    fileId: 'file-local-import-ai-input',
    fileName: 'local-import.png',
    fileSize: localFile.size,
    imageAsset: {
      assetId: 'file-local-import-ai-input',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-local-import-ai-input/thumbnail',
        },
        original: {
          url: '/api/v1/files/file-local-import-ai-input/download',
        },
      },
    },
  });

  registerRuntimeNodeFileSource(node.id.value, node.fileId, localFile, {
    workflowId: 'workflow-local-import',
    authScope: 'account-local-import',
  });

  const uploadHandle = await service.resolveFileResource(node, {
    purpose: 'upload-input',
    require: 'file',
    workflowId: 'workflow-local-import',
    authScope: 'account-local-import',
  });
  const promptHandle = await service.resolveFileResource(node, {
    purpose: 'prompt-reference',
    require: 'file',
    workflowId: 'workflow-local-import',
    authScope: 'account-local-import',
  });

  assert.equal(uploadHandle.selectedSource, 'registry-file');
  assert.equal(promptHandle.selectedSource, 'registry-file');
  assert.equal(uploadHandle.file, localFile);
  assert.equal(promptHandle.file, localFile);
  assert.deepEqual(fetchCalls, []);
  assert.equal(uploadHandle.fallbackChain.includes('remote-download'), false);
  assert.equal(promptHandle.fallbackChain.includes('remote-download'), false);
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    workflowId: 'workflow-local-import',
    authScope: 'account-local-import',
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 2);

  uploadHandle.release();
  promptHandle.release();
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    workflowId: 'workflow-local-import',
    authScope: 'account-local-import',
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 0);
  resetFileResources();
});

test('remote downloaded originals become reusable unified registry files across purposes', async () => {
  resetFileResources();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['remote-original'], { type: 'image/png' });
    },
  });
  const node = createNode({
    id: { value: 'node-remote-reuse-integration', display: '#09003' },
    fileId: 'file-remote-reuse-integration',
    fileName: 'remote-reuse.png',
    imageAsset: {
      assetId: 'file-remote-reuse-integration',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-remote-reuse-integration/thumbnail',
        },
        original: {
          url: '/api/v1/files/file-remote-reuse-integration/download',
        },
      },
    },
  });

  const viewerHandle = await service.resolveFileResource(node, {
    purpose: 'viewer-original',
    require: 'file',
    workflowId: 'workflow-remote-reuse',
  });
  viewerHandle.release();
  const inpaintHandle = await service.resolveFileResource(node, {
    purpose: 'inpaint-editor-original',
    require: 'file',
    workflowId: 'workflow-remote-reuse',
  });
  const exportHandle = await service.resolveFileResource(node, {
    purpose: 'export-original',
    require: 'file',
    workflowId: 'workflow-remote-reuse',
  });
  const promptHandle = await service.resolveFileResource(node, {
    purpose: 'prompt-reference',
    require: 'file',
    workflowId: 'workflow-remote-reuse',
  });

  assert.equal(viewerHandle.selectedSource, 'remote-download');
  assert.equal(inpaintHandle.selectedSource, 'registry-file');
  assert.equal(exportHandle.selectedSource, 'registry-file');
  assert.equal(promptHandle.selectedSource, 'registry-file');
  assert.equal(inpaintHandle.file, viewerHandle.file);
  assert.equal(exportHandle.file, viewerHandle.file);
  assert.equal(promptHandle.file, viewerHandle.file);
  assert.deepEqual(fetchCalls, ['/api/v1/files/file-remote-reuse-integration/download']);

  inpaintHandle.release();
  exportHandle.release();
  promptHandle.release();
  resetFileResources();
});
