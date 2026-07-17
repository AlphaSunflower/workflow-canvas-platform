import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from 'reactflow';

import type { FileNodeData } from '@/types';
import type { UseImageResourceResult } from '@/hooks/image/useImageResource';
import { FileNodePropertyDialog } from './FileNodePropertyDialog';
import { FileNodeCanvasShell } from './FileNodeCanvasShell';
import { resolveImageNodeProxyRouting } from './file-node-proxy.shared';
import {
  resolveImageNodePreviewDisplay,
  resolveImageViewerDisplay,
} from './constants';
import {
  clearCanvasActiveNodeStateSnapshot,
  promoteCanvasNode,
  requestCanvasNodeViewerOpen,
} from '../../canvas/canvas-active-node-state';
import {
  clearCanvasRuntimeVisualStateSnapshot,
  getCanvasRuntimeVisualState,
  syncCanvasRuntimeVisualStateSnapshot,
} from '../../canvas/canvas-runtime-visual-state';
import {
  clearCanvasImageFirstPaintState,
  hasCanvasImageFirstPainted,
  markCanvasImageFirstPainted,
} from '../../canvas/canvas-image-first-paint-store';
import {
  canvasRasterReadyStore,
  hasCanvasRasterReadyItem,
} from '../../canvas/canvas-raster-ready-store';

function createFileNodeData(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: '601',
      display: '#00601',
    },
    type: 'image',
    position: { x: 120, y: 80 },
    dimensions: { width: 240, height: 160 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId: 'file-601',
    fileName: 'stress-check.png',
    fileSize: 2048,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 1600,
      height: 900,
    },
    ...overrides,
  };
}

function createImageResourceStub(overrides: Partial<UseImageResourceResult> = {}): UseImageResourceResult {
  return {
    src: undefined,
    status: 'idle',
    phase: 'idle',
    error: undefined,
    preview: null,
    isVisible: true,
    isNearViewport: true,
    displayWidth: 240,
    displayHeight: 160,
    placeholder: 'ready',
    request: async () => undefined,
    release: () => undefined,
    viewer: {
      resourcePolicy: 'thumbnail-only',
      resourceRole: 'canvas-thumbnail',
    },
    decoded: {
      width: 0,
      height: 0,
      estimatedBytes: 0,
    },
    debug: {
      resourcePolicy: 'thumbnail-only',
      resourceRole: 'canvas-thumbnail',
    },
    shouldAutoRequest: false,
    requestUrl: undefined,
    reportRenderableFailure: () => undefined,
    ...overrides,
  };
}

test('FileNodePropertyDialog renders file metadata sections for image nodes after thumbnail-only changes', () => {
  const markup = renderToStaticMarkup(
    <FileNodePropertyDialog
      node={createFileNodeData({
        thumbnailUrl: 'blob:thumbnail',
      })}
      isOpen={true}
      onClose={() => undefined}
    />
  );

  assert.ok(markup.includes('stress-check.png'));
  assert.ok(markup.includes('1600'));
  assert.ok(markup.includes('900'));
});

test('FileNodePropertyDialog tolerates missing thumbnail url after unavailable state without breaking dialog rendering', () => {
  const markup = renderToStaticMarkup(
    <FileNodePropertyDialog
      node={createFileNodeData({
        status: 'error',
        thumbnailUrl: undefined,
        metadata: {},
      })}
      isOpen={true}
      onClose={() => undefined}
    />
  );

  assert.ok(markup.includes('stress-check.png'));
});

test('FileNodePropertyDialog exposes local file rebind action for image nodes when handler is provided', () => {
  const markup = renderToStaticMarkup(
    <FileNodePropertyDialog
      node={createFileNodeData()}
      isOpen={true}
      onClose={() => undefined}
      onRebindLocalFile={async () => null}
    />
  );

  assert.ok(markup.includes('重新关联本地文件'));
});

test('thumbnail placeholder stays renderable before enhancement settles', () => {
  const display = resolveImageNodePreviewDisplay({
    previewState: {
      status: 'processing',
      hasRenderablePreview: true,
    },
    resourceState: {
      placeholder: 'ready',
      hasImageSrc: true,
      status: 'idle',
    },
  });

  assert.equal(display, 'ready');
});

