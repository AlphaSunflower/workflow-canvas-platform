import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_IMAGE_CACHE_POLICY } from './image-cache';
import {
  resolveImageCacheBudget,
  resolveImageCacheBudgetDeviceTier,
  resolveImageCacheBudgetScene,
} from './image-cache-budget';

test('resolveImageCacheBudgetDeviceTier classifies constrained devices conservatively', () => {
  assert.equal(resolveImageCacheBudgetDeviceTier({
    deviceMemoryGb: 4,
    hardwareConcurrency: 4,
    jsHeapSizeLimit: 1024 * 1024 * 1024,
  }), 'low');
});

test('resolveImageCacheBudgetScene exposes import-dragging as the strongest load-shedding scene', () => {
  assert.equal(resolveImageCacheBudgetScene({
    imageNodeCount: 120,
    importingNodeCount: 40,
    isDragging: true,
    isImporting: true,
    isIdle: true,
  }), 'import-dragging');
});

test('resolveImageCacheBudget compresses thumbnail/original budgets under import dragging pressure', () => {
  const result = resolveImageCacheBudget({
    imageNodeCount: 240,
    importingNodeCount: 16,
    isDragging: true,
    isImporting: true,
    device: {
      deviceMemoryGb: 4,
      hardwareConcurrency: 4,
      jsHeapSizeLimit: 1200 * 1024 * 1024,
    },
  });

  assert.equal(result.profile.scene, 'import-dragging');
  assert.equal(result.profile.tier, 'low');
  assert.equal(result.profile.density, 'large');
  assert.equal(result.policy.maxThumbnailEntries < DEFAULT_IMAGE_CACHE_POLICY.maxThumbnailEntries, true);
  assert.equal(result.policy.maxOriginalEntries < DEFAULT_IMAGE_CACHE_POLICY.maxOriginalEntries, true);
  assert.equal(result.policy.maxThumbnailBytes < DEFAULT_IMAGE_CACHE_POLICY.maxThumbnailBytes, true);
  assert.equal(result.policy.maxOriginalBytes < DEFAULT_IMAGE_CACHE_POLICY.maxOriginalBytes, true);
});

test('resolveImageCacheBudget allows warmer thumbnail cache during idle without exceeding base policy', () => {
  const result = resolveImageCacheBudget({
    imageNodeCount: 24,
    isIdle: true,
    device: {
      deviceMemoryGb: 16,
      hardwareConcurrency: 16,
      jsHeapSizeLimit: 4 * 1024 * 1024 * 1024,
    },
  });

  assert.equal(result.profile.scene, 'idle');
  assert.equal(result.profile.tier, 'high');
  assert.equal(result.policy.maxThumbnailEntries <= DEFAULT_IMAGE_CACHE_POLICY.maxThumbnailEntries, true);
  assert.equal(result.policy.maxThumbnailEntries >= 24, true);
  assert.equal(result.policy.maxCanvasBytes <= DEFAULT_IMAGE_CACHE_POLICY.maxCanvasBytes, true);
});

test('resolveImageCacheBudget respects heap caps for thumbnail, canvas and original pools', () => {
  const result = resolveImageCacheBudget({
    imageNodeCount: 80,
    isImporting: true,
    device: {
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
      jsHeapSizeLimit: 512 * 1024 * 1024,
    },
  });

  assert.equal(result.policy.maxThumbnailBytes <= Math.round(512 * 1024 * 1024 * 0.32 * 0.42), true);
  assert.equal(result.policy.maxCanvasBytes <= Math.round(512 * 1024 * 1024 * 0.32 * 0.5), true);
  assert.equal(result.policy.maxOriginalBytes <= Math.round(512 * 1024 * 1024 * 0.32 * 0.22), true);
});

test('resolveImageCacheBudget keeps near-viewport protection window above invisible release threshold', () => {
  const result = resolveImageCacheBudget({
    imageNodeCount: 220,
    importingNodeCount: 12,
    isDragging: true,
    isImporting: true,
    device: {
      deviceMemoryGb: 4,
      hardwareConcurrency: 4,
      jsHeapSizeLimit: 1024 * 1024 * 1024,
    },
  });

  assert.equal(result.policy.nearViewportReleaseAfterMs >= result.policy.invisibleReleaseAfterMs, true);
  assert.equal(result.policy.nearViewportReleaseAfterMs > DEFAULT_IMAGE_CACHE_POLICY.invisibleReleaseAfterMs, true);
});

test('resolveImageCacheBudget keeps recently loaded canvas thumbnails protected during import and drag', () => {
  const importing = resolveImageCacheBudget({
    imageNodeCount: 160,
    importingNodeCount: 24,
    isImporting: true,
    device: {
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
    },
  });
  const dragging = resolveImageCacheBudget({
    imageNodeCount: 160,
    isDragging: true,
    device: {
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
    },
  });
  const importDragging = resolveImageCacheBudget({
    imageNodeCount: 220,
    importingNodeCount: 24,
    isImporting: true,
    isDragging: true,
    device: {
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
    },
  });

  assert.equal(importing.policy.recentlyLoadedCanvasProtectionMs >= DEFAULT_IMAGE_CACHE_POLICY.recentlyLoadedCanvasProtectionMs, true);
  assert.equal(dragging.policy.recentlyLoadedCanvasProtectionMs >= DEFAULT_IMAGE_CACHE_POLICY.recentlyLoadedCanvasProtectionMs, true);
  assert.equal(importDragging.policy.recentlyLoadedCanvasProtectionMs >= DEFAULT_IMAGE_CACHE_POLICY.recentlyLoadedCanvasProtectionMs, true);
});
