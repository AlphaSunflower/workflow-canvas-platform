import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import {
  FileResourceService,
  fileManifestStore,
  fileResourceDiagnostics,
  fileResourceLeaseManager,
} from './index';

function createNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: 'node-1',
      display: '#00001',
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
    fileId: 'file-1',
    fileName: 'image.png',
    fileSize: 5,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    imageAsset: {
      assetId: 'file-1',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-1/thumbnail',
        },
        original: {
          url: '/api/v1/files/file-1/download',
        },
      },
    },
    thumbnailUrl: '/api/v1/files/file-1/thumbnail',
    metadata: {
      width: 512,
      height: 512,
    },
    ...overrides,
  };
}

test('FileResourceService resolves canvas thumbnails without requesting original download', async () => {
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['unexpected']);
    },
  });

  const handle = await service.resolveFileResource(createNode(), {
    purpose: 'canvas-thumbnail',
    require: 'displayUrl',
  });

  assert.equal(handle.selectedSource, 'thumbnail');
  assert.equal(handle.displayUrl, '/api/v1/files/file-1/thumbnail');
  assert.deepEqual(fetchCalls, []);
  assert.equal(handle.diagnostics.fallbackChain.includes('remote-download'), false);
  handle.release();
});

test('FileResourceService resolves backend file ids and records diagnostics', async () => {
  fileResourceDiagnostics.clear();
  const service = new FileResourceService();
  const handle = await service.resolveFileResource(createNode({
    backendFileId: 'backend-file-1',
  }), {
    purpose: 'upload-input',
    require: 'backendFileId',
  });

  assert.equal(handle.backendFileId, 'backend-file-1');
  assert.equal(handle.selectedSource, 'backend-id');
  assert.equal(handle.diagnostics.leaseId !== null, true);
  assert.equal(fileResourceLeaseManager.isLeased({
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original',
  }), true);
  handle.release();
  assert.equal(fileResourceLeaseManager.isLeased({
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original',
  }), false);
  const events = fileResourceDiagnostics.getEvents();
  assert.equal(events[events.length - 1]?.selectedSource, 'backend-id');
  fileResourceDiagnostics.clear();
});

test('FileResourceService prefers registry local files before remote download', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileResourceLeaseManager.clear();
  const registryFile = new File(['local'], 'local.png', { type: 'image/png' });
  imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', registryFile);
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['remote'], { type: 'image/png' });
    },
  });

  const handle = await service.resolveFileResource(createNode(), {
    purpose: 'export-original',
    require: 'file',
  });

  assert.equal(handle.selectedSource, 'registry-file');
  assert.equal(handle.file, registryFile);
  assert.deepEqual(fetchCalls, []);
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileResourceLeaseManager.clear();
});

test('FileResourceService falls back to remote download when local sources are unavailable', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['remote'], { type: 'image/png' });
    },
  });

  const handle = await service.resolveFileResource(createNode(), {
    purpose: 'viewer-original',
    require: 'file',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.equal(handle.file?.name, 'image.png');
  assert.deepEqual(fetchCalls, ['/api/v1/files/file-1/download']);
  assert.equal(handle.diagnostics.fallbackChain.includes('registry-file'), true);
  assert.equal(imageOriginalSourceRegistry.getFile('node-1', 'file-1'), handle.file);
  const manifest = fileManifestStore.get({
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original',
  });
  assert.equal(manifest?.hasLocalFile, true);
  assert.equal(manifest?.hasRemoteOriginal, true);
  assert.equal(manifest?.backendFileId, 'file-1');
  assert.equal(manifest?.variants.download?.url, '/api/v1/files/file-1/download');
  const remoteResolvedEvent = fileResourceDiagnostics.getEvents().find(
    (event) => event.event === 'resolved' && event.source === undefined && event.selectedSource === 'remote-download',
  );
  assert.equal(remoteResolvedEvent?.detail?.remoteDownloadVariant && typeof remoteResolvedEvent.detail.remoteDownloadVariant === 'object', true);
  assert.equal((remoteResolvedEvent?.detail?.remoteDownloadVariant as { url?: string } | undefined)?.url, '/api/v1/files/file-1/download');
  assert.equal((remoteResolvedEvent?.detail?.remoteDownloadVariant as { mimeType?: string } | undefined)?.mimeType, 'image/png');
  assert.equal((remoteResolvedEvent?.detail?.remoteDownloadVariant as { size?: number } | undefined)?.size, handle.file?.size);
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceDiagnostics.clear();
});

