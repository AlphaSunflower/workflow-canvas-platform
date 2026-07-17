import test from 'node:test';
import assert from 'node:assert/strict';

import {
  areInpaintSourceLoadSignaturesEqual,
  resolveInpaintSourceLoadTransition,
  areInpaintMaskSourceDimensionsMatched,
  createInpaintMaskSourceSignature,
  getInpaintCoalescedPointerCoordinates,
  getInpaintBrushImagePixelSize,
  isInpaintCanvasPointInsideDrawRect,
  resolveInpaintCanvasElementLayoutSize,
  resolveInpaintCanvasLocalPoint,
  resolveInpaintCanvasViewport,
  resolveInpaintAspectFitSize,
  resolveInpaintBrushPreviewPoint,
  resolveInpaintImageDrawRect,
  resolveInpaintImagePointerPoint,
  resolveInpaintSourceImageLoadUrl,
  shouldResolveInpaintSourceResource,
  shouldDeferInpaintMaskSnapshotCommit,
} from './InpaintCanvasEditor';
import type { FileNodeData } from '@/types';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import {
  FileResourceService,
  fileManifestStore,
  fileResourceLeaseManager,
} from '@/services/file-resource';

function createImageNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: { value: 'node-image-1', display: '#00001' },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 120 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: { created: now, updated: now },
    fileId: 'file-image-1',
    fileName: 'image.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 1024,
      height: 768,
    },
    imageAsset: {
      assetId: 'file-image-1',
      source: 'remote',
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-image-1/thumbnail',
          width: 320,
          height: 240,
        },
        original: {
          url: '/api/v1/files/file-image-1/download',
          width: 1024,
          height: 768,
        },
      },
      intrinsicSize: {
        width: 1024,
        height: 768,
      },
      version: 1,
    },
    thumbnailUrl: '/api/v1/files/file-image-1/thumbnail',
    ...overrides,
  };
}

test('areInpaintMaskSourceDimensionsMatched keeps masks for the same source file and size', () => {
  assert.equal(areInpaintMaskSourceDimensionsMatched({
    sourceFileId: 'source-file-1',
    width: 1024,
    height: 768,
    maskSourceFileId: 'source-file-1',
    maskSourceWidth: 1024,
    maskSourceHeight: 768,
  }), true);
});

test('areInpaintMaskSourceDimensionsMatched clears masks when source file or dimensions change', () => {
  assert.equal(areInpaintMaskSourceDimensionsMatched({
    sourceFileId: 'source-file-1',
    width: 1024,
    height: 768,
    maskSourceFileId: 'source-file-2',
    maskSourceWidth: 1024,
    maskSourceHeight: 768,
  }), false);

  assert.equal(areInpaintMaskSourceDimensionsMatched({
    sourceFileId: 'source-file-1',
    width: 1024,
    height: 768,
    maskSourceFileId: 'source-file-1',
    maskSourceWidth: 2048,
    maskSourceHeight: 768,
  }), false);
});

test('createInpaintMaskSourceSignature changes when source identity or dimensions change', () => {
  assert.equal(createInpaintMaskSourceSignature(null), 'no-source');
  assert.equal(
    createInpaintMaskSourceSignature({ fileId: 'file-1', width: 1024, height: 768 }),
    'file-1:1024:768',
  );
  assert.ok(
    createInpaintMaskSourceSignature({ fileId: 'file-1', width: 1024, height: 768 })
      !== createInpaintMaskSourceSignature({ fileId: 'file-2', width: 1024, height: 768 }),
  );
  assert.ok(
    createInpaintMaskSourceSignature({ fileId: 'file-1', width: 1024, height: 768 })
      !== createInpaintMaskSourceSignature({ fileId: 'file-1', width: 2048, height: 768 }),
  );
});

test('areInpaintSourceLoadSignaturesEqual keeps the same source image load stable across rerenders', () => {
  const signature = {
    sourceNodeId: 'node-1',
    sourceFileId: 'file-1',
    sourceLoadUrl: 'blob:original-1',
  };

  assert.equal(areInpaintSourceLoadSignaturesEqual(signature, { ...signature }), true);
  assert.equal(areInpaintSourceLoadSignaturesEqual(signature, {
    ...signature,
    sourceLoadUrl: 'blob:original-2',
  }), false);
  assert.equal(areInpaintSourceLoadSignaturesEqual(signature, {
    ...signature,
    sourceFileId: 'file-2',
  }), false);
  assert.equal(areInpaintSourceLoadSignaturesEqual(signature, null), false);
});

