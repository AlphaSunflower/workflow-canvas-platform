import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import { createWorkflowUploadScheduler } from './workflow-upload-scheduler';
import { shouldActivateNodeUploadSubscription } from '@/hooks/workflow/useNodeUploadSnapshot';
import {
  fileManifestStore,
  fileResourceLeaseManager,
} from './file-resource';
import {
  clearRuntimeNodeFileSources,
  getFileBlobFromNode,
  registerRuntimeNodeFileSource,
} from './backendFileService';
import { imageOriginalSourceRegistry } from './image/image-original-source-registry';

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
    fileId: 'local-file-1',
    fileName: 'example.png',
    fileSize: 2048,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 512,
      height: 512,
    },
    ...overrides,
  };
}

test('workflow upload scheduler single-flights duplicate ensureReady calls for the same node', async () => {
  const file = new File(['same-content'], 'example.png', { type: 'image/png' });
  const registerCalls: string[] = [];
  const uploadCalls: string[] = [];

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-1',
    registerBackendFile: async (_node, _file, sha256) => {
      registerCalls.push(sha256);
      return {
        uploadRequired: true,
        uploadId: 'upload-1',
        fileId: 'backend-file-1',
        file: {} as never,
      };
    },
    uploadBackendFile: async (uploadId) => {
      uploadCalls.push(uploadId);
      return {
        uploadId,
        fileId: 'backend-file-1',
        file: {} as never,
      };
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const node = createNode();
  const [left, right] = await Promise.all([
    scheduler.ensureReady(node),
    scheduler.ensureReady(node, { priority: 'high' }),
  ]);

  assert.equal(left, 'backend-file-1');
  assert.equal(right, 'backend-file-1');
  assert.equal(registerCalls.length, 1);
  assert.equal(uploadCalls.length, 1);
});

test('workflow upload scheduler mirrors upload readiness into file resource manifest without changing ensureReady behavior', async () => {
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const file = new File(['manifest-content'], 'manifest.png', { type: 'image/png' });
  const node = createNode({
    id: {
      value: 'node-manifest',
      display: '#00999',
    },
    fileId: 'local-file-manifest',
    fileSize: file.size,
  });

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-manifest',
    registerBackendFile: async () => ({
      uploadRequired: false,
      fileId: 'backend-file-manifest',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      throw new Error('upload should not be required');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const backendFileId = await scheduler.ensureReady(node);
  const manifest = fileManifestStore.get({
    nodeId: node.id.value,
    fileId: node.fileId,
  });

  assert.equal(backendFileId, 'backend-file-manifest');
  assert.equal(manifest?.status, 'backend-ready');
  assert.equal(manifest?.backendFileId, 'backend-file-manifest');
  assert.equal(manifest?.backendBinding?.sha256, 'sha-manifest');
  assert.equal(manifest?.hasLocalFile, true);
  assert.equal(manifest?.leaseCount, 0);
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 0);
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('workflow upload scheduler holds upload lease until upload task completes', async () => {
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const file = new File(['lease-content'], 'lease.png', { type: 'image/png' });
  const node = createNode({
    id: {
      value: 'node-upload-lease',
      display: '#00401',
    },
    fileId: 'local-upload-lease',
    fileSize: file.size,
  });
  let releaseUpload: (() => void) | undefined;
  let observedLeaseDuringUpload = 0;

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-upload-lease',
    registerBackendFile: async () => ({
      uploadRequired: true,
      uploadId: 'upload-lease',
      fileId: 'backend-upload-lease',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      observedLeaseDuringUpload = fileResourceLeaseManager.getLeaseCount({
        nodeId: node.id.value,
        fileId: node.fileId,
        variant: 'original',
      });
      await new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      return {
        uploadId: 'upload-lease',
        fileId: 'backend-upload-lease',
        file: {} as never,
      };
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const pending = scheduler.ensureReady(node);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.equal(observedLeaseDuringUpload, 1);
  assert.equal(typeof releaseUpload, 'function');
  releaseUpload?.();

  const backendFileId = await pending;
  assert.equal(backendFileId, 'backend-upload-lease');
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 0);
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('workflow upload scheduler uses prompt-reference leases for prompt optimization inputs', async () => {
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const file = new File(['prompt-reference-content'], 'prompt-reference.png', { type: 'image/png' });
  const node = createNode({
    id: {
      value: 'node-prompt-reference',
      display: '#00403',
    },
    fileId: 'local-prompt-reference',
    fileSize: file.size,
  });
  let releaseHash: (() => void) | undefined;
  let observedLeaseReason: string | undefined;

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => {
      observedLeaseReason = fileResourceLeaseManager.getLeaseSnapshot().leases
        .find((lease) => lease.nodeId === node.id.value && lease.fileId === node.fileId)
        ?.reason;
      await new Promise<void>((resolve) => {
        releaseHash = resolve;
      });
      return 'sha-prompt-reference';
    },
    registerBackendFile: async () => ({
      uploadRequired: false,
      fileId: 'backend-prompt-reference',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      throw new Error('upload should not be required');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const pending = scheduler.ensureReady(node, { purpose: 'prompt-reference' });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.equal(observedLeaseReason, 'prompt-reference');
  assert.equal(typeof releaseHash, 'function');
  releaseHash?.();

  const backendFileId = await pending;
  assert.equal(backendFileId, 'backend-prompt-reference');
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 0);
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('workflow upload scheduler preserves local-only runtime file during upload cleanup', async () => {
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  clearRuntimeNodeFileSources();
  const file = new File(['local-only-content'], 'local-only.png', { type: 'image/png' });
  const node = createNode({
    id: {
      value: 'node-local-only-upload',
      display: '#00402',
    },
    fileId: 'local-only-upload',
    fileSize: file.size,
  });
  let releaseHash: (() => void) | undefined;

  registerRuntimeNodeFileSource(node.id.value, node.fileId, file);

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: (targetNode, options) => getFileBlobFromNode(targetNode, options?.signal),
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => {
      await new Promise<void>((resolve) => {
        releaseHash = resolve;
      });
      return 'sha-local-only-upload';
    },
    registerBackendFile: async () => ({
      uploadRequired: false,
      fileId: 'backend-local-only-upload',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      throw new Error('upload should not be required');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const pending = scheduler.ensureReady(node);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.equal(fileResourceLeaseManager.getLeaseCount({
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 1);
  clearRuntimeNodeFileSources();
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId), file);

  assert.equal(typeof releaseHash, 'function');
  releaseHash?.();
  const backendFileId = await pending;

  assert.equal(backendFileId, 'backend-local-only-upload');
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 0);
  clearRuntimeNodeFileSources();
  assert.equal(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId), null);
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('workflow upload scheduler prepares a just-imported local image for AI execution without remote download', async () => {
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  clearRuntimeNodeFileSources();
  imageOriginalSourceRegistry.clear({ force: true });
  const file = new File(['fresh-local-import'], 'fresh-local.png', { type: 'image/png' });
  const node = createNode({
    id: {
      value: 'node-fresh-local-ai-input',
      display: '#00404',
    },
    fileId: 'fresh-local-ai-input',
    fileName: 'fresh-local.png',
    fileSize: file.size,
    imageAsset: {
      assetId: 'fresh-local-ai-input',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/fresh-local-ai-input/thumbnail',
        },
        original: {
          url: '/api/v1/files/fresh-local-ai-input/download',
        },
      },
    },
  });
  const observedFiles: File[] = [];
  const observedGetFileScopes: Array<{ workflowId?: string | null; authScope?: string | null }> = [];
  const originalFetch = globalThis.fetch;

  registerRuntimeNodeFileSource(node.id.value, node.fileId, file, {
    workflowId: 'workflow-fresh-local',
    authScope: 'account-fresh-local',
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      throw new Error(`Fresh local AI input should not download original: ${String(input)}`);
    },
  });

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async (targetNode, options) => {
      observedGetFileScopes.push({
        workflowId: options?.workflowId,
        authScope: options?.authScope,
      });
      return getFileBlobFromNode(targetNode, options?.signal);
    },
    resolveExistingBackendFileId: async () => null,
    hashFile: async (resolvedFile) => {
      observedFiles.push(resolvedFile);
      return 'sha-fresh-local-ai-input';
    },
    registerBackendFile: async () => ({
      uploadRequired: false,
      fileId: 'backend-fresh-local-ai-input',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      throw new Error('upload should not be required');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  try {
    const backendFileId = await scheduler.ensureReady(node, {
      workflowId: 'workflow-fresh-local',
      authScope: 'account-fresh-local',
      purpose: 'upload-input',
    });

    assert.equal(backendFileId, 'backend-fresh-local-ai-input');
    assert.deepEqual(observedFiles, [file]);
    assert.deepEqual(observedGetFileScopes, [{
      workflowId: 'workflow-fresh-local',
      authScope: 'account-fresh-local',
    }]);
    assert.equal(scheduler.getNodeSnapshot(node.id.value, 'workflow-fresh-local')?.status, 'ready');
    assert.equal(fileResourceLeaseManager.getLeaseCount({
      workflowId: 'workflow-fresh-local',
      nodeId: node.id.value,
      fileId: node.fileId,
      variant: 'original',
    }), 0);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    clearRuntimeNodeFileSources();
    imageOriginalSourceRegistry.clear({ force: true });
    fileManifestStore.clear();
    fileResourceLeaseManager.clear();
  }
});

test('workflow upload scheduler reuses same sha256 backend file id without re-upload', async () => {
  const file = new File(['duplicate-content'], 'duplicate.png', { type: 'image/png' });
  const shaCache = new Map<string, string>([['sha-dup', 'backend-file-dup']]);
  const node = createNode({
    id: { value: 'node-2', display: '#00002' },
    fileId: 'local-file-2',
  });

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-dup',
    registerBackendFile: async () => {
      throw new Error('register should not be called');
    },
    uploadBackendFile: async () => {
      throw new Error('upload should not be called');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: (sha256) => shaCache.get(sha256) ?? null,
    cacheBackendFileIdBySha256: (sha256, backendFileId) => {
      shaCache.set(sha256, backendFileId);
    },
  });

  const backendFileId = await scheduler.ensureReady(node);
  assert.equal(backendFileId, 'backend-file-dup');
  assert.equal(scheduler.getNodeSnapshot(node.id.value)?.status, 'ready');
});

test('workflow upload scheduler exposes status transitions until ready', async () => {
  const file = new File(['status-content'], 'status.png', { type: 'image/png' });
  const transitions: string[] = [];
  let releaseUpload: (() => void) | undefined;

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-status',
    registerBackendFile: async () => ({
      uploadRequired: true,
      uploadId: 'upload-status',
      fileId: 'backend-file-status',
      file: {} as never,
    }),
    uploadBackendFile: async (uploadId) => {
      await new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      return {
        uploadId,
        fileId: 'backend-file-status',
        file: {} as never,
      };
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const node = createNode({
    id: { value: 'node-3', display: '#00003' },
    fileId: 'local-file-3',
  });

  const unsubscribe = scheduler.subscribe(() => {
    const status = scheduler.getNodeSnapshot(node.id.value)?.status;
    if (status) {
      transitions.push(status);
    }
  });

  const pending = scheduler.ensureReady(node);

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const resolveUpload = releaseUpload;
  if (!resolveUpload) {
    throw new Error('Expected upload promise resolver to be ready.');
  }
  resolveUpload();
  const backendFileId = await pending;

  unsubscribe();

  assert.equal(backendFileId, 'backend-file-status');
  assert.ok(transitions.includes('hashing'));
  assert.ok(transitions.includes('registering'));
  assert.ok(transitions.includes('uploading'));
  assert.equal(scheduler.getNodeSnapshot(node.id.value)?.status, 'ready');
});

test('workflow upload scheduler returns stable snapshot references when state has not changed', () => {
  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => {
      throw new Error('not expected');
    },
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-stable',
    registerBackendFile: async () => {
      throw new Error('not expected');
    },
    uploadBackendFile: async () => {
      throw new Error('not expected');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  });

  const first = scheduler.getSnapshot();
  const second = scheduler.getSnapshot();
  const firstWorkflowScoped = scheduler.getSnapshot(undefined, 'workflow-stable');
  const secondWorkflowScoped = scheduler.getSnapshot(undefined, 'workflow-stable');
  const firstNodeScoped = scheduler.getSnapshot('missing-node', 'workflow-stable');
  const secondNodeScoped = scheduler.getSnapshot('missing-node', 'workflow-stable');

  assert.equal(first, second);
  assert.equal(firstWorkflowScoped, secondWorkflowScoped);
  assert.equal(firstNodeScoped, secondNodeScoped);
  assert.equal(scheduler.getNodeSnapshot('missing-node'), null);
});

test('workflow upload scheduler node subscriptions only notify changed nodes', async () => {
  const file = new File(['node-specific-content'], 'node-specific.png', { type: 'image/png' });
  const nodeA = createNode({
    id: { value: 'node-specific-a', display: '#00101' },
    fileId: 'local-file-a',
  });
  const nodeB = createNode({
    id: { value: 'node-specific-b', display: '#00102' },
    fileId: 'local-file-b',
  });
  let nodeANotifications = 0;
  let nodeBNotifications = 0;

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-node-specific-a',
    registerBackendFile: async () => ({
      uploadRequired: false,
      fileId: 'backend-node-specific-a',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      throw new Error('upload should not be called');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const unsubscribeA = scheduler.subscribeNode(nodeA.id.value, () => {
    nodeANotifications += 1;
  });
  const unsubscribeB = scheduler.subscribeNode(nodeB.id.value, () => {
    nodeBNotifications += 1;
  });

  await scheduler.ensureReady(nodeA);

  unsubscribeA();
  unsubscribeB();

  assert.equal(nodeANotifications > 0, true);
  assert.equal(nodeBNotifications, 0);
});

test('workflow upload scheduler keeps unchanged node snapshot reference stable across unrelated updates', async () => {
  const file = new File(['stable-reference-content'], 'stable-reference.png', { type: 'image/png' });
  const nodeA = createNode({
    id: { value: 'stable-ref-a', display: '#00111' },
    fileId: 'stable-ref-file-a',
  });
  const nodeB = createNode({
    id: { value: 'stable-ref-b', display: '#00112' },
    fileId: 'stable-ref-file-b',
    backendFileId: 'backend-stable-ref-b',
  });

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async (node) => node.backendFileId ?? null,
    hashFile: async () => 'sha-stable-ref',
    registerBackendFile: async () => ({
      uploadRequired: false,
      fileId: 'backend-stable-ref-a',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      throw new Error('upload should not be called');
    },
    getCachedBackendFileBinding: (node) => (
      node.id.value === nodeB.id.value
        ? {
          backendFileId: 'backend-stable-ref-b',
          sha256: 'sha-stable-ref-b',
          size: 1024,
          updatedAt: 1_000,
        }
        : null
    ),
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  scheduler.enqueueNode(nodeB);
  const stableSnapshot = scheduler.getNodeSnapshot(nodeB.id.value);
  await scheduler.ensureReady(nodeA);
  const stableSnapshotAfterUnrelatedUpload = scheduler.getNodeSnapshot(nodeB.id.value);

  assert.ok(stableSnapshot);
  assert.equal(stableSnapshotAfterUnrelatedUpload, stableSnapshot);
});

test('workflow upload activation skips stable remote or already-bound nodes', () => {
  const readyRemoteNode = createNode({
    source: {
      type: 'node-output',
      importedAt: Date.now(),
      producerNodeId: 'producer-1',
    },
    backendFileId: 'backend-ready',
  });
  const stableLocalBoundNode = createNode({
    backendFileId: 'backend-local-bound',
  });
  const pendingLocalNode = createNode({
    backendFileId: undefined,
    status: 'processing',
  });

  assert.equal(shouldActivateNodeUploadSubscription(readyRemoteNode), false);
  assert.equal(shouldActivateNodeUploadSubscription(stableLocalBoundNode), false);
  assert.equal(shouldActivateNodeUploadSubscription(pendingLocalNode), true);
});

test('workflow upload scheduler uploads the original file returned from node source without reading preview or thumbnail fields', async () => {
  const originalFile = new File(['original-binary'], 'original.png', { type: 'image/png' });
  const registerFiles: File[] = [];
  const uploadFiles: File[] = [];
  const node = createNode({
    id: { value: 'node-original-only-upload', display: '#00201' },
    fileId: 'local-original-only',
    thumbnailUrl: 'blob:thumb-only',
    imageAsset: {
      assetId: 'local-original-only',
      source: 'local',
      version: 1,
      variants: {
        thumbnail: { url: 'blob:thumb-only' },
        original: { url: 'blob:original-only' },
      },
    },
  });

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => originalFile,
    resolveExistingBackendFileId: async () => null,
    hashFile: async (file) => {
      assert.equal(file, originalFile);
      return 'sha-original-only';
    },
    registerBackendFile: async (_node, file) => {
      registerFiles.push(file);
      return {
        uploadRequired: true,
        uploadId: 'upload-original-only',
        fileId: 'backend-original-only',
        file: {} as never,
      };
    },
    uploadBackendFile: async (_uploadId, file) => {
      uploadFiles.push(file);
      return {
        uploadId: 'upload-original-only',
        fileId: 'backend-original-only',
        file: {} as never,
      };
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const backendFileId = await scheduler.ensureReady(node);

  assert.equal(backendFileId, 'backend-original-only');
  assert.equal(registerFiles.length, 1);
  assert.equal(uploadFiles.length, 1);
  assert.equal(registerFiles[0], originalFile);
  assert.equal(uploadFiles[0], originalFile);
  assert.equal(registerFiles[0]?.name, 'original.png');
  assert.equal(uploadFiles[0]?.name, 'original.png');
});

test('workflow upload scheduler passes workflow scope to file resolution and upload leases', async () => {
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();

  const file = new File(['scoped-content'], 'scoped.png', { type: 'image/png' });
  const seenWorkflowIds: Array<string | null | undefined> = [];
  const node = createNode({
    id: { value: 'node-scoped-upload', display: '#00202' },
    fileId: 'local-scoped-upload',
  });

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async (_node, options) => {
      seenWorkflowIds.push(options?.workflowId);
      return file;
    },
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-scoped-upload',
    registerBackendFile: async () => ({
      uploadRequired: false,
      fileId: 'backend-scoped-upload',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      throw new Error('uploadBackendFile should not be called');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const backendFileId = await scheduler.ensureReady(node, {
    workflowId: 'workflow-scoped-upload',
  });

  assert.equal(backendFileId, 'backend-scoped-upload');
  assert.deepEqual(seenWorkflowIds, ['workflow-scoped-upload']);
  assert.equal(fileResourceLeaseManager.getLeaseCount({
    workflowId: 'workflow-scoped-upload',
    nodeId: node.id.value,
    fileId: node.fileId,
    variant: 'original',
  }), 0);
  assert.equal(fileManifestStore.get({
    workflowId: 'workflow-scoped-upload',
    nodeId: node.id.value,
    fileId: node.fileId,
  })?.status, 'backend-ready');

  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('workflow upload scheduler passes workflow scope to backend binding cache reads and writes', async () => {
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const node = createNode({
    id: { value: 'node-binding-scope-upload', display: '#00272' },
    fileId: 'local-binding-scope-upload',
  });
  const file = new File(['binding-scope-upload'], 'binding-scope.png', { type: 'image/png' });
  const bindingReads: Array<string | null | undefined> = [];
  const bindingWrites: Array<string | null | undefined> = [];

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async (_node, options) => {
      bindingReads.push(options?.workflowId);
      return null;
    },
    hashFile: async () => 'sha-binding-scope-upload',
    registerBackendFile: async () => ({
      uploadRequired: false,
      fileId: 'backend-binding-scope-upload',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      throw new Error('uploadBackendFile should not be called');
    },
    getCachedBackendFileBinding: (_node, scope) => {
      bindingReads.push(scope?.workflowId);
      return null;
    },
    cacheBackendFileBinding: (_node, _binding, scope) => {
      bindingWrites.push(scope?.workflowId);
    },
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const backendFileId = await scheduler.ensureReady(node, {
    workflowId: 'workflow-binding-scope',
  });

  assert.equal(backendFileId, 'backend-binding-scope-upload');
  assert.deepEqual(bindingReads, [
    'workflow-binding-scope',
    'workflow-binding-scope',
  ]);
  assert.deepEqual(bindingWrites, ['workflow-binding-scope']);
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('workflow upload scheduler keeps tasks and snapshots isolated by workflow', async () => {
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const node = createNode({
    id: { value: 'node-workflow-isolated', display: '#00273' },
    fileId: 'local-workflow-isolated',
  });
  const filesByWorkflow = new Map<string, File>([
    ['workflow-a', new File(['workflow-a-content'], 'a.png', { type: 'image/png' })],
    ['workflow-b', new File(['workflow-b-content'], 'b.png', { type: 'image/png' })],
  ]);
  const registerCalls: Array<{ workflowId: string | null | undefined; sha256: string }> = [];

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async (_node, options) => {
      const file = filesByWorkflow.get(options?.workflowId ?? '');
      if (!file) {
        throw new Error(`Missing file for workflow ${options?.workflowId ?? 'none'}`);
      }
      return file;
    },
    resolveExistingBackendFileId: async () => null,
    hashFile: async (file) => `sha-${file.name}`,
    registerBackendFile: async (_node, _file, sha256) => {
      const workflowId = sha256.includes('a.png') ? 'workflow-a' : 'workflow-b';
      registerCalls.push({ workflowId, sha256 });
      return {
        uploadRequired: false,
        fileId: `backend-${workflowId}`,
        file: {} as never,
      };
    },
    uploadBackendFile: async () => {
      throw new Error('uploadBackendFile should not be called');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });

  const [backendA, backendB] = await Promise.all([
    scheduler.ensureReady(node, { workflowId: 'workflow-a' }),
    scheduler.ensureReady(node, { workflowId: 'workflow-b' }),
  ]);

  assert.equal(backendA, 'backend-workflow-a');
  assert.equal(backendB, 'backend-workflow-b');
  assert.equal(registerCalls.length, 2);
  assert.equal(scheduler.getSnapshot(undefined, 'workflow-a').length, 1);
  assert.equal(scheduler.getSnapshot(undefined, 'workflow-b').length, 1);
  assert.equal(scheduler.getNodeSnapshot(node.id.value, 'workflow-a')?.backendFileId, 'backend-workflow-a');
  assert.equal(scheduler.getNodeSnapshot(node.id.value, 'workflow-b')?.backendFileId, 'backend-workflow-b');
  assert.equal(scheduler.getSnapshot(node.id.value).length, 2);
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('workflow upload scheduler node subscriptions can be scoped by workflow', async () => {
  const node = createNode({
    id: { value: 'node-workflow-subscription', display: '#00274' },
    fileId: 'local-workflow-subscription',
  });
  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async (_node, options) => new File([options?.workflowId ?? 'none'], `${options?.workflowId ?? 'none'}.png`, {
      type: 'image/png',
    }),
    resolveExistingBackendFileId: async () => null,
    hashFile: async (file) => `sha-${file.name}`,
    registerBackendFile: async (_node, file) => ({
      uploadRequired: false,
      fileId: `backend-${file.name.replace('.png', '')}`,
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      throw new Error('uploadBackendFile should not be called');
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
  });
  let workflowANotifications = 0;
  let workflowBNotifications = 0;
  const unsubscribeA = scheduler.subscribeNode(node.id.value, 'workflow-a', () => {
    workflowANotifications += 1;
  });
  const unsubscribeB = scheduler.subscribeNode(node.id.value, 'workflow-b', () => {
    workflowBNotifications += 1;
  });

  await scheduler.ensureReady(node, { workflowId: 'workflow-a' });

  unsubscribeA();
  unsubscribeB();
  assert.equal(workflowANotifications > 0, true);
  assert.equal(workflowBNotifications, 0);
});

test('workflow upload scheduler fails bounded wait when task never settles', async () => {
  const node = createNode({
    id: { value: 'node-timeout', display: '#00301' },
    fileId: 'local-timeout',
  });
  const file = new File(['timeout-content'], 'timeout.png', { type: 'image/png' });

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-timeout',
    registerBackendFile: async () => ({
      uploadRequired: true,
      uploadId: 'upload-timeout',
      fileId: 'backend-timeout',
      file: {} as never,
    }),
    uploadBackendFile: async () => new Promise<never>(() => undefined),
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
    taskWaitTimeoutMs: 20,
  });

  await assert.rejects(
    () => scheduler.ensureReady(node),
    (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError',
  );
});

test('workflow upload scheduler aborts waiters without forcing shared task into failed state', async () => {
  const file = new File(['abort-content'], 'abort.png', { type: 'image/png' });
  let releaseUpload: (() => void) | undefined;
  const node = createNode({
    id: { value: 'node-abort', display: '#00302' },
    fileId: 'local-abort',
  });

  const scheduler = createWorkflowUploadScheduler({
    getFileFromNode: async () => file,
    resolveExistingBackendFileId: async () => null,
    hashFile: async () => 'sha-abort',
    registerBackendFile: async () => ({
      uploadRequired: true,
      uploadId: 'upload-abort',
      fileId: 'backend-abort',
      file: {} as never,
    }),
    uploadBackendFile: async () => {
      await new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      return {
        uploadId: 'upload-abort',
        fileId: 'backend-abort',
        file: {} as never,
      };
    },
    getCachedBackendFileBinding: () => null,
    cacheBackendFileBinding: () => undefined,
    getCachedBackendFileIdBySha256: () => null,
    cacheBackendFileIdBySha256: () => undefined,
  }, {
    hashConcurrency: 1,
    uploadConcurrency: 1,
    taskWaitTimeoutMs: 1_000,
  });

  const controller = new AbortController();
  const abortedPromise = scheduler.ensureReady(node, { signal: controller.signal });

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  controller.abort();

  await assert.rejects(
    () => abortedPromise,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );

  assert.equal(typeof releaseUpload, 'function');
  if (!releaseUpload) {
    throw new Error('Expected upload promise resolver to be ready.');
  }
  releaseUpload();

  const backendFileId = await scheduler.ensureReady(node);
  assert.equal(backendFileId, 'backend-abort');
  assert.equal(scheduler.getNodeSnapshot(node.id.value)?.status, 'ready');
});
