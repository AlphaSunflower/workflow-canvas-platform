import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveImageNodePreviewDisplay } from '../../components/node/file/constants';
import {
  applyImportedImageAssets,
  buildImportedImageAssets,
  buildRemoteImageAsset,
  clearAllImageResources,
  clearNodeImageResources,
  createLocalImageNodeDraft,
  hasRestorableLocalFileSource,
  shouldUseRemoteFileResourceFallback,
} from './image-node';
import {
  getImageVariantUrls,
  resolveFileNodeImageAsset,
  selectCanvasImageVariant,
  selectViewerImageVariant,
} from './image-asset';
import {
  createImageResourceReadModel,
  resolveImageResourcePlaceholder,
  shouldAutoRequestImageResource,
} from './image-resource.types';
import { imageImportPreviewService } from './image-import-preview.service';
import { imageOriginalSourceRegistry } from './image-original-source-registry';
import { imageThumbnailRuntimeStore } from './image-thumbnail-runtime-store';
import { fileManifestStore, fileResourceLeaseManager } from '@/services/file-resource';
import type { FileNodeData } from '@/types';
import { createDefaultFileNodeData, createSequentialNodeId } from '@/utils';

function createImageNodeData(nodeIdValue = 1): FileNodeData {
  const nodeId = createSequentialNodeId(nodeIdValue);
  return createDefaultFileNodeData(
    nodeId,
    { x: 0, y: 0 },
    'image',
    nodeId.value,
    `image-${nodeId.value}.png`,
    1024,
    'image/png',
  );
}

test('buildRemoteImageAsset uses remote thumbnail and original urls only', () => {
  const result = buildRemoteImageAsset('file-1', {
    width: 1280,
    height: 720,
  });

  assert.equal(result.thumbnailUrl, '/api/v1/files/file-1/thumbnail');
  assert.deepEqual(Object.keys(result.imageAsset.variants).sort(), ['original', 'thumbnail']);
  assert.equal(result.imageAsset.variants.thumbnail?.url, '/api/v1/files/file-1/thumbnail');
  assert.equal(result.imageAsset.variants.original?.url, '/api/v1/files/file-1/download');
});

test('local source fallback policy skips remote resources for restorable local references', () => {
  const availableNode = createImageNodeData(2);
  availableNode.source = {
    type: 'imported',
    importMethod: 'local',
    sourceDisplayName: 'linked.png',
    localSource: {
      status: 'available',
      referenceId: 'fs-handle-1',
      kind: 'file-system-access',
      permissionState: 'granted',
    },
    importedAt: Date.now(),
  };

  const linkedNode = createImageNodeData(4);
  linkedNode.source = {
    type: 'imported',
    importMethod: 'local',
    sourceDisplayName: 'linked.png',
    localSource: {
      status: 'linked',
      referenceId: 'fs-handle-1',
      kind: 'file-system-access',
    },
    importedAt: Date.now(),
  };

  const linkedVideoNode: FileNodeData = {
    ...createImageNodeData(5),
    type: 'video',
    fileName: 'linked-video.mp4',
    mimeType: 'video/mp4',
    metadata: {
      width: 1280,
      height: 720,
      duration: 8,
    },
    source: {
      type: 'imported',
      importMethod: 'local',
      sourceDisplayName: 'linked-video.mp4',
      localSource: {
        status: 'linked',
        referenceId: 'fs-video-1',
        kind: 'file-system-access',
      },
      importedAt: Date.now(),
    },
  };

  const runtimeOnlyNode = createImageNodeData(3);
  runtimeOnlyNode.source = {
    type: 'imported',
    importMethod: 'local',
    sourceDisplayName: 'runtime.png',
    localSource: {
      status: 'runtime-only',
    },
    importedAt: Date.now(),
  };

  assert.equal(hasRestorableLocalFileSource(availableNode), true);
  assert.equal(shouldUseRemoteFileResourceFallback(availableNode), false);
  assert.equal(hasRestorableLocalFileSource(linkedNode), true);
  assert.equal(shouldUseRemoteFileResourceFallback(linkedNode), false);
  assert.equal(hasRestorableLocalFileSource(linkedVideoNode), true);
  assert.equal(shouldUseRemoteFileResourceFallback(linkedVideoNode), true);
  assert.equal(hasRestorableLocalFileSource(runtimeOnlyNode), false);
  assert.equal(shouldUseRemoteFileResourceFallback(runtimeOnlyNode), true);
});

test('canvas resources auto request only for visible thumbnail work; original mode stays explicit', () => {
  assert.equal(shouldAutoRequestImageResource({
    mode: 'canvas',
    src: 'blob:thumb',
    status: 'idle',
    visibility: {
      isVisible: true,
      isNearViewport: true,
    },
  }), true);

  assert.equal(shouldAutoRequestImageResource({
    mode: 'canvas',
    src: 'blob:thumb',
    status: 'idle',
    visibility: {
      isVisible: false,
      isNearViewport: false,
    },
  }), false);

  assert.equal(shouldAutoRequestImageResource({
    mode: 'original',
    src: 'blob:original',
    status: 'idle',
    visibility: {
      isVisible: true,
      isNearViewport: true,
    },
  }), false);
});

