import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FileManifestStore,
  createFileResourceManifestKey,
} from './file-manifest-store';

test('FileManifestStore keeps identical file ids isolated by workflow, auth scope, and version', () => {
  const store = new FileManifestStore();

  store.markBackendReady({
    key: {
      workflowId: 'workflow-a',
      nodeId: 'node-1',
      fileId: 'shared-file',
      authScope: 'auth:user-a',
      variant: 'download',
      version: 'v1',
    },
    backendFileId: 'backend-a',
  });
  store.markBackendReady({
    key: {
      workflowId: 'workflow-b',
      nodeId: 'node-1',
      fileId: 'shared-file',
      authScope: 'auth:user-b',
      variant: 'download',
      version: 'v2',
    },
    backendFileId: 'backend-b',
  });

  assert.equal(store.get({
    workflowId: 'workflow-a',
    nodeId: 'node-1',
    fileId: 'shared-file',
    authScope: 'auth:user-a',
    variant: 'download',
    version: 'v1',
  })?.backendFileId, 'backend-a');
  assert.equal(store.get({
    workflowId: 'workflow-b',
    nodeId: 'node-1',
    fileId: 'shared-file',
    authScope: 'auth:user-b',
    variant: 'download',
    version: 'v2',
  })?.backendFileId, 'backend-b');
  assert.equal(store.getAll().length, 2);
});

test('FileManifestStore records local, uploading, backend-ready, and missing states', () => {
  const store = new FileManifestStore();
  const key = {
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    fileId: 'file-1',
    variant: 'original' as const,
  };

  const local = store.markLocalFile({
    key,
    file: new File(['local'], 'local.png', { type: 'image/png' }),
  });
  assert.equal(local.status, 'local-only');
  assert.equal(local.hasLocalFile, true);
  assert.equal(local.variants.original?.mimeType, 'image/png');

  const uploading = store.upsert({
    key,
    status: 'uploading',
  });
  assert.equal(uploading.status, 'uploading');
  assert.equal(uploading.hasLocalFile, true);

  const ready = store.markBackendReady({
    key,
    backendFileId: 'backend-file-1',
    binding: {
      backendFileId: 'backend-file-1',
      sha256: 'sha-1',
      size: 5,
      updatedAt: 1,
    },
  });
  assert.equal(ready.status, 'backend-ready');
  assert.equal(ready.backendFileId, 'backend-file-1');
  assert.equal(ready.backendBinding?.sha256, 'sha-1');

  const missing = store.markError({
    key: {
      workflowId: 'workflow-1',
      nodeId: 'node-missing',
      fileId: 'file-missing',
    },
    error: {
      code: 'NOT_FOUND',
      message: 'missing file',
      source: 'test',
    },
  });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.lastError?.message, 'missing file');
});

test('FileManifestStore removeInactive removes only entries outside active manifest keys', () => {
  const store = new FileManifestStore();
  const activeKey = {
    workflowId: 'workflow-1',
    nodeId: 'node-active',
    fileId: 'file-active',
  };
  const inactiveKey = {
    workflowId: 'workflow-1',
    nodeId: 'node-inactive',
    fileId: 'file-inactive',
  };

  store.markLocalFile({ key: activeKey });
  store.markLocalFile({ key: inactiveKey });

  assert.equal(store.removeInactive([activeKey]), 1);
  assert.equal(store.get(activeKey)?.fileId, 'file-active');
  assert.equal(store.get(inactiveKey), null);
});

test('createFileResourceManifestKey normalizes empty optional fields', () => {
  assert.equal(
    createFileResourceManifestKey({
      workflowId: '',
      nodeId: 'node',
      fileId: 'file',
      authScope: '',
      variant: null,
      version: '',
      etag: '',
    }),
    createFileResourceManifestKey({
      workflowId: null,
      nodeId: 'node',
      fileId: 'file',
      authScope: null,
      variant: null,
      version: null,
      etag: null,
    }),
  );
});
