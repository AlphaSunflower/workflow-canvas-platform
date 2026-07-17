import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from 'reactflow';

import {
  buildCanvasImageRasterItems,
  drawCanvasImageRasterLayer,
  resolveCanvasImageRasterSource,
  resolveCanvasImageRasterStatus,
  shouldDrawCanvasImageRasterPlaceholder,
} from './canvas-image-raster-draw';
import type { AnyNodeData, FileNodeData } from '@/types';
import type { VisibleNodeMap } from '@/hooks/canvas/useVisibleNodes';

function createImageNode(id: string, overrides: Partial<FileNodeData> = {}): Node<AnyNodeData> {
  const data: FileNodeData = {
    id: { value: id, display: `#${id}` },
    type: 'image',
    position: { x: 120, y: 80 },
    dimensions: { width: 240, height: 160 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: 1, updated: 1 },
    fileId: `file-${id}`,
    fileName: `${id}.png`,
    fileSize: 1024,
    mimeType: 'image/png',
    source: { type: 'imported', importMethod: 'local', importedAt: 1 },
    metadata: {},
    ...overrides,
  };

  return {
    id,
    type: 'image',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
  };
}

function createVisibilityMap(entries: Array<{
  nodeId: string;
  renderTier?: 'full' | 'compact' | 'minimal';
  isVisible?: boolean;
  isNearViewport?: boolean;
}>): VisibleNodeMap {
  return new Map(entries.map((entry) => [entry.nodeId, {
    isVisible: entry.isVisible ?? true,
    isNearViewport: entry.isNearViewport ?? true,
    displayWidth: 240,
    displayHeight: 160,
    visibilityBucket: entry.isVisible === false ? 'near' : 'visible',
    visibilityScoreBucket: 'ready',
    visibilityAreaBucket: 'ready',
    visibleAreaRatio: entry.isVisible === false ? 0 : 1,
    viewportZoom: 1,
    visibilityScore: 0.9,
    centerDistance: 0,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    renderTier: entry.renderTier ?? 'full',
  }]));
}

test('buildCanvasImageRasterItems only includes passive full-tier visible image nodes', () => {
  const nodes = [
    createImageNode('passive-visible'),
    createImageNode('active-visible'),
    createImageNode('compact-visible', { imageResourceOwner: 'raster' }),
    createImageNode('minimal-visible', { imageResourceOwner: 'none' }),
  ];
  const visibleNodes = createVisibilityMap([
    { nodeId: 'passive-visible', renderTier: 'full' },
    { nodeId: 'active-visible', renderTier: 'full' },
    { nodeId: 'compact-visible', renderTier: 'compact' },
    { nodeId: 'minimal-visible', renderTier: 'minimal' },
  ]);

  const result = buildCanvasImageRasterItems({
    nodes,
    visibleNodes,
    rasterEligibleNodeIds: new Set(['passive-visible', 'active-visible', 'compact-visible', 'minimal-visible']),
    activeImageNodeIdSet: new Set(['active-visible']),
    getResourceState: () => ({
      src: 'blob:thumb',
      status: 'ready',
    }),
  });

  assert.deepEqual(result.map((item) => item.nodeId), ['passive-visible', 'compact-visible']);
});

test('buildCanvasImageRasterItems does not expand candidates from visible node state', () => {
  const nodes = [createImageNode('visible-but-not-planned')];
  const visibleNodes = createVisibilityMap([
    { nodeId: 'visible-but-not-planned', renderTier: 'full' },
  ]);

  const result = buildCanvasImageRasterItems({
    nodes,
    visibleNodes,
    rasterEligibleNodeIds: new Set(),
    getResourceState: () => ({
      src: 'blob:thumb',
      status: 'ready',
    }),
  });

  assert.deepEqual(result.map((item) => item.nodeId), []);
});