test('resolveInpaintSourceLoadTransition reloads same source when its original URL changes without clearing mask', () => {
  const previous = {
    sourceNodeId: 'node-1',
    sourceFileId: 'file-1',
    sourceLoadUrl: 'blob:original-1',
  };

  assert.deepEqual(resolveInpaintSourceLoadTransition(previous, {
    ...previous,
    sourceLoadUrl: 'blob:original-2',
  }), {
    shouldResetLoadedImage: true,
    shouldClearPreviousSource: false,
  });

  assert.deepEqual(resolveInpaintSourceLoadTransition(previous, {
    ...previous,
    sourceFileId: 'file-2',
  }), {
    shouldResetLoadedImage: true,
    shouldClearPreviousSource: true,
  });

  assert.deepEqual(resolveInpaintSourceLoadTransition(previous, null), {
    shouldResetLoadedImage: false,
    shouldClearPreviousSource: false,
  });
});

test('shouldResolveInpaintSourceResource ignores stable canvas rerenders once the original is resolved', () => {
  assert.equal(shouldResolveInpaintSourceResource({
    currentKey: 'workflow-a|node-1|file-1',
    nextKey: 'workflow-a|node-1|file-1',
    currentUrl: 'blob:resolved-original',
    currentLoading: false,
    currentError: undefined,
  }), false);

  assert.equal(shouldResolveInpaintSourceResource({
    currentKey: 'workflow-a|node-1|file-1',
    nextKey: 'workflow-a|node-1|file-2',
    currentUrl: 'blob:resolved-original',
    currentLoading: false,
    currentError: undefined,
  }), true);

  assert.equal(shouldResolveInpaintSourceResource({
    currentKey: 'workflow-a|node-1|file-1',
    nextKey: 'workflow-a|node-1|file-1',
    currentUrl: undefined,
    currentLoading: false,
    currentError: 'Original failed',
  }), true);

  assert.equal(shouldResolveInpaintSourceResource({
    currentKey: null,
    nextKey: '',
    currentUrl: undefined,
    currentLoading: false,
    currentError: undefined,
  }), false);
});

test('shouldResolveInpaintSourceResource does not restart preparing during stable drag or zoom rerenders', () => {
  const stableSourceKey = 'workflow-a|node-1|file-1';

  assert.equal(shouldResolveInpaintSourceResource({
    currentKey: stableSourceKey,
    nextKey: stableSourceKey,
    currentUrl: undefined,
    currentLoading: true,
    currentError: undefined,
  }), false);

  assert.equal(shouldResolveInpaintSourceResource({
    currentKey: stableSourceKey,
    nextKey: stableSourceKey,
    currentUrl: 'blob:resolved-original',
    currentLoading: false,
    currentError: undefined,
  }), false);

  assert.equal(shouldResolveInpaintSourceResource({
    currentKey: stableSourceKey,
    nextKey: 'workflow-a|node-1|file-2',
    currentUrl: 'blob:resolved-original',
    currentLoading: false,
    currentError: undefined,
  }), true);
});

test('getInpaintBrushImagePixelSize maps visual brush size onto source image pixels', () => {
  assert.equal(getInpaintBrushImagePixelSize(
    20,
    { width: 1000, height: 500 },
    { width: 500, height: 250 },
  ), 40);

  assert.equal(getInpaintBrushImagePixelSize(
    20,
    { width: 1200, height: 800 },
    { width: 300, height: 400 },
  ), 80);
});

