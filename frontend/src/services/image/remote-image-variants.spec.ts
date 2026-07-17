import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRemoteImageAsset } from './image-node';
import {
  getImageVariantUrls,
  selectCanvasImageVariant,
  selectViewerImageVariant,
} from './image-asset';

test('remote image asset preserves only thumbnail and original variants', () => {
  const remoteImage = buildRemoteImageAsset('remote-file-1', {
    width: 3200,
    height: 2000,
  }, {
    thumbnailUrl: '/api/v1/files/remote-file-1/thumbnail',
    originalUrl: '/api/v1/files/remote-file-1/download',
    thumbnailSize: {
      width: 320,
      height: 200,
    },
  });

  assert.equal(remoteImage.thumbnailUrl, '/api/v1/files/remote-file-1/thumbnail');
  assert.equal(remoteImage.imageAsset.variants.thumbnail?.width, 320);
  assert.equal(remoteImage.imageAsset.variants.original?.width, 3200);
  assert.deepEqual(Object.keys(remoteImage.imageAsset.variants).sort(), ['original', 'thumbnail']);
});

test('canvas selection always returns thumbnail while viewer selection returns original', () => {
  const remoteImage = buildRemoteImageAsset('remote-file-2', {
    width: 3200,
    height: 2000,
  });
  const resolved = {
    asset: remoteImage.imageAsset,
    thumbnail: {
      kind: 'thumbnail' as const,
      url: remoteImage.thumbnailUrl,
      fromLegacy: false,
      asset: remoteImage.imageAsset.variants.thumbnail,
    },
    original: {
      kind: 'original' as const,
      url: remoteImage.imageAsset.variants.original?.url ?? '',
      fromLegacy: false,
      asset: remoteImage.imageAsset.variants.original,
    },
    preferred: {
      kind: 'thumbnail' as const,
      url: remoteImage.thumbnailUrl,
      fromLegacy: false,
      asset: remoteImage.imageAsset.variants.thumbnail,
    },
  };

  assert.equal(selectCanvasImageVariant(resolved, { width: 1200, height: 900 }).preferred?.kind, 'thumbnail');
  assert.equal(selectViewerImageVariant(resolved).requestedKind, 'original');
  assert.deepEqual(getImageVariantUrls(resolved, 'canvas'), [remoteImage.thumbnailUrl]);
  assert.deepEqual(getImageVariantUrls(resolved, 'original'), [remoteImage.imageAsset.variants.original?.url]);
});