test('preview ready wins over node processing status so image nodes do not fall back to loading placeholder', () => {
  const display = resolveImageNodePreviewDisplay({
    previewState: {
      status: 'ready',
      hasRenderablePreview: true,
    },
    resourceState: {
      placeholder: 'ready',
      hasImageSrc: true,
      status: 'ready',
    },
    businessState: {
      isImportError: false,
    },
  });

  assert.equal(display, 'ready');
});

test('preview display can reach ready before raster-managed passive nodes have any DOM preview fallback', () => {
  const display = resolveImageNodePreviewDisplay({
    previewState: {
      status: 'ready',
      hasRenderablePreview: false,
    },
    resourceState: {
      placeholder: 'ready',
      hasImageSrc: true,
      status: 'ready',
    },
    businessState: {
      isImportError: false,
    },
  });

  assert.equal(display, 'ready');
});

test('ready preview plus passive raster-managed routing leaves no DOM loading fallback before raster first paint', () => {
  const display = resolveImageNodePreviewDisplay({
    previewState: {
      status: 'ready',
      hasRenderablePreview: false,
    },
    resourceState: {
      placeholder: 'ready',
      hasImageSrc: true,
      status: 'ready',
    },
    businessState: {
      isImportError: false,
    },
  });

  const suppressImageDomPreview = true;
  const isCanvasImageReady = false;
  const wouldRenderDomPlaceholder = !suppressImageDomPreview && !isCanvasImageReady;
  const wouldRenderDomImage = !suppressImageDomPreview;

  assert.equal(display, 'ready');
  assert.equal(wouldRenderDomPlaceholder, false);
  assert.equal(wouldRenderDomImage, false);
});

test('raster-managed image shell does not show unavailable placeholder while DOM image resource is disabled', () => {
  const markup = renderToStaticMarkup(
    <ReactFlowProvider>
      <FileNodeCanvasShell
        data={createFileNodeData()}
        selected={false}
        dragging={false}
        nodeColor="#3b82f6"
        nodeIcon="IMG"
        wrapperRef={{ current: null }}
        previewVideoRef={{ current: null }}
        imageResource={createImageResourceStub({
          placeholder: 'unavailable',
          status: 'error',
        })}
        imageSrc={undefined}
        previewVideoSrc={undefined}
        imageThumbnailUrl={undefined}
        bottomInfoText="2.0 KB"
        isInteractionActive={false}
        isImportPlaceholder={false}
        isImportError={false}
        imagePreviewDisplay="unavailable"
        hasRenderablePreview={false}
        isCanvasImageReady={false}
        videoReady={false}
        isPreviewPlaying={false}
        renderTier="full"
        imageResourceOwner="raster"
        suppressImageDomPreview={true}
        onImageDoubleClick={() => undefined}
        onVideoDoubleClick={() => undefined}
        onImageLoad={() => undefined}
        onImageError={() => undefined}
        onVideoLoadedMetadata={() => undefined}
        onVideoLoadedData={() => undefined}
        onVideoError={() => undefined}
        onVideoPause={() => undefined}
        onVideoPlay={() => undefined}
        onPreviewPlay={() => undefined}
        onPreviewPause={() => undefined}
      />
    </ReactFlowProvider>
  );

  assert.ok(markup.includes('file-node--raster-managed'));
  assert.ok(markup.includes('file-node__image-shell'));
  assert.equal(markup.includes('file-node__placeholder--error'), false);
  assert.equal(markup.includes('file-node--error'), false);
});