test('buildCanvasImageRasterItems includes a node again after hover promotion is cleared', () => {
  const nodes = [createImageNode('hover-node')];
  const visibleNodes = createVisibilityMap([
    { nodeId: 'hover-node', renderTier: 'full' },
  ]);

  const beforeClear = buildCanvasImageRasterItems({
    nodes,
    visibleNodes,
    rasterEligibleNodeIds: new Set(['hover-node']),
    activeImageNodeIdSet: new Set(['hover-node']),
    getResourceState: () => ({
      src: 'blob:hover-node',
      status: 'ready',
    }),
  });
  assert.deepEqual(beforeClear.map((item) => item.nodeId), []);

  const afterClear = buildCanvasImageRasterItems({
    nodes,
    visibleNodes,
    rasterEligibleNodeIds: new Set(['hover-node']),
    activeImageNodeIdSet: new Set(),
    getResourceState: () => ({
      src: 'blob:hover-node',
      status: 'ready',
    }),
  });
  assert.deepEqual(afterClear.map((item) => item.nodeId), ['hover-node']);
});

test('buildCanvasImageRasterItems keeps selected passive images rasterized', () => {
  const selectedNode = createImageNode('selected-node');
  selectedNode.selected = true;
  const nodes = [selectedNode];
  const visibleNodes = createVisibilityMap([
    { nodeId: 'selected-node', renderTier: 'compact' },
  ]);

  const result = buildCanvasImageRasterItems({
    nodes,
    visibleNodes,
    rasterEligibleNodeIds: new Set(['selected-node']),
    activeImageNodeIdSet: new Set(),
    getResourceState: () => ({
      src: 'blob:selected-node',
      status: 'ready',
    }),
  });

  assert.deepEqual(result.map((item) => item.nodeId), ['selected-node']);
});

test('buildCanvasImageRasterItems restores previous node immediately after hover leaves without waiting for other hover state', () => {
  const nodes = [createImageNode('hover-node')];
  const visibleNodes = createVisibilityMap([
    { nodeId: 'hover-node', renderTier: 'full' },
  ]);

  const hoveredItems = buildCanvasImageRasterItems({
    nodes,
    visibleNodes,
    rasterEligibleNodeIds: new Set(['hover-node']),
    activeImageNodeIdSet: new Set(['hover-node']),
    getResourceState: () => ({
      src: 'blob:hover-node',
      status: 'ready',
    }),
  });
  assert.deepEqual(hoveredItems.map((item) => item.nodeId), []);

  const afterLeaveItems = buildCanvasImageRasterItems({
    nodes,
    visibleNodes,
    rasterEligibleNodeIds: new Set(['hover-node']),
    activeImageNodeIdSet: new Set(),
    getResourceState: () => ({
      src: 'blob:hover-node',
      status: 'ready',
    }),
  });
  assert.deepEqual(afterLeaveItems.map((item) => item.nodeId), ['hover-node']);
});

test('resolveCanvasImageRasterSource prefers decoded source and keeps original viewer resources out', () => {
  assert.equal(resolveCanvasImageRasterSource({
    src: 'blob:thumb',
    status: 'ready',
  }), 'blob:thumb');

  assert.equal(resolveCanvasImageRasterSource({
    src: undefined,
    status: 'ready',
    decodedResource: {
      src: 'blob:decoded-thumb',
      width: 100,
      height: 80,
      decoded: 'image',
    },
  }), 'blob:decoded-thumb');
});

