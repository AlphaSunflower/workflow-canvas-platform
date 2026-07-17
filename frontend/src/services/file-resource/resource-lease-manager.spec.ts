import test from 'node:test';
import assert from 'node:assert/strict';

import { FileManifestStore } from './file-manifest-store';
import { ResourceLeaseManager } from './resource-lease-manager';

function createManager(options: {
  now?: number;
  defaultTtlMs?: number | null;
  ids?: string[];
} = {}): {
  manager: ResourceLeaseManager;
  manifestStore: FileManifestStore;
  setNow: (next: number) => void;
} {
  let now = options.now ?? 1_000;
  let index = 0;
  const manifestStore = new FileManifestStore();
  const manager = new ResourceLeaseManager({
    defaultTtlMs: options.defaultTtlMs,
    manifestStore,
    getNow: () => now,
    createLeaseId: () => options.ids?.[index++] ?? `lease-${index++}`,
  });

  return {
    manager,
    manifestStore,
    setNow: (next: number) => {
      now = next;
    },
  };
}

test('ResourceLeaseManager supports concurrent leases for the same file resource', () => {
  const { manager, manifestStore } = createManager({ ids: ['lease-a', 'lease-b'] });
  const key = {
    nodeId: 'node-1',
    fileId: 'file-1',
  };

  const uploadLease = manager.acquireLease(key, 'upload', 'upload:node-1');
  const viewerLease = manager.acquireLease(key, 'viewer', 'viewer:node-1');

  assert.equal(uploadLease.leaseId, 'lease-a');
  assert.equal(viewerLease.leaseId, 'lease-b');
  assert.equal(manager.isLeased(key), true);
  assert.equal(manager.getLeaseCount(key), 2);
  assert.equal(manifestStore.get(key)?.leaseCount, 2);
  assert.equal(manager.getLeaseSnapshot().leasedResourceCount, 1);
});

test('ResourceLeaseManager releaseLease is idempotent and updates manifest lease count', () => {
  const { manager, manifestStore } = createManager({ ids: ['lease-a', 'lease-b'] });
  const key = {
    nodeId: 'node-1',
    fileId: 'file-1',
  };

  const left = manager.acquireLease(key, 'upload', 'upload:node-1');
  manager.acquireLease(key, 'execution', 'execution:node-1');

  assert.equal(manager.releaseLease(left.leaseId), true);
  assert.equal(manager.releaseLease(left.leaseId), false);
  assert.equal(manager.getLeaseCount(key), 1);
  assert.equal(manifestStore.get(key)?.leaseCount, 1);
});

test('ResourceLeaseManager avoids overwriting active leases when generated ids collide', () => {
  const { manager } = createManager({ ids: ['same-lease', 'same-lease'] });
  const key = {
    nodeId: 'node-1',
    fileId: 'file-1',
  };

  const left = manager.acquireLease(key, 'upload', 'owner');
  const right = manager.acquireLease(key, 'viewer', 'owner');

  assert.equal(left.leaseId, 'same-lease');
  assert.equal(right.leaseId, 'same-lease-2');
  assert.equal(manager.getLeaseCount(key), 2);
});

test('ResourceLeaseManager creates unique fallback ids when generated ids are blank', () => {
  const { manager } = createManager({
    now: 1_234,
    ids: ['', ''],
  });
  const key = {
    nodeId: 'node:1',
    fileId: 'file/1',
  };

  const left = manager.acquireLease(key, 'upload', 'owner');
  const right = manager.acquireLease(key, 'viewer', 'owner');

  assert.equal(left.leaseId, 'file-resource-lease-node-1-file-1-1234');
  assert.equal(right.leaseId, 'file-resource-lease-node-1-file-1-1234-2');
});

test('ResourceLeaseManager releaseOwner releases all leases owned by a workflow or operation', () => {
  const { manager, manifestStore } = createManager({ ids: ['lease-a', 'lease-b', 'lease-c'] });
  const keyA = {
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    fileId: 'file-1',
  };
  const keyB = {
    workflowId: 'workflow-1',
    nodeId: 'node-2',
    fileId: 'file-2',
  };

  manager.acquireLease(keyA, 'upload', 'workflow:workflow-1');
  manager.acquireLease(keyB, 'inpaint-editor', 'workflow:workflow-1');
  manager.acquireLease(keyB, 'viewer', 'viewer:node-2');

  assert.equal(manager.releaseOwner('workflow:workflow-1'), 2);
  assert.equal(manager.getLeaseCount(keyA), 0);
  assert.equal(manager.getLeaseCount(keyB), 1);
  assert.equal(manifestStore.get(keyA)?.leaseCount, 0);
  assert.equal(manifestStore.get(keyB)?.leaseCount, 1);
});

test('ResourceLeaseManager expires stale leases by TTL without touching unexpired leases', () => {
  const { manager, manifestStore, setNow } = createManager({
    now: 1_000,
    defaultTtlMs: 500,
    ids: ['lease-a', 'lease-b'],
  });
  const keyA = {
    nodeId: 'node-1',
    fileId: 'file-1',
  };
  const keyB = {
    nodeId: 'node-2',
    fileId: 'file-2',
  };

  manager.acquireLease(keyA, 'upload', 'upload:node-1');
  manager.acquireLease(keyB, 'export', 'export:node-2', { ttlMs: 2_000 });

  setNow(1_600);

  assert.equal(manager.expireStaleLeases(), 1);
  assert.equal(manager.isLeased(keyA), false);
  assert.equal(manager.isLeased(keyB), true);
  assert.equal(manifestStore.get(keyA)?.leaseCount, 0);
  assert.equal(manifestStore.get(keyB)?.leaseCount, 1);
});

test('ResourceLeaseManager supports abort/finally style cleanup through releaseOwner', () => {
  const { manager } = createManager({ ids: ['lease-a', 'lease-b'] });
  const owner = 'upload-operation:abortable';

  manager.acquireLease({ nodeId: 'node-1', fileId: 'file-1' }, 'upload', owner);
  manager.acquireLease({ nodeId: 'node-2', fileId: 'file-2' }, 'upload', owner);

  try {
    throw new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    assert.equal(manager.releaseOwner(owner), 2);
  }

  assert.equal(manager.getLeaseSnapshot().leases.length, 0);
});
