import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createImageAssetVariant,
  createLocalImageAsset,
  getFileNodeImageCanvasVariant,
  getFileNodeImageOriginalUrl,
  getFileNodeImageThumbnailUrl,
  getFileNodeImageViewerUrl,
  getImageVariantUrls,
  resolveFileNodeImageAsset,
  selectCanvasImageVariant,
  selectViewerImageVariant,
} from '../dist-tests/src/services/image/image-asset.js';

test('resolveFileNodeImageAsset keeps image resources on thumbnail and original only', () => {
  const imageAsset = createLocalImageAsset('file-local-1', {
    width: 4096,
    height: 3072,
  }, {
    thumbnail: createImageAssetVariant('blob:thumb-local-1', {
      width: 512,
      height: 384,
      mimeType: 'image/jpeg',
      updatedAt: 1,
    }),
    original: createImageAssetVariant('blob:original-local-1', {
      width: 4096,
      height: 3072,
      mimeType: 'image/png',
      updatedAt: 2,
    }),
  });

  const node = {
    fileId: 'file-local-1',
    imageAsset,
    thumbnailUrl: 'legacy-thumb-should-not-win',
    metadata: {
      width: 4096,
      height: 3072,
    },
  };

  const resolved = resolveFileNodeImageAsset(node);

  assert.deepEqual(Object.keys(resolved.asset.variants).sort(), ['original', 'thumbnail']);
  assert.equal(resolved.thumbnail?.url, 'blob:thumb-local-1');
  assert.equal(resolved.original?.url, 'blob:original-local-1');
  assert.equal(getFileNodeImageThumbnailUrl(node), 'blob:thumb-local-1');
  assert.equal(getFileNodeImageOriginalUrl(node), 'blob:original-local-1');
  assert.equal(getFileNodeImageViewerUrl(node), 'blob:original-local-1');
});

test('viewer selection requires original and does not fall back to thumbnail-only assets', () => {
  const node = {
    fileId: 'file-local-2',
    imageAsset: createLocalImageAsset('file-local-2', {
      width: 2048,
      height: 2048,
    }, {
      thumbnail: createImageAssetVariant('blob:thumb-only', {
        width: 512,
        height: 512,
        mimeType: 'image/jpeg',
      }),
    }),
    thumbnailUrl: 'blob:thumb-only',
    metadata: {
      width: 2048,
      height: 2048,
    },
  };

  const resolved = resolveFileNodeImageAsset(node);
  const selection = selectViewerImageVariant(resolved);

  assert.equal(selection.requestedKind, 'original');
  assert.equal(selection.variant, undefined);
  assert.equal(selection.requested, undefined);
  assert.equal(getFileNodeImageViewerUrl(node), undefined);
});

test('canvas selection always stays on thumbnail regardless of display size', () => {
  const node = {
    fileId: 'file-local-3',
    imageAsset: createLocalImageAsset('file-local-3', {
      width: 3200,
      height: 2000,
    }, {
      thumbnail: createImageAssetVariant('blob:thumb-large', {
        width: 512,
        height: 320,
        updatedAt: 1,
      }),
      original: createImageAssetVariant('blob:original-large', {
        width: 3200,
        height: 2000,
        updatedAt: 2,
      }),
    }),
    metadata: {
      width: 3200,
      height: 2000,
    },
  };

  const resolved = resolveFileNodeImageAsset(node);
  const largeSelection = selectCanvasImageVariant(resolved, {
    width: 2200,
    height: 1400,
  });
  const canvasVariant = getFileNodeImageCanvasVariant(node, {
    width: 2200,
    height: 1400,
  });

  assert.equal(largeSelection.preferred?.kind, 'thumbnail');
  assert.equal(canvasVariant?.kind, 'thumbnail');
  assert.deepEqual(getImageVariantUrls(resolved, 'canvas'), ['blob:thumb-large']);
  assert.deepEqual(getImageVariantUrls(resolved, 'original'), ['blob:original-large']);
});