test('resolveCanvasImageRasterStatus maps to ready loading unavailable and viewport-hidden', () => {
  const node = createImageNode('status-node').data as FileNodeData;
  const visible = createVisibilityMap([{ nodeId: 'status-node' }]).get('status-node');
  if (!visible) {
    throw new Error('Expected visibility state.');
  }

  assert.equal(resolveCanvasImageRasterStatus({
    node,
    visibility: visible,
    resource: {
      src: 'blob:thumb',
      status: 'ready',
    },
    src: 'blob:thumb',
  }), 'ready');

  assert.equal(resolveCanvasImageRasterStatus({
    node: {
      ...node,
      status: 'processing',
    },
    visibility: visible,
    resource: {
      status: 'idle',
    },
  }), 'loading');

  assert.equal(resolveCanvasImageRasterStatus({
    node,
    visibility: visible,
    resource: {
      status: 'loading',
    },
  }), 'loading');

  assert.equal(resolveCanvasImageRasterStatus({
    node,
    visibility: visible,
    resource: {
      status: 'error',
    },
  }), 'unavailable');

  assert.equal(resolveCanvasImageRasterStatus({
    node,
    visibility: {
      ...visible,
      isVisible: false,
      isNearViewport: false,
    },
    resource: {
      status: 'ready',
      src: 'blob:thumb',
    },
    src: 'blob:thumb',
  }), 'viewport-hidden');
});

test('drawCanvasImageRasterLayer only resolves ready item sources', () => {
  const resolvedSources: string[] = [];
  const fakeContext = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    drawImage: () => undefined,
    createLinearGradient: () => ({
      addColorStop: () => undefined,
    }),
    fillStyle: '',
    font: '',
    textAlign: 'left' as const,
    textBaseline: 'alphabetic' as const,
  } as unknown as CanvasRenderingContext2D;

  const result = drawCanvasImageRasterLayer(fakeContext, {
    items: [
      {
        nodeId: 'ready',
        fileName: 'ready.png',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        rotation: 0,
        status: 'ready',
        src: 'blob:ready',
      },
      {
        nodeId: 'loading',
        fileName: 'loading.png',
        x: 140,
        y: 0,
        width: 100,
        height: 80,
        rotation: 0,
        status: 'loading',
        src: 'blob:loading',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    canvasSize: { width: 400, height: 300 },
    resolveImage: (src) => {
      resolvedSources.push(src);
      return {
        width: 100,
        height: 80,
      } as unknown as CanvasImageSource;
    },
  });

  assert.deepEqual(resolvedSources, ['blob:ready']);
  assert.equal(result.drawnItemCount, 1);
  assert.equal(result.placeholderItemCount, 1);
  assert.equal(result.budgetExhausted, false);
});

test('drawCanvasImageRasterLayer defers remaining items when frame budget is exhausted', () => {
  const drawnSources: string[] = [];
  let now = 0;
  const fakeContext = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    drawImage: () => {
      now += 4;
    },
    createLinearGradient: () => ({
      addColorStop: () => undefined,
    }),
    fillStyle: '',
    font: '',
    textAlign: 'left' as const,
    textBaseline: 'alphabetic' as const,
  } as unknown as CanvasRenderingContext2D;

  const items = Array.from({ length: 4 }, (_, index) => ({
    nodeId: `node-${index}`,
    fileName: `node-${index}.png`,
    x: index * 120,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    status: 'ready' as const,
    src: `blob:node-${index}`,
  }));

  const first = drawCanvasImageRasterLayer(fakeContext, {
    items,
    viewport: { x: 0, y: 0, zoom: 1 },
    canvasSize: { width: 800, height: 300 },
    maxDurationMs: 7,
    now: () => now,
    resolveImage: (src) => {
      drawnSources.push(src);
      return {
        width: 100,
        height: 80,
      } as unknown as CanvasImageSource;
    },
  });

  assert.equal(first.budgetExhausted, true);
  assert.equal(first.drawnItemCount, 2);
  assert.equal(first.nextStartIndex, 2);
  assert.equal(first.deferredItemCount, 2);

  const second = drawCanvasImageRasterLayer(fakeContext, {
    items,
    viewport: { x: 0, y: 0, zoom: 1 },
    canvasSize: { width: 800, height: 300 },
    startIndex: first.nextStartIndex,
    clear: false,
    now: () => now,
    resolveImage: (src) => {
      drawnSources.push(src);
      return {
        width: 100,
        height: 80,
      } as unknown as CanvasImageSource;
    },
  });

  assert.equal(second.budgetExhausted, false);
  assert.equal(second.drawnItemCount, 2);
  assert.deepEqual(drawnSources, [
    'blob:node-0',
    'blob:node-1',
    'blob:node-2',
    'blob:node-3',
  ]);
});