test('resolveInpaintImageDrawRect establishes a contain rect for a loaded source image', () => {
  assert.deepEqual(resolveInpaintImageDrawRect({
    imageWidth: 1600,
    imageHeight: 900,
    canvasWidth: 533,
    canvasHeight: 300,
  }), {
    x: 0,
    y: 0.09375,
    width: 533,
    height: 299.8125,
  });

  assert.deepEqual(resolveInpaintImageDrawRect({
    imageWidth: 1600,
    imageHeight: 900,
    canvasWidth: 500,
    canvasHeight: 300,
  }), {
    x: 0,
    y: 9.375,
    width: 500,
    height: 281.25,
  });

  assert.deepEqual(resolveInpaintImageDrawRect({
    imageWidth: 900,
    imageHeight: 1600,
    canvasWidth: 500,
    canvasHeight: 300,
  }), {
    x: 165.625,
    y: 0,
    width: 168.75,
    height: 300,
  });
});

test('resolveInpaintImageDrawRect returns null for zero-sized images or canvases', () => {
  assert.equal(resolveInpaintImageDrawRect({
    imageWidth: 1600,
    imageHeight: 900,
    canvasWidth: 0,
    canvasHeight: 300,
  }), null);

  assert.equal(resolveInpaintImageDrawRect({
    imageWidth: 0,
    imageHeight: 900,
    canvasWidth: 500,
    canvasHeight: 300,
  }), null);
});

test('getInpaintBrushImagePixelSize falls back to visual size when draw rect is unavailable', () => {
  assert.equal(getInpaintBrushImagePixelSize(
    18,
    { width: 1000, height: 500 },
    null,
  ), 18);

  assert.equal(getInpaintBrushImagePixelSize(
    18,
    { width: 1000, height: 500 },
    { width: 0, height: 250 },
  ), 18);
});

test('resolveInpaintBrushPreviewPoint only returns a cursor position inside the drawn image rect', () => {
  const drawRect = {
    x: 20,
    y: 10,
    width: 200,
    height: 100,
  };

  assert.deepEqual(resolveInpaintBrushPreviewPoint({
    canvasX: 120,
    canvasY: 60,
  }, drawRect), {
    x: 120,
    y: 60,
  });

  assert.equal(resolveInpaintBrushPreviewPoint({
    canvasX: 10,
    canvasY: 60,
  }, drawRect), null);

  assert.equal(resolveInpaintBrushPreviewPoint({
    canvasX: 120,
    canvasY: 120,
  }, drawRect), null);
});

test('brush preview point stays aligned with draw rect boundaries after canvas scaling', () => {
  const drawRect = resolveInpaintImageDrawRect({
    imageWidth: 1200,
    imageHeight: 800,
    canvasWidth: 360,
    canvasHeight: 300,
  });

  assert.deepEqual(drawRect, {
    x: 0,
    y: 30,
    width: 360,
    height: 240,
  });
  assert.deepEqual(resolveInpaintBrushPreviewPoint({
    canvasX: 180,
    canvasY: 150,
  }, drawRect), {
    x: 180,
    y: 150,
  });
  assert.equal(resolveInpaintBrushPreviewPoint({
    canvasX: 180,
    canvasY: 20,
  }, drawRect), null);
  assert.equal(getInpaintBrushImagePixelSize(
    30,
    { width: 1200, height: 800 },
    drawRect,
  ), 100);
});

test('resolveInpaintImagePointerPoint maps canvas coordinates into source image pixels', () => {
  const drawRect = {
    x: 10,
    y: 20,
    width: 200,
    height: 100,
  };

  assert.deepEqual(resolveInpaintImagePointerPoint({
    canvasX: 110,
    canvasY: 70,
    imageWidth: 1000,
    imageHeight: 500,
    drawRect,
  }), {
    x: 500,
    y: 250,
    canvasX: 110,
    canvasY: 70,
  });

  assert.equal(resolveInpaintImagePointerPoint({
    canvasX: 9,
    canvasY: 70,
    imageWidth: 1000,
    imageHeight: 500,
    drawRect,
  }), null);
});

test('getInpaintCoalescedPointerCoordinates preserves coalesced points and appends fallback point', () => {
  assert.deepEqual(getInpaintCoalescedPointerCoordinates({
    clientX: 30,
    clientY: 40,
    nativeEvent: {
      getCoalescedEvents: () => [
        { clientX: 10, clientY: 20 },
        { clientX: 20, clientY: 30 },
      ],
    },
  }), [
    { clientX: 10, clientY: 20 },
    { clientX: 20, clientY: 30 },
    { clientX: 30, clientY: 40 },
  ]);

  assert.deepEqual(getInpaintCoalescedPointerCoordinates({
    clientX: 30,
    clientY: 40,
    nativeEvent: {
      getCoalescedEvents: () => [
        { clientX: 30, clientY: 40 },
      ],
    },
  }), [
    { clientX: 30, clientY: 40 },
  ]);
});