test('passive raster-managed image nodes must not suppress DOM preview before raster first paint has completed', () => {
  clearCanvasImageFirstPaintState();
  canvasRasterReadyStore.clear();

  const nodeId = '601';
  const imageSrc = 'blob:first-frame';
  const isPassive = true;
  const inFullTier = true;
  const isVisibleOrNearViewport = true;
  const computeSuppress = (painted: boolean, hasReadyRasterItem: boolean): boolean => (
    inFullTier &&
    isPassive &&
    isVisibleOrNearViewport &&
    painted &&
    hasReadyRasterItem
  );

  const suppressBeforeFirstPaint = computeSuppress(
    hasCanvasImageFirstPainted(nodeId, imageSrc),
    hasCanvasRasterReadyItem(nodeId, imageSrc),
  );

  assert.equal(suppressBeforeFirstPaint, false);

  markCanvasImageFirstPainted(nodeId, imageSrc);

  const suppressAfterFirstPaint = computeSuppress(
    hasCanvasImageFirstPainted(nodeId, imageSrc),
    hasCanvasRasterReadyItem(nodeId, imageSrc),
  );

  assert.equal(suppressAfterFirstPaint, false);
  canvasRasterReadyStore.replace([{
    nodeId,
    fileName: 'first-frame.png',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    status: 'ready',
    src: imageSrc,
    resourceSrc: imageSrc,
  }]);

  const suppressAfterReadyRasterItem = computeSuppress(
    hasCanvasImageFirstPainted(nodeId, imageSrc),
    hasCanvasRasterReadyItem(nodeId, imageSrc),
  );

  assert.equal(suppressAfterReadyRasterItem, true);
  canvasRasterReadyStore.clear();
  clearCanvasImageFirstPaintState();
});

test('FileNode routes canvas image resource ownership through render plan owner state', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/node/file/FileNode.tsx`,
    'utf8',
  );

  assert.equal(source.includes("const plannedImageResourceOwner = data.type === 'image'"), true);
  assert.equal(source.includes("imageResourceOwner === 'dom'"), true);
  assert.equal(source.includes("imageResourceOwner === 'raster'"), true);
  assert.equal(source.includes('const forceFullDomImageFallback = data.type === \'image\''), true);
  assert.equal(source.includes('const renderTier = forceFullDomImageFallback'), true);
  assert.equal(source.includes('suppressImageRasterOwnedPreview'), true);
  assert.equal(source.includes('canUseStableRasterPreview'), true);
  assert.equal(source.includes('!forceFullDomImageFallback'), true);
  assert.equal(source.includes("enabled: canvasImageResourceEnabled"), true);
  assert.equal(source.includes("renderTier !== 'minimal'"), false);
  assert.equal(source.includes('lastCanvasImageSrcRef.current'), true);
});

test('FileNodeCanvasShell exposes image resource owner as runtime diagnostics only', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/node/file/FileNodeCanvasShell.tsx`,
    'utf8',
  );

  assert.equal(source.includes('data-image-resource-owner'), true);
  assert.equal(source.includes('imageResourceOwner?: FileNodeImageResourceOwner;'), true);
});

test('viewer display remains disabled until explicit original resource activation produces a source', () => {
  assert.equal(resolveImageViewerDisplay({
    status: 'idle',
    hasImageSrc: false,
  }), 'error');

  assert.equal(resolveImageViewerDisplay({
    status: 'ready',
    hasImageSrc: true,
  }), 'ready');
});

test('passive compact image nodes stay eligible for proxy routing without affecting thumbnail routing semantics', () => {
  const decision = resolveImageNodeProxyRouting({
    nodeType: 'image',
    scheduledRenderTier: 'compact',
    canvasActiveState: 'passive',
  });

  assert.equal(decision.useProxy, true);
  assert.equal(decision.renderTier, 'compact');
});

test('passive image node promotion path can request viewer open without changing thumbnail routing contract', () => {
  clearCanvasActiveNodeStateSnapshot();
  clearCanvasRuntimeVisualStateSnapshot();
  promoteCanvasNode('601', ['selected']);
  requestCanvasNodeViewerOpen('601');
  syncCanvasRuntimeVisualStateSnapshot([
    ['601', {
      scheduledRenderTier: 'compact',
      canvasState: { activeState: 'active', activeReasons: ['selected'] },
    }],
  ]);

  const decision = resolveImageNodeProxyRouting({
    nodeType: 'image',
    scheduledRenderTier: 'compact',
    canvasActiveState: getCanvasRuntimeVisualState('601', 'compact').activeState,
  });

  assert.equal(decision.useProxy, false);
  assert.equal(decision.renderTier, 'full');
  clearCanvasActiveNodeStateSnapshot();
  clearCanvasRuntimeVisualStateSnapshot();
});
