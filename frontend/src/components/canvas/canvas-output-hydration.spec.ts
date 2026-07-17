import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldBlockLocalCanvasSyncDuringHydration } from './canvas-sync';

test('blocks local canvas sync while external-output hydration is pending', () => {
  assert.equal(shouldBlockLocalCanvasSyncDuringHydration({
    lastAppliedHydrationVersion: 4,
    nextHydrationVersion: 5,
    hydrationReason: 'external-output',
    pendingExternalHydrationVersion: 5,
  }), true);
});

test('does not block local canvas sync after hydration has already been applied', () => {
  assert.equal(shouldBlockLocalCanvasSyncDuringHydration({
    lastAppliedHydrationVersion: 5,
    nextHydrationVersion: 5,
    hydrationReason: 'external-output',
    pendingExternalHydrationVersion: 5,
  }), false);
});

test('does not block local canvas sync for non-external hydration reasons', () => {
  assert.equal(shouldBlockLocalCanvasSyncDuringHydration({
    lastAppliedHydrationVersion: 2,
    nextHydrationVersion: 3,
    hydrationReason: 'workflow-load',
    pendingExternalHydrationVersion: 3,
  }), false);
});

test('force sync bypasses external-output hydration blocking', () => {
  assert.equal(shouldBlockLocalCanvasSyncDuringHydration({
    lastAppliedHydrationVersion: 2,
    nextHydrationVersion: 3,
    hydrationReason: 'external-output',
    pendingExternalHydrationVersion: 3,
    force: true,
  }), false);
});

test('external-output hydration stays blocked until the same version is applied', () => {
  assert.equal(shouldBlockLocalCanvasSyncDuringHydration({
    lastAppliedHydrationVersion: 6,
    nextHydrationVersion: 8,
    hydrationReason: 'external-output',
    pendingExternalHydrationVersion: 7,
  }), false);
});