test('drawCanvasImageRasterLayer skips tiny low detail images before resolving sources', () => {
  const resolvedSources: string[] = [];
  const fakeContext = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    drawImage: () => undefined,
    createLinearGradient: () => ({
      addColorStop: () => undefined,
    }),
    fillStyle: '',
    font: '',
    textAlign: 'left' as const,
    textBaseline: 'alphabetic' as const,
  } as unknown as CanvasRenderingContext2D;

  const result = drawCanvasImageRasterLayer(fakeContext, {
    items: [{
      nodeId: 'tiny',
      fileName: 'tiny.png',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      status: 'ready',
      src: 'blob:tiny',
    }],
    viewport: { x: 0, y: 0, zoom: 0.1 },
    canvasSize: { width: 400, height: 300 },
    resolveImage: (src) => {
      resolvedSources.push(src);
      return {
        width: 10,
        height: 10,
      } as unknown as CanvasImageSource;
    },
  });

  assert.equal(result.lodSkippedItemCount, 1);
  assert.equal(result.drawnItemCount, 0);
  assert.deepEqual(resolvedSources, []);
});

test('drawCanvasImageRasterLayer cover-crops into the node bounds without relying on clipping', () => {
  const drawCalls: Array<{
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;
    targetX: number;
    targetY: number;
    targetWidth: number;
    targetHeight: number;
  }> = [];
  const clipCalls: string[] = [];
  const fakeContext = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    clip: () => {
      clipCalls.push('clip');
    },
    fillRect: () => undefined,
    fillText: () => undefined,
    drawImage: (
      _image: CanvasImageSource,
      sourceX: number,
      sourceY: number,
      sourceWidth: number,
      sourceHeight: number,
      targetX: number,
      targetY: number,
      targetWidth: number,
      targetHeight: number,
    ) => {
      drawCalls.push({
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        targetX,
        targetY,
        targetWidth,
        targetHeight,
      });
    },
    createLinearGradient: () => ({
      addColorStop: () => undefined,
    }),
    fillStyle: '',
    font: '',
    textAlign: 'left' as const,
    textBaseline: 'alphabetic' as const,
  } as unknown as CanvasRenderingContext2D;

  drawCanvasImageRasterLayer(fakeContext, {
    items: [{
      nodeId: 'low-zoom-wide-image',
      fileName: 'low-zoom-wide-image.png',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      status: 'ready',
      src: 'blob:wide',
    }],
    viewport: { x: 0, y: 0, zoom: 0.08 },
    canvasSize: { width: 400, height: 300 },
    resolveImage: () => ({
      naturalWidth: 1600,
      naturalHeight: 900,
      width: 1600,
      height: 900,
    } as unknown as CanvasImageSource),
  });

  assert.deepEqual(clipCalls, []);
  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0]?.targetX, 0);
  assert.equal(drawCalls[0]?.targetY, 0);
  assert.equal(drawCalls[0]?.targetWidth, 8);
  assert.equal(drawCalls[0]?.targetHeight, 8);
  assert.equal(drawCalls[0]?.sourceX, 350);
  assert.equal(drawCalls[0]?.sourceY, 0);
  assert.equal(drawCalls[0]?.sourceWidth, 900);
  assert.equal(drawCalls[0]?.sourceHeight, 900);
});

