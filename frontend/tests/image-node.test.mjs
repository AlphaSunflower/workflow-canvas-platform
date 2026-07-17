import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyImportedImageAssets,
  buildImportedImageAssets,
  buildRemoteImageAsset,
  clearAllImageResources,
  createLocalImageNodeDraft,
  getRenderableImageUrls,
  hasRenderableImagePreview,
} from '../dist-tests/src/services/image/image-node.js';
import { imageImportPreviewService } from '../dist-tests/src/services/image/image-import-preview.service.js';
import {
  createImageAssetVariant,
  createLocalImageAsset,
} from '../dist-tests/src/services/image/image-asset.js';
import { imageOriginalSourceRegistry } from '../dist-tests/src/services/image/image-original-source-registry.js';
import { imageThumbnailRuntimeStore } from '../dist-tests/src/services/image/image-thumbnail-runtime-store.js';

function createFileNode(overrides = {}) {
  return {
    id: {
      value: 'node-1',
      display: '#00001',
    },
    type: 'image',
    position: {
      x: 0,
      y: 0,
    },
    dimensions: {
      width: 240,
      height: 160,
    },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: 1,
      updated: 1,
    },
    fileId: 'file-1',
    fileName: 'demo.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: 1,
    },
    metadata: {
      width: 4000,
      height: 3000,
    },
    ...overrides,
  };
}

test.afterEach(() => {
  clearAllImageResources();
});

test('buildRemoteImageAsset creates thumbnail and original variants only for remote images', () => {
  const result = buildRemoteImageAsset('remote-file-1', {
    width: 3200,
    height: 2000,
  });

  assert.equal(result.thumbnailUrl, '/api/v1/files/remote-file-1/thumbnail');
  assert.equal('previewUrl' in result, false);
  assert.equal(result.imageAsset.source, 'remote');
  assert.equal(result.imageAsset.assetId, 'remote-file-1');
  assert.deepEqual(Object.keys(result.imageAsset.variants).sort(), ['original', 'thumbnail']);
  assert.equal(result.imageAsset.variants.thumbnail?.url, '/api/v1/files/remote-file-1/thumbnail');
  assert.equal(result.imageAsset.variants.original?.url, '/api/v1/files/remote-file-1/download');
});

test('createLocalImageNodeDraft registers original source runtime without object urls in node data', () => {
  const fileNode = createFileNode({
    thumbnailUrl: undefined,
    previewUrl: undefined,
    imageAsset: undefined,
  });
  const file = new File(['image'], 'demo.png', { type: 'image/png' });

  const draft = createLocalImageNodeDraft(fileNode.id.value, file, fileNode, {
    sessionId: 'session-1',
    fileId: fileNode.fileId,
  });

  assert.equal(draft.imageAsset?.variants.thumbnail?.url, undefined);
  assert.equal(draft.imageAsset?.variants.original?.url, undefined);
  assert.equal(imageOriginalSourceRegistry.getFile(fileNode.id.value, fileNode.fileId), file);
  assert.equal(imageThumbnailRuntimeStore.get(fileNode.id.value)?.status, 'loading');
  assert.equal('thumbnailUrl' in draft, false);
  assert.equal('previewUrl' in draft, false);
});

test('buildImportedImageAssets stays pure while preview owner writes ready thumbnail runtime state', () => {
  const fileNode = createFileNode();
  const thumbnailBlob = new Blob(['thumb'], { type: 'image/jpeg' });
  const imported = buildImportedImageAssets(fileNode.id.value, {
    kind: 'image',
    metadata: {
      width: 1600,
      height: 900,
    },
    thumbnailBlob,
    thumbnailUrl: 'blob:thumb-only',
    thumbnailMimeType: 'image/jpeg',
    processingMode: 'worker',
  }, {
    width: 1600,
    height: 900,
  }, {
    fileId: fileNode.fileId,
  });
  imageImportPreviewService.resolve(fileNode.id.value, {
    sessionId: 'session-2',
    fileId: fileNode.fileId,
    blob: thumbnailBlob,
    objectUrl: 'blob:thumb-only',
    width: imported.metadata?.width,
    height: imported.metadata?.height,
    mimeType: 'image/jpeg',
  });
  const applied = applyImportedImageAssets(fileNode, 'image', imported);

  assert.equal(imported.thumbnailReady, true);
  assert.equal(imported.thumbnailUnavailable, false);
  assert.equal(imported.needsNodePatch, false);
  assert.equal(applied.thumbnailUrl, undefined);
  assert.equal(applied.previewUrl, undefined);
  assert.equal(imageThumbnailRuntimeStore.get(fileNode.id.value)?.objectUrl, 'blob:thumb-only');
  assert.equal(imageThumbnailRuntimeStore.get(fileNode.id.value)?.status, 'ready');
});

