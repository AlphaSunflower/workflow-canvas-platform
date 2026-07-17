import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLocalFileSourceReferenceId,
  createLocalFileSourceStore,
  createLocalFileSourceStoreRecord,
  type BrowserFileSystemFileHandleLike,
  type LocalFileSourceStoreRecord,
} from './local-file-source-store';

function createMemoryDriver() {
  const records = new Map<string, LocalFileSourceStoreRecord>();

  return {
    async get(referenceId: string) {
      return records.get(referenceId) ?? null;
    },
    async set(record: LocalFileSourceStoreRecord) {
      records.set(record.referenceId, record);
    },
    async delete(referenceId: string) {
      records.delete(referenceId);
    },
    async clear() {
      records.clear();
    },
  };
}

function createHandle(options: {
  file?: File;
  queryState?: PermissionState;
  requestState?: PermissionState;
} = {}): BrowserFileSystemFileHandleLike {
  const file = options.file ?? new File(['image'], 'scene.png', { type: 'image/png' });

  return {
    kind: 'file',
    name: file.name,
    getFile: async () => file,
    queryPermission: async () => options.queryState ?? 'granted',
    requestPermission: async () => options.requestState ?? options.queryState ?? 'granted',
  };
}

test('local file source store restores a granted persistent handle', async () => {
  const store = createLocalFileSourceStore(createMemoryDriver());
  const referenceId = createLocalFileSourceReferenceId('node-1', 'file-1');
  const file = new File(['image'], 'scene.png', { type: 'image/png' });
  const handle = createHandle({ file, queryState: 'granted' });

  await store.save(createLocalFileSourceStoreRecord(referenceId, handle, file, 'granted'));
  const restored = await store.restore(referenceId);

  assert.equal(restored.status, 'ready');
  assert.equal(restored.file, file);
  assert.equal(restored.permissionState, 'granted');
});

test('local file source store reports permission-required without requesting permission by default', async () => {
  const store = createLocalFileSourceStore(createMemoryDriver());
  const referenceId = createLocalFileSourceReferenceId('node-2', 'file-2');
  const file = new File(['image'], 'locked.png', { type: 'image/png' });
  const handle = createHandle({ file, queryState: 'prompt', requestState: 'granted' });

  await store.save(createLocalFileSourceStoreRecord(referenceId, handle, file, 'prompt'));
  const restored = await store.restore(referenceId);

  assert.equal(restored.status, 'permission-required');
  assert.equal(restored.permissionState, 'prompt');
});

test('local file source store can request permission during restore when explicitly asked', async () => {
  const store = createLocalFileSourceStore(createMemoryDriver());
  const referenceId = createLocalFileSourceReferenceId('node-3', 'file-3');
  const file = new File(['image'], 'prompt.png', { type: 'image/png' });
  const handle = createHandle({ file, queryState: 'prompt', requestState: 'granted' });

  await store.save(createLocalFileSourceStoreRecord(referenceId, handle, file, 'prompt'));
  const restored = await store.restore(referenceId, { requestPermission: true });

  assert.equal(restored.status, 'ready');
  assert.equal(restored.file, file);
  assert.equal(restored.permissionState, 'granted');
});

test('local file source store reports missing records without throwing', async () => {
  const store = createLocalFileSourceStore(createMemoryDriver());

  const restored = await store.restore('missing-reference');

  assert.equal(restored.status, 'missing');
  assert.equal(restored.permissionState, 'missing');
});
