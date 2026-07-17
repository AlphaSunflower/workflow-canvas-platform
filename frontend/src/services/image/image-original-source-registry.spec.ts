import test from 'node:test';
import assert from 'node:assert/strict';

import { fileManifestStore, fileResourceLeaseManager } from '@/services/file-resource';
import { imageOriginalSourceRegistry } from './image-original-source-registry';

test('imageOriginalSourceRegistry lazily creates and revokes object URLs for local original files', () => {
  const created: string[] = [];
  const revoked: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (blob: Blob): string => {
    const url = `blob:local-${created.length + 1}-${blob.size}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageOriginalSourceRegistry.clear();
    const file = new File(['original'], 'image.png', { type: 'image/png' });
    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', file);

    assert.equal(imageOriginalSourceRegistry.getFile('node-1', 'file-1'), file);
    assert.equal(imageOriginalSourceRegistry.getOrCreateObjectUrl('node-1', 'file-1'), 'blob:local-1-8');
    assert.equal(imageOriginalSourceRegistry.getOrCreateObjectUrl('node-1', 'file-1'), 'blob:local-1-8');
    assert.deepEqual(created, ['blob:local-1-8']);

    imageOriginalSourceRegistry.unregister('node-1', 'file-1');

    assert.deepEqual(revoked, ['blob:local-1-8']);
    assert.equal(imageOriginalSourceRegistry.get('node-1', 'file-1'), null);
  } finally {
    imageOriginalSourceRegistry.clear();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('imageOriginalSourceRegistry sync removes inactive original sources', () => {
  const revoked: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (): string => 'blob:inactive';
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageOriginalSourceRegistry.clear();
    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', new File(['a'], 'a.png'));
    imageOriginalSourceRegistry.registerRemoteOriginal('node-2', 'file-2', '/api/v1/files/file-2/download');
    imageOriginalSourceRegistry.getOrCreateObjectUrl('node-1', 'file-1');

    imageOriginalSourceRegistry.sync([
      {
        id: { value: 'node-2' },
        fileId: 'file-2',
      },
    ]);

    assert.equal(imageOriginalSourceRegistry.get('node-1', 'file-1'), null);
    assert.equal(imageOriginalSourceRegistry.getOriginalUrl('node-2', 'file-2'), '/api/v1/files/file-2/download');
    assert.deepEqual(revoked, ['blob:inactive']);
  } finally {
    imageOriginalSourceRegistry.clear();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('imageOriginalSourceRegistry revokes stale object urls when rebinding a new local file', () => {
  const created: string[] = [];
  const revoked: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (blob: Blob): string => {
    const url = `blob:rebind-${created.length + 1}-${blob.size}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageOriginalSourceRegistry.clear();
    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', new File(['first'], 'first.png'));
    assert.equal(imageOriginalSourceRegistry.getOrCreateObjectUrl('node-1', 'file-1'), 'blob:rebind-1-5');

    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', new File(['second'], 'second.png'));
    assert.equal(imageOriginalSourceRegistry.getOrCreateObjectUrl('node-1', 'file-1'), 'blob:rebind-2-6');
    assert.deepEqual(revoked, ['blob:rebind-1-5']);
  } finally {
    imageOriginalSourceRegistry.clear();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('imageOriginalSourceRegistry reports stale object url failures and notifies subscribers', () => {
  const created: string[] = [];
  const revoked: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (): string => {
    const url = `blob:stale-${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageOriginalSourceRegistry.clear();
    let notifications = 0;
    const unsubscribe = imageOriginalSourceRegistry.subscribe('node-1', 'file-1', () => {
      notifications += 1;
    });

    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', new File(['image'], 'image.png'));
    const staleUrl = imageOriginalSourceRegistry.getOrCreateObjectUrl('node-1', 'file-1');

    assert.equal(staleUrl, 'blob:stale-1');
    assert.equal(imageOriginalSourceRegistry.reportObjectUrlFailure('node-1', 'file-1', 'blob:other'), false);
    assert.equal(imageOriginalSourceRegistry.reportObjectUrlFailure('node-1', 'file-1', staleUrl ?? ''), true);
    assert.deepEqual(revoked, ['blob:stale-1']);

    const replacementUrl = imageOriginalSourceRegistry.getOrCreateObjectUrl('node-1', 'file-1');
    assert.equal(replacementUrl, 'blob:stale-2');
    assert.equal(notifications, 2);
    unsubscribe();
  } finally {
    imageOriginalSourceRegistry.clear();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('imageOriginalSourceRegistry preserves leased original files during unregister sync and clear', () => {
  const revoked: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (): string => 'blob:leased';
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageOriginalSourceRegistry.clear({ force: true });
    fileResourceLeaseManager.clear();
    const file = new File(['leased'], 'leased.png');
    imageOriginalSourceRegistry.registerLocalFile('node-lease', 'file-lease', file);
    imageOriginalSourceRegistry.getOrCreateObjectUrl('node-lease', 'file-lease');
    const lease = fileResourceLeaseManager.acquireLease({
      nodeId: 'node-lease',
      fileId: 'file-lease',
      variant: 'original',
    }, 'upload', 'upload:node-lease');

    assert.equal(imageOriginalSourceRegistry.unregister('node-lease', 'file-lease'), false);
    imageOriginalSourceRegistry.sync([]);
    imageOriginalSourceRegistry.clear();

    assert.equal(imageOriginalSourceRegistry.getFile('node-lease', 'file-lease'), file);
    assert.deepEqual(revoked, []);

    assert.equal(fileResourceLeaseManager.releaseLease(lease.leaseId), true);
    imageOriginalSourceRegistry.clear();
    assert.equal(imageOriginalSourceRegistry.get('node-lease', 'file-lease'), null);
    assert.deepEqual(revoked, ['blob:leased']);
  } finally {
    imageOriginalSourceRegistry.clear({ force: true });
    fileResourceLeaseManager.clear();
    fileManifestStore.clear();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('imageOriginalSourceRegistry separates entries by workflow metadata and clears only matching workflow', () => {
  try {
    imageOriginalSourceRegistry.clear({ force: true });
    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', new File(['a'], 'a.png'), {
      workflowId: 'workflow-a',
    });
    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', new File(['b'], 'b.png'), {
      workflowId: 'workflow-b',
    });

    assert.equal(imageOriginalSourceRegistry.getFile('node-1', 'file-1', {
      workflowId: 'workflow-a',
    })?.name, 'a.png');
    assert.equal(imageOriginalSourceRegistry.getFile('node-1', 'file-1', {
      workflowId: 'workflow-b',
    })?.name, 'b.png');

    imageOriginalSourceRegistry.clearWorkflowUnleased('workflow-a');

    assert.equal(imageOriginalSourceRegistry.getFile('node-1', 'file-1', {
      workflowId: 'workflow-a',
    }), null);
    assert.equal(imageOriginalSourceRegistry.getFile('node-1', 'file-1', {
      workflowId: 'workflow-b',
    })?.name, 'b.png');
  } finally {
    imageOriginalSourceRegistry.clear({ force: true });
    fileManifestStore.clear();
  }
});

test('imageOriginalSourceRegistry falls back from version etag miss to latest local file in the same workflow and auth scope', () => {
  try {
    imageOriginalSourceRegistry.clear({ force: true });
    fileManifestStore.clear();
    const workflowAOld = new File(['workflow-a-old'], 'workflow-a-old.png');
    const workflowANew = new File(['workflow-a-new'], 'workflow-a-new.png');
    const workflowBFile = new File(['workflow-b'], 'workflow-b.png');

    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', workflowAOld, {
      workflowId: 'workflow-a',
      authScope: 'account-a',
      version: 1,
      etag: 'etag-old',
    });
    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', workflowBFile, {
      workflowId: 'workflow-b',
      authScope: 'account-a',
      version: 2,
      etag: 'etag-b',
    });
    imageOriginalSourceRegistry.registerLocalFile('node-1', 'file-1', workflowANew, {
      workflowId: 'workflow-a',
      authScope: 'account-a',
    });

    const exact = imageOriginalSourceRegistry.lookup('node-1', 'file-1', {
      workflowId: 'workflow-a',
      authScope: 'account-a',
      version: 1,
      etag: 'etag-old',
    });
    assert.equal(exact?.matchKind, 'exact');
    assert.equal(exact?.entry.file, workflowAOld);

    const fallback = imageOriginalSourceRegistry.lookup('node-1', 'file-1', {
      workflowId: 'workflow-a',
      authScope: 'account-a',
      version: 99,
      etag: 'missing-etag',
    });
    assert.equal(fallback?.matchKind, 'loose-scoped');
    assert.equal(fallback?.entry.file, workflowANew);

    assert.equal(imageOriginalSourceRegistry.lookup('node-1', 'file-1', {
      workflowId: 'workflow-a',
      authScope: 'account-b',
      version: 99,
      etag: 'missing-etag',
    }), null);
    assert.equal(imageOriginalSourceRegistry.lookup('node-1', 'file-1', {
      workflowId: 'workflow-c',
      authScope: 'account-a',
      version: 99,
      etag: 'missing-etag',
    }), null);
  } finally {
    imageOriginalSourceRegistry.clear({ force: true });
    fileManifestStore.clear();
  }
});

test('imageOriginalSourceRegistry forceClearForDeletedNode removes leased files for explicit node deletion', () => {
  const revoked: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (): string => 'blob:deleted';
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageOriginalSourceRegistry.clear({ force: true });
    fileResourceLeaseManager.clear();
    imageOriginalSourceRegistry.registerLocalFile('node-delete', 'file-delete', new File(['delete'], 'delete.png'));
    imageOriginalSourceRegistry.getOrCreateObjectUrl('node-delete', 'file-delete');
    fileResourceLeaseManager.acquireLease({
      nodeId: 'node-delete',
      fileId: 'file-delete',
      variant: 'original',
    }, 'viewer', 'viewer:node-delete');

    assert.equal(imageOriginalSourceRegistry.forceClearForDeletedNode('node-delete', 'file-delete'), true);
    assert.equal(imageOriginalSourceRegistry.get('node-delete', 'file-delete'), null);
    assert.deepEqual(revoked, ['blob:deleted']);
  } finally {
    imageOriginalSourceRegistry.clear({ force: true });
    fileResourceLeaseManager.clear();
    fileManifestStore.clear();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