test('missing image preprocess result stays pure while preview owner marks thumbnail unavailable', () => {
  const fileNode = createFileNode({
    thumbnailUrl: undefined,
    previewUrl: undefined,
  });
  const imported = buildImportedImageAssets('node-failure', undefined, {
    width: 640,
    height: 360,
  }, {
    fileId: 'file-failure',
  });
  imageImportPreviewService.fail('node-failure', {
    sessionId: 'session-failure',
    fileId: 'file-failure',
    error: 'thumbnail-unavailable',
  });
  const applied = applyImportedImageAssets(fileNode, 'image', imported);

  assert.equal(imported.thumbnailReady, false);
  assert.equal(imported.thumbnailUnavailable, true);
  assert.equal(imported.needsNodePatch, false);
  assert.equal(applied.status, 'idle');
  assert.equal(applied.thumbnailUrl, undefined);
  assert.equal(applied.previewUrl, undefined);
  assert.equal(imageThumbnailRuntimeStore.get('node-failure')?.status, 'error');
  assert.equal(imageThumbnailRuntimeStore.get('node-failure')?.error, 'thumbnail-unavailable');
});

test('non-image imports still patch thumbnail urls while keeping video preview semantics', () => {
  const fileNode = createFileNode({
    type: 'video',
    mimeType: 'video/mp4',
    previewUrl: 'blob:video-preview',
    thumbnailUrl: 'blob:video-thumb',
    metadata: {
      width: 1280,
      height: 720,
      duration: 8.25,
    },
  });

  const nextNode = applyImportedImageAssets(fileNode, 'video', {
    metadata: {
      width: 1920,
      height: 1080,
      duration: 12.5,
    },
    thumbnailUrl: 'blob:video-thumb-next',
  });

  assert.equal(nextNode.previewUrl, 'blob:video-preview');
  assert.equal(nextNode.thumbnailUrl, 'blob:video-thumb-next');
  assert.deepEqual(nextNode.metadata, fileNode.metadata);
});

test('renderable image preview availability uses thumbnail for images and preview-or-thumbnail for non-images', () => {
  const imageNode = createFileNode({
    imageAsset: createLocalImageAsset('file-1', {
      width: 4096,
      height: 3072,
    }, {
      thumbnail: createImageAssetVariant('blob:image-thumb', {
        width: 512,
        height: 384,
      }),
    }),
    thumbnailUrl: 'blob:image-thumb',
    previewUrl: undefined,
  });
  const imageOriginalOnlyNode = createFileNode({
    imageAsset: createLocalImageAsset('file-2', {
      width: 4096,
      height: 3072,
    }, {
      original: createImageAssetVariant('blob:image-original', {
        width: 4096,
        height: 3072,
      }),
    }),
    thumbnailUrl: undefined,
    previewUrl: undefined,
  });
  const videoNode = createFileNode({
    type: 'video',
    mimeType: 'video/mp4',
    previewUrl: 'blob:video-preview',
    thumbnailUrl: undefined,
  });

  assert.equal(getRenderableImageUrls(imageNode).thumbnailUrl, 'blob:image-thumb');
  assert.equal(hasRenderableImagePreview(imageNode), true);
  assert.equal(hasRenderableImagePreview(imageOriginalOnlyNode), false);
  assert.equal(hasRenderableImagePreview(videoNode), true);
});
