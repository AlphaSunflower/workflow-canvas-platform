import test from 'node:test';
import assert from 'node:assert/strict';

import { imageThumbnailRuntimeStore } from './image-thumbnail-runtime-store';

test('imageThumbnailRuntimeStore stores ready thumbnail object URLs and notifies subscribers', () => {
  const revoked: string[] = [];
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageThumbnailRuntimeStore.clearAll();
    let notifications = 0;
    const unsubscribe = imageThumbnailRuntimeStore.subscribe('node-thumb-1', () => {
      notifications += 1;
    });

    const entry = imageThumbnailRuntimeStore.upsert('node-thumb-1', {
      sessionId: 'session-1',
      objectUrl: 'blob:thumb-1',
      blob: new Blob(['thumb'], { type: 'image/jpeg' }),
      width: 320,
      height: 200,
      mimeType: 'image/jpeg',
      status: 'ready',
    });

    assert.equal(entry.status, 'ready');
    assert.equal(imageThumbnailRuntimeStore.getUrl('node-thumb-1'), 'blob:thumb-1');
    assert.equal(notifications, 1);

    imageThumbnailRuntimeStore.upsert('node-thumb-1', {
      objectUrl: 'blob:thumb-2',
      status: 'ready',
    });

    assert.deepEqual(revoked, ['blob:thumb-1']);
    assert.equal(imageThumbnailRuntimeStore.getUrl('node-thumb-1'), 'blob:thumb-2');
    assert.equal(notifications, 2);

    unsubscribe();
    imageThumbnailRuntimeStore.clearNode('node-thumb-1');

    assert.deepEqual(revoked, ['blob:thumb-1', 'blob:thumb-2']);
    assert.equal(imageThumbnailRuntimeStore.get('node-thumb-1'), null);
    assert.equal(notifications, 2);
  } finally {
    imageThumbnailRuntimeStore.clearAll();
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('imageThumbnailRuntimeStore supports one batched global subscription for runtime consumers', () => {
  imageThumbnailRuntimeStore.clearAll();
  const notifiedNodeIds: string[] = [];
  const unsubscribe = imageThumbnailRuntimeStore.subscribeAll((nodeId) => {
    notifiedNodeIds.push(nodeId);
  });

  imageThumbnailRuntimeStore.upsert('node-global-a', {
    status: 'loading',
  });
  imageThumbnailRuntimeStore.upsert('node-global-b', {
    objectUrl: 'blob:global-b',
    status: 'ready',
  });

  unsubscribe();
  imageThumbnailRuntimeStore.clearNode('node-global-a');

  assert.deepEqual(notifiedNodeIds, ['node-global-a', 'node-global-b']);
  imageThumbnailRuntimeStore.clearAll();
});

test('imageThumbnailRuntimeStore clears all thumbnails owned by a session', () => {
  const revoked: string[] = [];
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageThumbnailRuntimeStore.clearAll();
    imageThumbnailRuntimeStore.upsert('node-a', {
      sessionId: 'session-a',
      objectUrl: 'blob:a',
      status: 'ready',
    });
    imageThumbnailRuntimeStore.upsert('node-b', {
      sessionId: 'session-a',
      objectUrl: 'blob:b',
      status: 'ready',
    });
    imageThumbnailRuntimeStore.upsert('node-c', {
      sessionId: 'session-b',
      objectUrl: 'blob:c',
      status: 'ready',
    });

    imageThumbnailRuntimeStore.clearSession('session-a');

    assert.equal(imageThumbnailRuntimeStore.get('node-a'), null);
    assert.equal(imageThumbnailRuntimeStore.get('node-b'), null);
    assert.equal(imageThumbnailRuntimeStore.getUrl('node-c'), 'blob:c');
    assert.deepEqual(revoked.sort(), ['blob:a', 'blob:b']);
  } finally {
    imageThumbnailRuntimeStore.clearAll();
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('imageThumbnailRuntimeStore keeps latest session binding when a node is rebound to a new session', () => {
  imageThumbnailRuntimeStore.clearAll();

  imageThumbnailRuntimeStore.upsert('node-rebound', {
    sessionId: 'session-old',
    status: 'loading',
  });
  imageThumbnailRuntimeStore.upsert('node-rebound', {
    sessionId: 'session-new',
    objectUrl: 'blob:session-new',
    status: 'ready',
  });

  const entry = imageThumbnailRuntimeStore.get('node-rebound');

  assert.equal(entry?.sessionId, 'session-new');
  assert.equal(entry?.status, 'ready');
  assert.equal(entry?.objectUrl, 'blob:session-new');

  imageThumbnailRuntimeStore.clearAll();
});

test('imageThumbnailRuntimeStore clearing an old session does not remove a node rebound to a newer session', () => {
  const revoked: string[] = [];
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageThumbnailRuntimeStore.clearAll();
    imageThumbnailRuntimeStore.upsert('node-stale-session', {
      sessionId: 'session-old',
      status: 'loading',
    });
    imageThumbnailRuntimeStore.upsert('node-stale-session', {
      sessionId: 'session-new',
      objectUrl: 'blob:session-new',
      status: 'ready',
    });

    imageThumbnailRuntimeStore.clearSession('session-old');

    assert.equal(imageThumbnailRuntimeStore.get('node-stale-session')?.sessionId, 'session-new');
    assert.equal(imageThumbnailRuntimeStore.getUrl('node-stale-session'), 'blob:session-new');
    assert.deepEqual(revoked, []);
  } finally {
    imageThumbnailRuntimeStore.clearAll();
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('imageThumbnailRuntimeStore clearing a current session removes loading entries that never resolved', () => {
  imageThumbnailRuntimeStore.clearAll();
  imageThumbnailRuntimeStore.upsert('node-pending-clear', {
    sessionId: 'session-pending-clear',
    status: 'loading',
  });

  imageThumbnailRuntimeStore.clearSession('session-pending-clear');

  assert.equal(imageThumbnailRuntimeStore.get('node-pending-clear'), null);
  imageThumbnailRuntimeStore.clearAll();
});

test('imageThumbnailRuntimeStore clearing a failed session removes error entries that would otherwise keep preview fallback state hanging', () => {
  imageThumbnailRuntimeStore.clearAll();
  imageThumbnailRuntimeStore.upsert('node-error-clear', {
    sessionId: 'session-error-clear',
    status: 'error',
    error: 'thumbnail-unavailable',
  });

  imageThumbnailRuntimeStore.clearSession('session-error-clear');

  assert.equal(imageThumbnailRuntimeStore.get('node-error-clear'), null);
  imageThumbnailRuntimeStore.clearAll();
});

test('imageThumbnailRuntimeStore preserves structured failure diagnostics for error entries', () => {
  imageThumbnailRuntimeStore.clearAll();

  imageThumbnailRuntimeStore.upsert('node-error-diagnostics', {
    sessionId: 'session-error-diagnostics',
    status: 'error',
    error: 'thumbnail-unavailable',
    failureCode: 'worker-timeout',
    failureMessage: 'Image thumbnail worker timed out',
    retryable: true,
    attemptCount: 1,
    lastFailureCode: 'worker-timeout',
    failureDetail: {
      failureCode: 'worker-timeout',
      failureStage: 'worker-execute',
      retryable: true,
      message: 'Image thumbnail worker timed out',
      durationMs: 15_000,
      environment: {
        hasWorker: true,
        hasCreateImageBitmap: true,
        hasOffscreenCanvas: true,
      },
    },
  });

  const entry = imageThumbnailRuntimeStore.get('node-error-diagnostics');
  assert.equal(entry?.status, 'error');
  assert.equal(entry?.error, 'thumbnail-unavailable');
  assert.equal(entry?.failureCode, 'worker-timeout');
  assert.equal(entry?.failureMessage, 'Image thumbnail worker timed out');
  assert.equal(entry?.retryable, true);
  assert.equal(entry?.attemptCount, 1);
  assert.equal(entry?.lastFailureCode, 'worker-timeout');
  assert.equal(entry?.failureDetail?.failureStage, 'worker-execute');

  imageThumbnailRuntimeStore.clearAll();
});

test('imageThumbnailRuntimeStore does not revoke external object URLs it does not own', () => {
  const revoked: string[] = [];
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };

  try {
    imageThumbnailRuntimeStore.clearAll();
    imageThumbnailRuntimeStore.upsert('node-external-url', {
      sessionId: 'session-external-url',
      objectUrl: 'blob:external-preview',
      objectUrlOwner: 'external',
      status: 'ready',
    });

    imageThumbnailRuntimeStore.clearNode('node-external-url');

    assert.equal(imageThumbnailRuntimeStore.get('node-external-url'), null);
    assert.deepEqual(revoked, []);
  } finally {
    imageThumbnailRuntimeStore.clearAll();
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
