import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveVisibilityBucketState, shouldEmitVisibilityDiff } from './visibility-buckets';

test('deriveVisibilityBucketState keeps small score drift inside the same buckets', () => {
  const previous = deriveVisibilityBucketState({
    isVisible: true,
    isNearViewport: true,
    visibleAreaRatio: 0.31,
    visibilityScore: 0.66,
    centerDistance: 120,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 188,
    displayHeight: 164,
  });
  const next = deriveVisibilityBucketState({
    isVisible: true,
    isNearViewport: true,
    visibleAreaRatio: 0.33,
    visibilityScore: 0.68,
    centerDistance: 126,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 191,
    displayHeight: 167,
  });

  assert.equal(shouldEmitVisibilityDiff(previous, next), false);
});

test('deriveVisibilityBucketState emits when visibility crosses key viewport buckets', () => {
  const previous = deriveVisibilityBucketState({
    isVisible: false,
    isNearViewport: true,
    visibleAreaRatio: 0.03,
    visibilityScore: 0.17,
    centerDistance: 920,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 180,
    displayHeight: 140,
  });
  const next = deriveVisibilityBucketState({
    isVisible: true,
    isNearViewport: true,
    visibleAreaRatio: 0.22,
    visibilityScore: 0.57,
    centerDistance: 120,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 180,
    displayHeight: 140,
  });

  assert.equal(previous.visibilityBucket, 'near');
  assert.equal(next.visibilityBucket, 'visible');
  assert.equal(shouldEmitVisibilityDiff(previous, next), true);
});

test('deriveVisibilityBucketState preserves importing priority semantics', () => {
  const importing = deriveVisibilityBucketState({
    isVisible: false,
    isNearViewport: true,
    visibleAreaRatio: 0.03,
    visibilityScore: 0.08,
    centerDistance: 600,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: true,
    displayWidth: 220,
    displayHeight: 180,
  });
  const normal = deriveVisibilityBucketState({
    isVisible: false,
    isNearViewport: true,
    visibleAreaRatio: 0.03,
    visibilityScore: 0.08,
    centerDistance: 600,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 220,
    displayHeight: 180,
  });

  assert.equal(importing.visibilityScoreBucket, 'import-priority');
  assert.equal(normal.visibilityScoreBucket, 'cancel');
  assert.equal(shouldEmitVisibilityDiff(normal, importing), true);
});

test('deriveVisibilityBucketState emits when display size crosses a bucket threshold', () => {
  const previous = deriveVisibilityBucketState({
    isVisible: true,
    isNearViewport: true,
    visibleAreaRatio: 0.5,
    visibilityScore: 0.75,
    centerDistance: 100,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 180,
    displayHeight: 180,
  });
  const next = deriveVisibilityBucketState({
    isVisible: true,
    isNearViewport: true,
    visibleAreaRatio: 0.5,
    visibilityScore: 0.75,
    centerDistance: 100,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 310,
    displayHeight: 180,
  });

  assert.equal(shouldEmitVisibilityDiff(previous, next), true);
});

test('deriveVisibilityBucketState suppresses small zoom display bucket churn', () => {
  const previous = deriveVisibilityBucketState({
    isVisible: true,
    isNearViewport: true,
    visibleAreaRatio: 0.5,
    visibilityScore: 0.75,
    centerDistance: 100,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 210,
    displayHeight: 160,
  });
  const next = deriveVisibilityBucketState({
    isVisible: true,
    isNearViewport: true,
    visibleAreaRatio: 0.5,
    visibilityScore: 0.75,
    centerDistance: 100,
    viewportSpan: 1280,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    displayWidth: 255,
    displayHeight: 184,
  });

  assert.equal(shouldEmitVisibilityDiff(previous, next), false);
});