test('shouldDeferInpaintMaskSnapshotCommit protects in-progress brush strokes from stale commits', () => {
  assert.equal(shouldDeferInpaintMaskSnapshotCommit({
    isPointerDown: false,
    hasActiveStroke: false,
  }), false);

  assert.equal(shouldDeferInpaintMaskSnapshotCommit({
    isPointerDown: true,
    hasActiveStroke: false,
  }), true);

  assert.equal(shouldDeferInpaintMaskSnapshotCommit({
    isPointerDown: false,
    hasActiveStroke: true,
  }), true);

  assert.equal(shouldDeferInpaintMaskSnapshotCommit({
    isPointerDown: true,
    hasActiveStroke: true,
  }), true);
});

test('isInpaintCanvasPointInsideDrawRect rejects missing or invalid draw rects', () => {
  assert.equal(isInpaintCanvasPointInsideDrawRect({
    canvasX: 1,
    canvasY: 1,
  }, null), false);

  assert.equal(isInpaintCanvasPointInsideDrawRect({
    canvasX: 1,
    canvasY: 1,
  }, {
    x: 0,
    y: 0,
    width: 0,
    height: 10,
  }), false);
});

test('resolveInpaintCanvasViewport marks zero-sized stages as not ready without returning zero dimensions', () => {
  assert.deepEqual(resolveInpaintCanvasViewport(0, 0, 2), {
    width: 1,
    height: 1,
    dpr: 2,
    ready: false,
  });

  assert.deepEqual(resolveInpaintCanvasViewport(320.9, 240.2, 2), {
    width: 320,
    height: 240,
    dpr: 2,
    ready: true,
  });
});

test('resolveInpaintCanvasViewport caps backing pixels for large preview stages', () => {
  const viewport = resolveInpaintCanvasViewport(2000, 1500, 2);

  assert.equal(viewport.width, 2000);
  assert.equal(viewport.height, 1500);
  assert.equal(viewport.ready, true);
  assert.ok(viewport.dpr < 1);
  assert.ok(viewport.width * viewport.height * viewport.dpr * viewport.dpr <= 1_750_000 + 1);
});

test('resolveInpaintCanvasElementLayoutSize ignores transformed bounding rect when layout size is available', () => {
  assert.deepEqual(resolveInpaintCanvasElementLayoutSize({
    clientWidth: 500,
    clientHeight: 300,
    offsetWidth: 500,
    offsetHeight: 300,
    getBoundingClientRect: () => ({
      width: 1000,
      height: 600,
    } as DOMRect),
  }), {
    width: 500,
    height: 300,
  });
});

test('resolveInpaintCanvasLocalPoint removes React Flow transform scaling from pointer coordinates', () => {
  assert.deepEqual(resolveInpaintCanvasLocalPoint({
    clientX: 600,
    clientY: 350,
    canvasBounds: {
      left: 100,
      top: 50,
      width: 1000,
      height: 600,
    },
    viewport: {
      width: 500,
      height: 300,
    },
  }), {
    canvasX: 250,
    canvasY: 150,
  });
});

test('resolveInpaintSourceImageLoadUrl only uses the unified resolved original URL', () => {
  const node = createImageNode();

  assert.deepEqual(resolveInpaintSourceImageLoadUrl(node, 'blob:resolved-original'), {
    kind: 'original',
    url: 'blob:resolved-original',
    hasOriginalSource: true,
  });

  assert.deepEqual(resolveInpaintSourceImageLoadUrl(node, '  blob:resolved-original-2  '), {
    kind: 'original',
    url: 'blob:resolved-original-2',
    hasOriginalSource: true,
  });
});