test('image placeholder state is limited to hidden loading unavailable and ready', () => {
  assert.equal(resolveImageResourcePlaceholder({
    status: 'idle',
    visibility: {
      isVisible: false,
      isNearViewport: false,
    },
  }), 'hidden');

  assert.equal(resolveImageResourcePlaceholder({
    status: 'loading',
    visibility: {
      isVisible: true,
      isNearViewport: true,
    },
  }), 'loading');

  assert.equal(resolveImageResourcePlaceholder({
    status: 'error',
    visibility: {
      isVisible: true,
      isNearViewport: true,
    },
  }), 'unavailable');
});

test('createImageResourceReadModel exposes thumbnail-ready canvas state without fallback fields', () => {
  const view = createImageResourceReadModel({
    nodeId: 'node-1',
    mode: 'canvas',
    resourcePolicy: 'thumbnail-only',
    resourceRole: 'canvas-thumbnail',
    src: 'blob:thumb',
    status: 'ready',
    phase: 'thumbnail-ready',
    activeVariantKind: 'thumbnail',
    visibility: {
      isVisible: true,
      isNearViewport: true,
      displayWidth: 300,
      displayHeight: 200,
      centerDistance: 0,
      isSelected: false,
      isRecentlyInteracted: false,
    },
  });

  assert.equal(view.src, 'blob:thumb');
  assert.equal(view.phase, 'thumbnail-ready');
  assert.equal(view.placeholder, 'ready');
  assert.equal(view.viewer.resourceRole, 'canvas-thumbnail');
});

test('canvas and viewer image selection split thumbnail and original paths', () => {
  const resolvedAsset = resolveFileNodeImageAsset({
    fileId: 'file-thumbnail-only',
    metadata: {
      width: 2048,
      height: 1280,
    },
    imageAsset: {
      assetId: 'file-thumbnail-only',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-thumbnail-only/thumbnail',
          width: 320,
          height: 200,
        },
        original: {
          url: '/api/v1/files/file-thumbnail-only/download',
          width: 2048,
          height: 1280,
        },
      },
    },
    thumbnailUrl: '/api/v1/files/file-thumbnail-only/thumbnail',
  });

  assert.equal(selectCanvasImageVariant(resolvedAsset, { width: 1800, height: 1100 }).preferred?.kind, 'thumbnail');
  assert.equal(selectViewerImageVariant(resolvedAsset).requestedKind, 'original');
  assert.deepEqual(getImageVariantUrls(resolvedAsset, 'canvas'), ['/api/v1/files/file-thumbnail-only/thumbnail']);
  assert.deepEqual(getImageVariantUrls(resolvedAsset, 'original'), ['/api/v1/files/file-thumbnail-only/download']);
});

test('local image draft registers original source and leaves node data free of object urls', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = () => 'blob:local-original-only';
  imageOriginalSourceRegistry.clear();
  imageThumbnailRuntimeStore.clearAll();

  try {
    const fileNode = createImageNodeData(11);
    const file = new File(['image'], 'draft.png', { type: 'image/png' });
    const draft = createLocalImageNodeDraft(fileNode.id.value, file, fileNode, {
      sessionId: 'session-1',
      fileId: fileNode.fileId,
    });

    assert.equal(draft.imageAsset?.variants.thumbnail?.url, undefined);
    assert.equal(draft.imageAsset?.variants.original?.url, undefined);
    assert.equal(imageOriginalSourceRegistry.getFile(fileNode.id.value, fileNode.fileId), file);
    assert.equal(imageThumbnailRuntimeStore.get(fileNode.id.value)?.status, 'loading');
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    imageOriginalSourceRegistry.clear();
    imageThumbnailRuntimeStore.clearAll();
  }
});

test('clearNodeImageResources clears runtime thumbnail resources with image manager state', () => {
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const revokedUrls: string[] = [];
  URL.revokeObjectURL = (url) => {
    revokedUrls.push(url);
  };
  imageThumbnailRuntimeStore.clearAll();

  try {
    const node = createImageNodeData(112);
    imageThumbnailRuntimeStore.upsert(node.id.value, {
      status: 'ready',
      objectUrl: 'blob:runtime-thumb-clear',
      objectUrlOwner: 'thumbnail-store',
      blob: new Blob(['thumb'], { type: 'image/png' }),
    });

    clearNodeImageResources(node.id.value);

    assert.equal(imageThumbnailRuntimeStore.get(node.id.value), null);
    assert.deepEqual(revokedUrls, ['blob:runtime-thumb-clear']);
  } finally {
    URL.revokeObjectURL = originalRevokeObjectURL;
    imageThumbnailRuntimeStore.clearAll();
    clearAllImageResources({ forceOriginals: true });
  }
});

