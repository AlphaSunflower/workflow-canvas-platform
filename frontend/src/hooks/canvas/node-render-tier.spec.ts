import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveNodeRenderTier,
  shouldNodeRenderTierUpdate,
} from './node-render-tier';

test('resolveNodeRenderTier maps far bucket to compact tier', () => {
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'far',
  }), 'compact');
});

test('resolveNodeRenderTier maps offscreen bucket to minimal tier', () => {
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'offscreen',
  }), 'minimal');
});

test('resolveNodeRenderTier keeps selected non-image and recently interacted nodes at full tier', () => {
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'offscreen',
    isSelected: true,
    isImage: false,
  }), 'full');
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'far',
    isRecentlyInteracted: true,
  }), 'full');
});

test('resolveNodeRenderTier keeps selected image nodes on the lightweight image path', () => {
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'visible',
    isSelected: true,
    isImage: true,
    totalImageCount: 1,
  }), 'full');
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'visible',
    isSelected: true,
    isImage: true,
    totalImageCount: 232,
  }), 'compact');
});

test('resolveNodeRenderTier applies import performance policy before viewport tier promotion', () => {
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'visible',
    isImporting: true,
  }), 'compact');
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'near',
    isImporting: true,
  }), 'minimal');
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'far',
    isImporting: true,
  }), 'minimal');
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'offscreen',
    isImporting: true,
  }), 'minimal');
});

test('resolveNodeRenderTier keeps interacted importing nodes at full tier', () => {
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'visible',
    isImporting: true,
    isSelected: true,
    isImage: false,
  }), 'full');
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'offscreen',
    isImporting: true,
    isRecentlyInteracted: true,
  }), 'full');
});

test('resolveNodeRenderTier uses raster-first tier for large image canvases', () => {
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'visible',
    isImage: true,
    viewportZoom: 0.7,
    visibleImageCount: 232,
    totalImageCount: 232,
  }), 'compact');
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'near',
    isImage: true,
    viewportZoom: 1,
    visibleImageCount: 232,
    totalImageCount: 232,
  }), 'minimal');
});

test('resolveNodeRenderTier keeps selected images lightweight in raster-first conditions', () => {
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'visible',
    isImage: true,
    viewportZoom: 0.05,
    visibleImageCount: 232,
    totalImageCount: 232,
    isSelected: true,
  }), 'compact');
});

test('resolveNodeRenderTier does not apply raster-first policy to non-image nodes', () => {
  assert.equal(resolveNodeRenderTier({
    visibilityBucket: 'visible',
    isImage: false,
    viewportZoom: 0.05,
    visibleImageCount: 232,
    totalImageCount: 232,
  }), 'full');
});

test('shouldNodeRenderTierUpdate only emits on tier change', () => {
  assert.equal(shouldNodeRenderTierUpdate('compact', 'compact'), false);
  assert.equal(shouldNodeRenderTierUpdate('compact', 'minimal'), true);
  assert.equal(shouldNodeRenderTierUpdate(undefined, 'full'), true);
});