test('resolveInpaintSourceImageLoadUrl waits for FileResourceService without falling back to preview or thumbnail', () => {
  const node = createImageNode({
    previewUrl: 'blob:preview-image',
  });

  assert.deepEqual(resolveInpaintSourceImageLoadUrl(node), {
    kind: 'none',
    hasOriginalSource: false,
  });

  assert.deepEqual(resolveInpaintSourceImageLoadUrl(node, undefined, true), {
    kind: 'none',
    hasOriginalSource: true,
  });

  assert.deepEqual(resolveInpaintSourceImageLoadUrl(createImageNode({
    imageAsset: {
      assetId: 'file-image-2',
      source: 'local',
      variants: {
        thumbnail: {
          url: 'blob:thumbnail-image',
        },
      },
      version: 1,
    },
    previewUrl: undefined,
    thumbnailUrl: 'blob:legacy-thumbnail',
  })), {
    kind: 'none',
    hasOriginalSource: false,
  });
});

test('inpaint original resolver can use local full original when requested image asset version etag is missing from registry metadata', async () => {
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
  const createdObjectUrls: string[] = [];
  const fetchCalls: string[] = [];
  const service = new FileResourceService({
    fetchBlob: async (url) => {
      fetchCalls.push(url);
      return new Blob(['remote']);
    },
    createObjectUrl: (blob) => {
      const url = `blob:inpaint-full-original-${blob.size}`;
      createdObjectUrls.push(url);
      return url;
    },
  });
  const node = createImageNode({
    id: { value: 'node-inpaint-local-original', display: '#00002' },
    fileId: 'file-inpaint-local-original',
    imageAsset: {
      assetId: 'file-inpaint-local-original',
      source: 'remote',
      variants: {
        thumbnail: {
          url: 'blob:thumbnail-should-not-be-used',
        },
        original: {
          url: '/api/v1/files/file-inpaint-local-original/download',
          updatedAt: 12345,
        },
      },
      version: 7,
    },
    thumbnailUrl: 'blob:legacy-thumbnail-should-not-be-used',
    previewUrl: 'blob:preview-should-not-be-used',
  });
  imageOriginalSourceRegistry.registerLocalFile(
    node.id.value,
    node.fileId,
    new File(['full-original'], 'full-original.png', { type: 'image/png' }),
    {
      workflowId: 'workflow-inpaint',
      authScope: 'account-a',
    },
  );

  const handle = await service.resolveFileResource(node, {
    purpose: 'inpaint-editor-original',
    require: 'displayUrl',
    workflowId: 'workflow-inpaint',
    authScope: 'account-a',
    version: node.imageAsset?.version,
    etag: String(node.imageAsset?.variants.original?.updatedAt),
  });

  assert.equal(handle.selectedSource, 'registry-file');
  assert.equal(handle.displayUrl, 'blob:inpaint-full-original-13');
  assert.deepEqual(createdObjectUrls, ['blob:inpaint-full-original-13']);
  assert.deepEqual(fetchCalls, []);
  assert.ok(handle.displayUrl !== node.thumbnailUrl);
  assert.ok(handle.displayUrl !== node.previewUrl);
  assert.ok(handle.displayUrl !== node.imageAsset?.variants.thumbnail?.url);

  handle.release();
  imageOriginalSourceRegistry.clear({ force: true });
  fileManifestStore.clear();
  fileResourceLeaseManager.clear();
});

test('resolveInpaintAspectFitSize preserves the source image ratio inside the editor stage', () => {
  assert.deepEqual(resolveInpaintAspectFitSize({
    containerWidth: 500,
    containerHeight: 300,
    imageWidth: 1600,
    imageHeight: 900,
  }), {
    width: 500,
    height: 281.25,
  });

  assert.deepEqual(resolveInpaintAspectFitSize({
    containerWidth: 500,
    containerHeight: 300,
    imageWidth: 900,
    imageHeight: 1600,
  }), {
    width: 168.75,
    height: 300,
  });

  assert.deepEqual(resolveInpaintAspectFitSize({
    containerWidth: 500,
    containerHeight: 300,
    imageWidth: undefined,
    imageHeight: undefined,
  }), {
    width: 500,
    height: 300,
  });

  assert.equal(resolveInpaintAspectFitSize({
    containerWidth: 0,
    containerHeight: 300,
    imageWidth: 1600,
    imageHeight: 900,
  }), null);
});