test('drawCanvasImageRasterLayer draws cluster items without ready image sources', () => {
  const calls: string[] = [];
  const fakeContext = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    fillRect: () => {
      calls.push('fillRect');
    },
    fillText: (_text: string) => {
      calls.push('fillText');
    },
    drawImage: () => {
      calls.push('drawImage');
    },
    createLinearGradient: () => ({
      addColorStop: () => undefined,
    }),
    fillStyle: '',
    font: '',
    textAlign: 'left' as const,
    textBaseline: 'alphabetic' as const,
  } as unknown as CanvasRenderingContext2D;

  const result = drawCanvasImageRasterLayer(fakeContext, {
    items: [{
      kind: 'cluster',
      nodeId: 'cluster:0:0',
      fileName: '12 images',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      status: 'cluster',
      clusterCount: 12,
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    canvasSize: { width: 400, height: 300 },
    resolveImage: () => undefined,
  });

  assert.equal(result.drawnItemCount, 1);
  assert.equal(result.placeholderItemCount, 0);
  assert.deepEqual(calls, ['fillRect', 'fillText']);
});

test('drawCanvasImageRasterLayer reports first paint only after a ready item resolves to a drawable image', () => {
  const painted: Array<{ nodeId: string; src: string }> = [];
  const fakeContext = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    drawImage: () => undefined,
    createLinearGradient: () => ({
      addColorStop: () => undefined,
    }),
    fillStyle: '',
    font: '',
    textAlign: 'left' as const,
    textBaseline: 'alphabetic' as const,
  } as unknown as CanvasRenderingContext2D;

  drawCanvasImageRasterLayer(fakeContext, {
    items: [
      {
        nodeId: 'painted',
        fileName: 'painted.png',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        rotation: 0,
        status: 'ready',
        src: 'blob:painted',
      },
      {
        nodeId: 'not-yet-drawable',
        fileName: 'not-yet-drawable.png',
        x: 120,
        y: 0,
        width: 100,
        height: 80,
        rotation: 0,
        status: 'ready',
        src: 'blob:not-yet-drawable',
      },
      {
        nodeId: 'loading',
        fileName: 'loading.png',
        x: 240,
        y: 0,
        width: 100,
        height: 80,
        rotation: 0,
        status: 'loading',
        src: 'blob:loading',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    canvasSize: { width: 400, height: 300 },
    resolveImage: (src) => (
      src === 'blob:painted'
        ? {
          width: 100,
          height: 80,
        } as unknown as CanvasImageSource
        : undefined
    ),
    onImagePainted: (item) => {
      painted.push(item);
    },
  });

  assert.deepEqual(painted, [{
    nodeId: 'painted',
    src: 'blob:painted',
  }]);
});

test('drawCanvasImageRasterLayer does not paint a dark placeholder for ready items before image cache resolves', () => {
  const calls: string[] = [];
  const fakeContext = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    fillRect: () => {
      calls.push('fillRect');
    },
    fillText: () => {
      calls.push('fillText');
    },
    drawImage: () => {
      calls.push('drawImage');
    },
    createLinearGradient: () => ({
      addColorStop: () => undefined,
    }),
    fillStyle: '',
    font: '',
    textAlign: 'left' as const,
    textBaseline: 'alphabetic' as const,
  } as unknown as CanvasRenderingContext2D;

  drawCanvasImageRasterLayer(fakeContext, {
    items: [{
      nodeId: 'ready-cache-miss',
      fileName: 'ready-cache-miss.png',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      rotation: 0,
      status: 'ready',
      src: 'blob:ready-cache-miss',
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    canvasSize: { width: 400, height: 300 },
    resolveImage: () => undefined,
  });

  assert.deepEqual(calls, []);
});

test('shouldDrawCanvasImageRasterPlaceholder still keeps loading and unavailable placeholders', () => {
  assert.equal(shouldDrawCanvasImageRasterPlaceholder({
    nodeId: 'loading',
    fileName: 'loading.png',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    status: 'loading',
    src: 'blob:loading',
  }, false), true);

  assert.equal(shouldDrawCanvasImageRasterPlaceholder({
    nodeId: 'ready-cache-miss',
    fileName: 'ready-cache-miss.png',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    status: 'ready',
    src: 'blob:ready-cache-miss',
  }, false), false);
});