test('FileResourceService reuses remote downloaded originals from registry on later resolutions', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['remote'], { type: 'image/png' });
    },
  });
  const node = createNode();

  const remoteHandle = await service.resolveFileResource(node, {
    purpose: 'viewer-original',
    require: 'file',
    workflowId: 'workflow-remote-reuse',
  });
  remoteHandle.release();
  const reusedHandle = await service.resolveFileResource(node, {
    purpose: 'export-original',
    require: 'file',
    workflowId: 'workflow-remote-reuse',
  });

  assert.equal(remoteHandle.selectedSource, 'remote-download');
  assert.equal(reusedHandle.selectedSource, 'registry-file');
  assert.equal(reusedHandle.file, remoteHandle.file);
  assert.deepEqual(fetchCalls, ['/api/v1/files/file-1/download']);
  reusedHandle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('FileResourceService remote display handles release object urls without deleting cached registry file', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const created: string[] = [];
  const revoked: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async () => new Blob(['remote-display'], { type: 'image/png' }),
    createObjectUrl: (blob) => {
      const url = `blob:remote-${blob.size}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
  });
  const node = createNode();

  const handle = await service.resolveFileResource(node, {
    purpose: 'inpaint-editor-original',
    require: 'displayUrl',
    workflowId: 'workflow-remote-display',
  });
  const cachedFile = imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-remote-display',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.equal(handle.displayUrl, 'blob:remote-14');
  assert.equal(cachedFile?.name, 'image.png');
  handle.release();
  assert.deepEqual(created, ['blob:remote-14']);
  assert.deepEqual(revoked, ['blob:remote-14']);
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
    workflowId: 'workflow-remote-display',
  }), cachedFile);
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('FileResourceService export-original uses backend download when an image original variant is absent', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['remote'], { type: 'image/png' });
    },
  });

  const handle = await service.resolveFileResource(createNode({
    backendFileId: 'backend-file-1',
    imageAsset: undefined,
  }), {
    purpose: 'export-original',
    require: 'file',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.equal(handle.file?.type, 'image/png');
  assert.deepEqual(fetchCalls, ['/api/v1/files/backend-file-1/download']);
  const manifest = fileManifestStore.get({
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original',
  });
  assert.equal(manifest?.backendFileId, 'backend-file-1');
  assert.equal(manifest?.variants.download?.url, '/api/v1/files/backend-file-1/download');
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService viewer-original uses backend download when an image original variant is absent', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['viewer-remote'], { type: 'image/png' });
    },
  });

  const handle = await service.resolveFileResource(createNode({
    backendFileId: 'backend-viewer-file',
    imageAsset: undefined,
  }), {
    purpose: 'viewer-original',
    require: 'file',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.equal(handle.file?.type, 'image/png');
  assert.deepEqual(fetchCalls, ['/api/v1/files/backend-viewer-file/download']);
  const manifest = fileManifestStore.get({
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original',
  });
  assert.equal(manifest?.backendFileId, 'backend-viewer-file');
  assert.equal(manifest?.variants.download?.url, '/api/v1/files/backend-viewer-file/download');
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService viewer-original rejects non-image backend download blobs', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const service = new FileResourceService({
    fetchBlob: async () => new Blob(['<html>not an image</html>'], { type: 'text/html' }),
  });

  await assert.rejects(
    () => service.resolveFileResource(createNode({
      backendFileId: 'backend-html-file',
      imageAsset: undefined,
    }), {
      purpose: 'viewer-original',
      require: 'file',
    }),
    /non-image resource/,
  );

  assert.equal(imageOriginalSourceRegistry.getFile('node-1', 'file-1'), null);
  assert.equal(fileManifestStore.get({
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original',
  })?.variants.download, undefined);
  fileManifestStore.clear();
});

test('FileResourceService viewer-original rejects empty backend download blobs', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const service = new FileResourceService({
    fetchBlob: async () => new Blob([], { type: 'image/png' }),
  });

  await assert.rejects(
    () => service.resolveFileResource(createNode({
      backendFileId: 'backend-empty-file',
      imageAsset: undefined,
    }), {
      purpose: 'viewer-original',
      require: 'file',
    }),
    /empty image resource/,
  );

  assert.equal(imageOriginalSourceRegistry.getFile('node-1', 'file-1'), null);
  fileManifestStore.clear();
});

test('FileResourceService export-original allows non-image backend downloads for video nodes', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['video-bytes'], { type: 'video/mp4' });
    },
  });

  const handle = await service.resolveFileResource(createNode({
    type: 'video',
    backendFileId: 'backend-video-file',
    fileName: 'clip.mp4',
    fileId: 'video-file-1',
    mimeType: 'video/mp4',
    imageAsset: undefined,
    thumbnailUrl: undefined,
    metadata: {
      width: 1920,
      height: 1080,
      duration: 8,
    },
  }), {
    purpose: 'export-original',
    require: 'file',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.equal(handle.file?.type, 'video/mp4');
  assert.deepEqual(fetchCalls, ['/api/v1/files/backend-video-file/download']);
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService viewer-original uses cached backend binding when node data lacks original asset', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['viewer-cached-backend'], { type: 'image/png' });
    },
  });
  fileManifestStore.markBackendReady({
    key: {
      nodeId: 'node-1',
      fileId: '30',
      variant: 'original',
    },
    backendFileId: 'backend-viewer-cached-file',
  });

  const handle = await service.resolveFileResource(createNode({
    fileId: '30',
    imageAsset: undefined,
  }), {
    purpose: 'viewer-original',
    require: 'file',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.equal(handle.file?.type, 'image/png');
  assert.deepEqual(fetchCalls, ['/api/v1/files/backend-viewer-cached-file/download']);
  const manifest = fileManifestStore.get({
    nodeId: 'node-1',
    fileId: '30',
    variant: 'original',
  });
  assert.equal(manifest?.backendFileId, 'backend-viewer-cached-file');
  assert.equal(manifest?.variants.download?.url, '/api/v1/files/backend-viewer-cached-file/download');
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService viewer-original resolves backend id from remote metadata when only thumbnail asset is present', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const resolvedBackendIds: string[] = [];
  const service = new FileResourceService({
    resolveRemoteBackendFileId: async (fileId) => {
      resolvedBackendIds.push(fileId);
      return fileId === 'frontend-local-file' ? 'backend-probed-file' : null;
    },
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['viewer-probed-backend'], { type: 'image/png' });
    },
  });

  const handle = await service.resolveFileResource(createNode({
    fileId: 'frontend-local-file',
    backendFileId: undefined,
    imageAsset: {
      assetId: 'frontend-local-file',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/frontend-local-file/thumbnail',
        },
      },
    },
  }), {
    purpose: 'viewer-original',
    require: 'file',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.deepEqual(resolvedBackendIds, ['frontend-local-file']);
  assert.deepEqual(fetchCalls, ['/api/v1/files/backend-probed-file/download']);
  const manifest = fileManifestStore.get({
    nodeId: 'node-1',
    fileId: 'frontend-local-file',
    variant: 'original',
  });
  assert.equal(manifest?.backendFileId, 'backend-probed-file');
  assert.equal(manifest?.variants.download?.url, '/api/v1/files/backend-probed-file/download');
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService inpaint-editor-original uses backend download when an image original variant is absent', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['inpaint-remote'], { type: 'image/png' });
    },
    createObjectUrl: (blob) => `blob:inpaint-backend-${blob.size}`,
    revokeObjectUrl: () => undefined,
  });

  const handle = await service.resolveFileResource(createNode({
    backendFileId: 'backend-inpaint-file',
    imageAsset: undefined,
  }), {
    purpose: 'inpaint-editor-original',
    require: 'displayUrl',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.equal(handle.displayUrl, 'blob:inpaint-backend-14');
  assert.deepEqual(fetchCalls, ['/api/v1/files/backend-inpaint-file/download']);
  const manifest = fileManifestStore.get({
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original',
  });
  assert.equal(manifest?.backendFileId, 'backend-inpaint-file');
  assert.equal(manifest?.variants.download?.url, '/api/v1/files/backend-inpaint-file/download');
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService export-original uses cached backend binding when node data was not patched', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['cached-backend'], { type: 'image/png' });
    },
  });
  fileManifestStore.markBackendReady({
    key: {
      nodeId: 'node-1',
      fileId: '30',
      variant: 'original',
    },
    backendFileId: 'backend-cached-file',
  });

  const handle = await service.resolveFileResource(createNode({
    fileId: '30',
    imageAsset: undefined,
  }), {
    purpose: 'export-original',
    require: 'file',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.equal(handle.file?.type, 'image/png');
  assert.deepEqual(fetchCalls, ['/api/v1/files/backend-cached-file/download']);
  const manifest = fileManifestStore.get({
    nodeId: 'node-1',
    fileId: '30',
    variant: 'original',
  });
  assert.equal(manifest?.backendFileId, 'backend-cached-file');
  assert.equal(manifest?.variants.download?.url, '/api/v1/files/backend-cached-file/download');
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService export-original does not download local-only file ids without backend binding', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['unexpected']);
    },
  });

  await assert.rejects(
    () => service.resolveFileResource(createNode({
      fileId: '30',
      imageAsset: undefined,
    }), {
      purpose: 'export-original',
      require: 'file',
    }),
    /No file resource source could satisfy the request/,
  );
  assert.deepEqual(fetchCalls, []);
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService restores persistent local source handles before remote download', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const restoreCalls: Array<{ referenceId: string; requestPermission: boolean | undefined }> = [];
  const restoredFile = new File(['restored-local'], 'restored.png', { type: 'image/png' });
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['unexpected']);
    },
    restoreLocalFileSource: async (referenceId, options) => {
      restoreCalls.push({
        referenceId,
        requestPermission: options?.requestPermission,
      });
      return {
        status: 'ready',
        file: restoredFile,
        permissionState: 'granted',
      };
    },
  });
  const node = createNode({
    fileId: '30',
    imageAsset: undefined,
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: Date.now(),
      sourceDisplayName: 'restored.png',
      localSource: {
        status: 'linked',
        referenceId: 'local-file-source:node-1:30',
        kind: 'file-system-access',
      },
    },
  });

  const handle = await service.resolveFileResource(node, {
    purpose: 'export-original',
    require: 'file',
    workflowId: 'workflow-local-restore',
  });

  assert.equal(handle.selectedSource, 'local-handle');
  assert.equal(handle.file, restoredFile);
  assert.deepEqual(restoreCalls, [{
    referenceId: 'local-file-source:node-1:30',
    requestPermission: true,
  }]);
  assert.deepEqual(fetchCalls, []);
  assert.equal(imageOriginalSourceRegistry.getFile('node-1', '30', {
    workflowId: 'workflow-local-restore',
  }), restoredFile);
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService export-original skips repeated remote download URLs from the caller context', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['unexpected']);
    },
  });

  await assert.rejects(
    () => service.resolveFileResource(createNode({
      backendFileId: 'backend-file-1',
      imageAsset: undefined,
    }), {
      purpose: 'export-original',
      require: 'file',
      skipRemoteDownloadUrls: ['/api/v1/files/backend-file-1/download'],
    }),
    /already failed/,
  );
  assert.deepEqual(fetchCalls, []);
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
});

test('FileResourceService display object urls are released through the resolver handle', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const created: string[] = [];
  const revoked: string[] = [];
  const service = new FileResourceService({
    createObjectUrl: (blob) => {
      const url = `blob:test-${blob.size}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
  });
  imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', new File(['local'], 'local.png'));

  const handle = await service.resolveFileResource(createNode(), {
    purpose: 'inpaint-editor-original',
    require: 'displayUrl',
  });

  assert.equal(handle.displayUrl, 'blob:test-5');
  assert.deepEqual(created, ['blob:test-5']);
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original',
  }), 1);
  handle.release();
  assert.deepEqual(revoked, ['blob:test-5']);
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original',
  }), 0);
  imageOriginalSourceRegistry.clear({ force: true });
  fileResourceLeaseManager.clear();
  fileManifestStore.clear();
});