test('clearAllImageResources clears only scoped unleased originals and preserves leased originals', () => {
  try {
    imageOriginalSourceRegistry.clear({ force: true });
    fileResourceLeaseManager.clear();
    fileManifestStore.clear();

    const workflowAFile = new File(['a'], 'a.png', { type: 'image/png' });
    const workflowBFile = new File(['b'], 'b.png', { type: 'image/png' });
    const leasedFile = new File(['leased'], 'leased.png', { type: 'image/png' });
    imageOriginalSourceRegistry.registerLocalFile('node-a', 'file-a', workflowAFile, {
      workflowId: 'workflow-a',
    });
    imageOriginalSourceRegistry.registerLocalFile('node-b', 'file-b', workflowBFile, {
      workflowId: 'workflow-b',
    });
    imageOriginalSourceRegistry.registerLocalFile('node-leased', 'file-leased', leasedFile, {
      workflowId: 'workflow-a',
    });
    fileResourceLeaseManager.acquireLease({
      workflowId: 'workflow-a',
      nodeId: 'node-leased',
      fileId: 'file-leased',
      variant: 'original',
    }, 'upload', 'test-upload');

    clearAllImageResources({
      workflowId: 'workflow-a',
    });

    assert.equal(imageOriginalSourceRegistry.getFile('node-a', 'file-a', {
      workflowId: 'workflow-a',
    }), null);
    assert.equal(imageOriginalSourceRegistry.getFile('node-leased', 'file-leased', {
      workflowId: 'workflow-a',
    }), leasedFile);
    assert.equal(imageOriginalSourceRegistry.getFile('node-b', 'file-b', {
      workflowId: 'workflow-b',
    }), workflowBFile);
  } finally {
    imageOriginalSourceRegistry.clear({ force: true });
    fileResourceLeaseManager.clear();
    fileManifestStore.clear();
    imageThumbnailRuntimeStore.clearAll();
  }
});

test('clearAllImageResources can clear display resources without touching originals', () => {
  try {
    imageOriginalSourceRegistry.clear({ force: true });
    fileManifestStore.clear();
    const file = new File(['original'], 'original.png', { type: 'image/png' });
    imageOriginalSourceRegistry.registerLocalFile('node-display-only', 'file-display-only', file, {
      workflowId: 'workflow-display',
    });

    clearAllImageResources({
      workflowId: 'workflow-display',
      clearOriginals: false,
    });

    assert.equal(imageOriginalSourceRegistry.getFile('node-display-only', 'file-display-only', {
      workflowId: 'workflow-display',
    }), file);
  } finally {
    imageOriginalSourceRegistry.clear({ force: true });
    fileManifestStore.clear();
  }
});

test('imported image enhancement assets stay pure while preview owner writes thumbnail runtime store', () => {
  imageThumbnailRuntimeStore.clearAll();
  const fileNode = createImageNodeData(12);
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
  assert.equal(imported.needsNodePatch, false);
  assert.equal(imported.thumbnailUrl, undefined);
  assert.equal(applied.thumbnailUrl, undefined);
  assert.equal(applied.previewUrl, undefined);
  assert.equal(imageThumbnailRuntimeStore.get(fileNode.id.value)?.objectUrl, 'blob:thumb-only');
  assert.equal(imageThumbnailRuntimeStore.get(fileNode.id.value)?.status, 'ready');

  imageThumbnailRuntimeStore.clearAll();
});

test('thumbnail failure assets stay pure while preview owner marks preview unavailable', () => {
  imageThumbnailRuntimeStore.clearAll();
  const result = buildImportedImageAssets('node-failure', undefined, {
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

  assert.equal(result.thumbnailReady, false);
  assert.equal(result.thumbnailUnavailable, true);
  assert.equal(result.needsNodePatch, false);
  assert.equal(imageThumbnailRuntimeStore.get('node-failure')?.status, 'error');
  assert.equal(imageThumbnailRuntimeStore.get('node-failure')?.error, 'thumbnail-unavailable');

  imageThumbnailRuntimeStore.clearAll();
});

test('image node preview display uses stable loading and unavailable states instead of LOW semantics', () => {
  assert.equal(resolveImageNodePreviewDisplay({
    previewState: {
      status: 'processing',
      hasRenderablePreview: false,
    },
    resourceState: {
      placeholder: 'loading',
      hasImageSrc: false,
      status: 'loading',
    },
  }), 'loading');

  assert.equal(resolveImageNodePreviewDisplay({
    previewState: {
      status: null,
      hasRenderablePreview: false,
    },
    resourceState: {
      placeholder: 'unavailable',
      hasImageSrc: false,
      status: 'idle',
    },
  }), 'unavailable');
});