test('FileResourceService uses scoped registry fallback when inpaint requests version etag metadata missing from local original', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceDiagnostics.clear();
  fileResourceLeaseManager.clear();
  const fetchCalls: string[] = [];
  const createdObjectUrls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['remote']);
    },
    createObjectUrl: (blob) => {
      const url = `blob:scoped-local-${blob.size}`;
      createdObjectUrls.push(url);
      return url;
    },
  });
  const localOriginal = new File(['full-original'], 'full-original.png', { type: 'image/png' });
  imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', localOriginal, {
    workflowId: 'workflow-inpaint',
    authScope: 'account-a',
  });

  const handle = await service.resolveFileResource(createNode(), {
    purpose: 'inpaint-editor-original',
    require: 'displayUrl',
    workflowId: 'workflow-inpaint',
    authScope: 'account-a',
    version: 3,
    etag: 'etag-from-image-asset',
  });

  assert.equal(handle.selectedSource, 'registry-file');
  assert.equal(handle.displayUrl, 'blob:scoped-local-13');
  assert.deepEqual(createdObjectUrls, ['blob:scoped-local-13']);
  assert.deepEqual(fetchCalls, []);
  const resolvedEvent = fileResourceDiagnostics.getEvents().find(
    (event) => event.event === 'resolved' && event.selectedSource === 'registry-file',
  );
  assert.equal(resolvedEvent?.detail?.registryMatchKind, 'loose-scoped');
  const looseEvent = fileResourceDiagnostics.getEvents().find(
    (event) => event.event === 'source-attempt'
      && event.source === 'registry-file'
      && event.detail?.matchKind === 'loose-scoped',
  );
  assert.equal(Boolean(looseEvent), true);

  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceDiagnostics.clear();
  fileResourceLeaseManager.clear();
});

test('FileResourceService does not use scoped registry fallback across workflow or auth boundaries', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['remote-boundary'], { type: 'image/png' });
    },
  });
  imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', new File(['wrong-scope'], 'wrong.png'), {
    workflowId: 'workflow-a',
    authScope: 'account-a',
  });

  const handle = await service.resolveFileResource(createNode(), {
    purpose: 'inpaint-editor-original',
    require: 'file',
    workflowId: 'workflow-b',
    authScope: 'account-a',
    version: 3,
    etag: 'etag-from-image-asset',
  });

  assert.equal(handle.selectedSource, 'remote-download');
  assert.deepEqual(fetchCalls, ['/api/v1/files/file-1/download']);
  assert.ok(handle.file?.name !== 'wrong.png');
  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});
