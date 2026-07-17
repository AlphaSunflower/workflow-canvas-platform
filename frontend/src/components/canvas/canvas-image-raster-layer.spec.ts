import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCanvasImageRasterItems, type CanvasImageRasterItem } from './canvas-image-raster-draw';
import { resolveCanvasImagePixiCoverTextureDescriptor } from './canvas-image-pixi-cover';
import { filterRasterItemsByRenderPlan } from './canvas-raster-item-filter';
import type { CanvasRenderPlan } from './canvas-render-plan';

test('buildCanvasImageRasterItems returns thumbnail-backed raster items only', () => {
  const items = buildCanvasImageRasterItems({
    nodes: [{
      id: 'node-1',
      type: 'image',
      position: { x: 0, y: 0 },
      data: {
        id: { value: 'node-1', display: '#1' },
        type: 'image',
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 120 },
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 0,
        timestamp: { created: 1, updated: 1 },
        fileId: 'file-1',
        fileName: 'node-1.png',
        fileSize: 1024,
        mimeType: 'image/png',
        source: { type: 'imported', importMethod: 'local', importedAt: 1 },
        metadata: {},
      },
      width: 200,
      height: 120,
      selected: false,
    }] as never,
    visibleNodes: new Map([['node-1', {
      isVisible: true,
      isNearViewport: true,
      displayWidth: 200,
      displayHeight: 120,
      visibilityBucket: 'visible',
      visibilityScoreBucket: 'ready',
      visibilityAreaBucket: 'ready',
      visibleAreaRatio: 1,
      viewportZoom: 1,
      visibilityScore: 0.9,
      centerDistance: 0,
      isSelected: false,
      isRecentlyInteracted: false,
      isImporting: false,
      renderTier: 'full',
    }]]),
    rasterEligibleNodeIds: new Set(['node-1']),
    getResourceState: () => ({
      src: 'blob:thumb',
      status: 'ready',
    }),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.src, 'blob:thumb');
  assert.equal(items[0]?.status, 'ready');
});

test('buildCanvasImageRasterItems can report ready before raster layer has a drawable image object', () => {
  const items = buildCanvasImageRasterItems({
    nodes: [({
      id: 'node-1',
      type: 'image',
      position: { x: 0, y: 0 },
      data: {
        id: { value: 'node-1', display: '#1' },
        type: 'image',
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 120 },
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 0,
        timestamp: { created: 1, updated: 1 },
        fileId: 'file-1',
        fileName: 'node-1.png',
        fileSize: 1024,
        mimeType: 'image/png',
        source: { type: 'imported', importMethod: 'local', importedAt: 1 },
        metadata: {},
      },
      width: 200,
      height: 120,
      selected: false,
    })] as never,
    visibleNodes: new Map([['node-1', {
      isVisible: true,
      isNearViewport: true,
      displayWidth: 200,
      displayHeight: 120,
      visibilityBucket: 'visible',
      visibilityScoreBucket: 'ready',
      visibilityAreaBucket: 'ready',
      visibleAreaRatio: 1,
      viewportZoom: 1,
      visibilityScore: 0.9,
      centerDistance: 0,
      isSelected: false,
      isRecentlyInteracted: false,
      isImporting: false,
      renderTier: 'full',
    }]]),
    rasterEligibleNodeIds: new Set(['node-1']),
    getResourceState: () => ({
      src: 'blob:thumb-ready-before-paint',
      status: 'ready',
    }),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, 'ready');
  assert.equal(items[0]?.src, 'blob:thumb-ready-before-paint');
});

test('CanvasImageRasterLayer consumes render plan image candidates instead of full canvas nodes', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/CanvasImageRasterLayer.tsx`,
    'utf8',
  );
  const propsBlock = source.slice(
    source.indexOf('interface CanvasImageRasterLayerProps'),
    source.indexOf('interface RasterImageCacheEntry'),
  );

  assert.equal(propsBlock.includes("renderPlan: Pick<CanvasRenderPlan, 'rasterEligibleImageNodes' | 'imageNodeIds' | 'renderedNodes'>;"), true);
  assert.equal(/^\s+nodes\s*:/m.test(propsBlock), false);
  assert.equal(source.includes('buildCanvasImageResourceSnapshot({'), false);
  assert.equal(source.includes('RASTER_RESOURCE_ZOOM_STABLE_DELAY_MS'), true);
  assert.equal(source.includes('const [isZoomSettling, setIsZoomSettling] = useState(false);'), true);
  assert.equal(source.includes('const hasZoomChangedSinceLastRender = Math.abs(viewport.zoom - previousZoomRef.current) >= 0.001;'), true);
  assert.equal(source.includes('const shouldDeferRasterResourceWork = isZoomSettling || hasZoomChangedSinceLastRender;'), true);
  assert.equal(source.includes('const shouldReuseStableItems = deferResourceRequests && stableItemsRef.current.length > 0;'), true);
  assert.equal(source.includes('useSyncExternalStore('), true);
  assert.equal(source.includes('canvasRasterReadyStore.subscribe'), true);
  assert.equal(source.includes("reason: 'ready-store-snapshot'"), true);
  assert.equal(source.includes('setIsZoomSettling(true);'), true);
  assert.equal(source.includes('setIsZoomSettling(false);'), true);
  assert.equal(source.includes('controllerRef.current?.pauseRequests();'), true);
  assert.equal(source.includes('controllerRef.current?.resumeRequests();'), true);
  assert.equal(source.includes('controllerRef.current?.update({'), true);
  assert.equal(source.includes('const itemSignature = useMemo(() => ('), true);
  assert.equal(source.includes('createCanvasImageResourceController({'), true);
  assert.equal(source.includes('buildCanvasImageLodPlan'), true);
  assert.equal(source.includes('lodRasterEligibleImageNodes: lodPlan.rasterEligibleImageNodes'), true);
  assert.equal(source.includes('registerCanvasRasterBridgeNodes'), false);
  assert.equal(source.includes('requestCanvasRasterBridgeResource'), false);
  assert.equal(source.includes('cancelCanvasRasterBridgeResourceRequest'), false);
  assert.equal(source.includes('imageManager.subscribe'), false);
  assert.equal(source.includes('bumpRenderVersion'), false);
  assert.equal(source.includes('clearCanvasImageFirstPaint,'), true);
  assert.equal(source.includes('retainCanvasImageFirstPaintNodeIds(renderPlan.imageNodeIds)'), true);
  assert.equal(source.includes('canvasRasterReadyStore.retainNodeIds(renderPlan.imageNodeIds)'), true);
  assert.equal(source.includes('data-raster-candidate-count='), true);
  assert.equal(source.includes('data-raster-source-candidate-count='), true);
  assert.equal(source.includes('data-raster-lod-mode='), true);
});

test('CanvasImageRasterLayer defers zoom resource work without rebuilding from full nodes', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/CanvasImageRasterLayer.tsx`,
    'utf8',
  );
  const useRasterItemsBlock = source.slice(
    source.indexOf('function useRasterItems('),
    source.indexOf('export function CanvasImageRasterLayer', source.indexOf('function useRasterItems(')),
  );

  assert.equal(useRasterItemsBlock.includes('stableItemsRef'), true);
  assert.equal(useRasterItemsBlock.includes('const shouldReuseStableItems = deferResourceRequests && stableItemsRef.current.length > 0;'), true);
  assert.equal(useRasterItemsBlock.includes('const retainedItems = shouldReuseStableItems'), true);
  assert.equal(useRasterItemsBlock.includes('const lodPlan = useMemo(() => buildCanvasImageLodPlan({'), true);
  assert.equal(useRasterItemsBlock.includes('const items = useMemo(() => ('), true);
  assert.equal(useRasterItemsBlock.includes("lodPlan.mode === 'cluster'"), true);
  assert.equal(useRasterItemsBlock.includes('filterRasterItemsByRenderPlan('), true);
  assert.equal(useRasterItemsBlock.includes('stableItemsRef.current = readySnapshot.items;'), true);
  assert.ok(
    useRasterItemsBlock.indexOf('filterRasterItemsByRenderPlan(') <
      useRasterItemsBlock.indexOf('schedulerMetricContextRef.current = {'),
  );
  assert.equal(useRasterItemsBlock.includes('deferResourceRequests,'), true);
  assert.equal(useRasterItemsBlock.includes('controllerRef.current?.pauseRequests();'), true);
  assert.equal(useRasterItemsBlock.includes('controllerRef.current?.commitReadySnapshotFromUpdate({'), true);
  assert.equal(useRasterItemsBlock.includes('lodRasterEligibleImageNodes: lodPlan.rasterEligibleImageNodes'), true);
  assert.equal(useRasterItemsBlock.includes('controllerRef.current?.resumeRequests();'), true);
  assert.equal(useRasterItemsBlock.includes('buildCanvasImageResourceSnapshot({'), false);
  assert.equal(useRasterItemsBlock.includes('controllerRef.current?.update({'), true);
  assert.equal(useRasterItemsBlock.includes('canvasRasterReadyStore.getSnapshot'), true);
  assert.equal(useRasterItemsBlock.includes('nodes.map('), false);
  assert.equal(useRasterItemsBlock.includes('nodes.filter('), false);
});

test('CanvasImageRasterLayer invalidates stale first-paint markers while DOM owns active image nodes', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/CanvasImageRasterLayer.tsx`,
    'utf8',
  );
  const activeInvalidationBlock = source.slice(
    source.indexOf('  useEffect(() => {\n    activeImageNodeIdSet.forEach((nodeId) => {'),
    source.indexOf('  useEffect(() => {\n    const liveSources', source.indexOf('  useEffect(() => {\n    activeImageNodeIdSet.forEach((nodeId) => {')),
  );

  assert.equal(activeInvalidationBlock.includes('activeImageNodeIdSet.forEach((nodeId) => {'), true);
  assert.equal(activeInvalidationBlock.includes('clearCanvasImageFirstPaint(nodeId);'), true);
  assert.equal(activeInvalidationBlock.includes('}, [activeImageNodeIdSet]);'), true);
});

test('CanvasImageRasterLayer keeps zoom transform until the target viewport draw commits', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/CanvasImageRasterLayer.tsx`,
    'utf8',
  );
  const drawBlock = source.slice(
    source.indexOf('  const draw = useCallback((): void => {'),
    source.indexOf('  const scheduleDraw = useCallback((): void => {'),
  );
  const canvasCommitBlock = drawBlock.slice(
    drawBlock.lastIndexOf('    if (!drawResult.budgetExhausted) {'),
  );
  const drawScheduleBlock = source.slice(
    source.indexOf('  useEffect(() => {\n    if (isZoomSettling) {'),
    source.indexOf('  useEffect(() => {\n    if (!canvasRef.current', source.indexOf('  useEffect(() => {\n    if (isZoomSettling) {')),
  );
  const transformEffectBlock = source.slice(
    source.indexOf('    const zoomTransform = ('),
    source.indexOf('  useEffect(() => () => {'),
  );

  assert.equal(source.includes('function areCanvasRasterViewportsAligned('), true);
  assert.equal(source.includes('const latestViewportRef = useRef<Viewport>(viewport);'), true);
  assert.equal(source.includes('latestViewportRef.current = viewport;'), true);
  assert.equal(source.includes('const applyRasterCanvasTransform = useCallback((matrix: string): void => {'), true);
  assert.equal(source.includes('const syncRasterCanvasTransformAfterDraw = useCallback((drawnViewport: Viewport): void => {'), true);
  assert.equal(source.includes('const latestViewport = latestViewportRef.current;'), true);
  assert.equal(source.includes('if (areCanvasRasterViewportsAligned(drawnViewport, latestViewport)) {'), true);
  assert.equal(source.includes('computeCanvasDragRenderTransform(drawnViewport, latestViewport).matrix'), true);
  assert.equal(drawBlock.includes('syncRasterCanvasTransformAfterDraw(nextState.viewport);'), true);
  assert.equal(drawBlock.includes('const useViewportHandoffBuffer = shouldUseRasterViewportHandoff(nextState.viewport);'), true);
  assert.equal(drawBlock.includes('const targetContext = useViewportHandoffBuffer'), true);
  assert.equal(canvasCommitBlock.includes('context.drawImage(targetCanvas, 0, 0);'), true);
  assert.equal(canvasCommitBlock.includes('lastDrawViewportRef.current = nextState.viewport;'), true);
  assert.equal(canvasCommitBlock.includes('syncRasterCanvasTransformAfterDraw(nextState.viewport);'), true);
  assert.ok(
    canvasCommitBlock.indexOf('lastDrawViewportRef.current = nextState.viewport;') <
      canvasCommitBlock.indexOf('syncRasterCanvasTransformAfterDraw(nextState.viewport);'),
  );
  assert.equal(drawScheduleBlock.includes('pendingRedrawRef.current = true;'), true);
  assert.equal(drawScheduleBlock.includes('!areCanvasRasterViewportsAligned(lastDrawViewportRef.current, drawViewport)'), true);
  assert.equal(drawScheduleBlock.includes('forceDrawRequestedRef.current = true;'), true);
  assert.equal(transformEffectBlock.includes('!areCanvasRasterViewportsAligned(lastDrawViewportRef.current, viewport)'), true);
  assert.equal(transformEffectBlock.includes('applyRasterCanvasTransform(interactionTransform.matrix);'), true);
  assert.equal(transformEffectBlock.includes('clearRasterCanvasTransform();'), true);
  assert.equal(transformEffectBlock.includes('isZoomSettling &&'), false);
});

test('CanvasImageRasterLayer wires Pixi renderer behind canvas fallback', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/CanvasImageRasterLayer.tsx`,
    'utf8',
  );
  const pixiRendererSource = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/canvas-image-pixi-renderer.ts`,
    'utf8',
  );

  assert.equal(source.includes('CanvasImagePixiRenderer'), true);
  assert.equal(source.includes('PIXI_RENDERER_ENABLED'), true);
  assert.equal(source.includes("data-raster-backend={pixiRendererRef.current ? 'pixi' : 'canvas2d'}"), true);
  assert.equal(source.includes("type: 'raster.pixiFallback'"), true);
  assert.equal(source.includes("type: 'raster.backendFallback'"), true);
  assert.equal(source.includes("type: 'raster.textureUpload'"), true);
  assert.equal(source.includes("type: 'raster.textureEvict'"), true);
  assert.equal(source.includes("type: 'raster.spritePool'"), true);
  assert.equal(source.includes("backend: 'pixi'"), true);
  assert.equal(source.includes('setCanvasFallbackVisible(false);'), true);
  assert.equal(source.includes('setCanvasFallbackVisible(true);'), true);
  assert.equal(source.includes('className="canvas-image-raster-canvas2d"'), true);
  assert.equal(source.includes('PIXI_TEXTURE_UPLOAD_BUDGET_IDLE'), true);
  assert.equal(source.includes('PIXI_TEXTURE_UPLOAD_BUDGET_INTERACTING'), true);
  assert.equal(source.includes('textureUploadBudget:'), true);
  assert.equal(source.includes('draggingRef.current || zoomSettlingRef.current'), true);
  assert.equal(source.includes('[canvas, pixiCanvas].forEach'), true);
  assert.equal(pixiRendererSource.includes("from 'pixi.js'"), true);
  assert.equal(pixiRendererSource.includes("preference: 'webgl'"), true);
  assert.equal(pixiRendererSource.includes('new Sprite(texture)'), true);
  assert.equal(pixiRendererSource.includes('Texture.from(image, true)'), true);
  assert.equal(pixiRendererSource.includes('this.stage.position.set(viewport.x, viewport.y)'), true);
  assert.equal(pixiRendererSource.includes('this.stage.scale.set(viewport.zoom || 1)'), true);
});

test('CanvasImagePixiRenderer retains textures, budgets uploads, and pools sprites', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const pixiRendererSource = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/canvas-image-pixi-renderer.ts`,
    'utf8',
  );
  const schemaSource = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/tools/canvas-performance-recorder/schema.ts`,
    'utf8',
  );
  const performanceSource = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/utils/performance/canvas-image-performance.ts`,
    'utf8',
  );

  assert.equal(pixiRendererSource.includes('PIXI_TEXTURE_RETENTION_MS'), true);
  assert.equal(pixiRendererSource.includes('PIXI_TEXTURE_MAX_COUNT'), true);
  assert.equal(pixiRendererSource.includes('PIXI_TEXTURE_MAX_BYTES'), true);
  assert.equal(pixiRendererSource.includes('DEFAULT_TEXTURE_UPLOAD_BUDGET'), true);
  assert.equal(pixiRendererSource.includes('remainingTextureUploads'), true);
  assert.equal(pixiRendererSource.includes('deferredItemCount += 1'), true);
  assert.equal(pixiRendererSource.includes('private readonly spritePool: Sprite[] = []'), true);
  assert.equal(pixiRendererSource.includes('sourceWidth: number;'), true);
  assert.equal(pixiRendererSource.includes('image?: HTMLImageElement'), true);
  assert.equal(pixiRendererSource.includes('resolveImage(item.src)'), true);
  assert.equal(pixiRendererSource.includes('Rectangle'), true);
  assert.equal(pixiRendererSource.includes('function buildCoverTextureDescriptor('), true);
  assert.equal(pixiRendererSource.includes('const nextCoverTexture = buildCoverTextureDescriptor(textureEntry, item);'), true);
  assert.equal(pixiRendererSource.includes('if (entry.cropKey === nextCoverTexture.cropKey) {'), true);
  assert.equal(pixiRendererSource.includes('return entry.texture;'), true);
  assert.equal(pixiRendererSource.includes('frame: new Rectangle('), true);
  assert.equal(pixiRendererSource.includes('entry.sprite.width = item.width'), true);
  assert.equal(pixiRendererSource.includes('entry.sprite.height = item.height'), true);
  assert.equal(pixiRendererSource.includes('this.spritePool.pop() ?? new Sprite(texture)'), true);
  assert.equal(pixiRendererSource.includes('this.spritePool.push(entry.sprite)'), true);
  assert.equal(pixiRendererSource.includes('entry.sprite.texture = Texture.EMPTY'), true);
  assert.equal(pixiRendererSource.includes('private readonly clusterBackgroundsByNodeId = new Map<string, Graphics>()'), true);
  assert.equal(pixiRendererSource.includes('private resolveItemTexture('), true);
  assert.equal(pixiRendererSource.includes('private clearOwnedTexture('), true);
  assert.equal(pixiRendererSource.includes('private evictTextures('), true);
  assert.equal(pixiRendererSource.includes('if (liveTextureSrcs.has(entry.src))'), true);
  assert.equal(pixiRendererSource.includes('now - entry.lastVisibleAt >= PIXI_TEXTURE_RETENTION_MS'), true);
  assert.equal(pixiRendererSource.includes('removeStaleTextures'), false);
  assert.equal(pixiRendererSource.includes('removeStaleSprites'), false);
  assert.equal(schemaSource.includes("'raster.backendFallback'"), true);
  assert.equal(schemaSource.includes("'raster.textureUpload'"), true);
  assert.equal(schemaSource.includes("'raster.textureEvict'"), true);
  assert.equal(schemaSource.includes("'raster.spritePool'"), true);
  assert.equal(performanceSource.includes('textureUploadCount?: number;'), true);
  assert.equal(performanceSource.includes('maxTextureRetainedCount?: number;'), true);
  assert.equal(performanceSource.includes('maxSpritePoolSize?: number;'), true);
});

function createRasterItem(nodeId: string, overrides: Partial<CanvasImageRasterItem> = {}): CanvasImageRasterItem {
  return {
    nodeId,
    fileName: `${nodeId}.png`,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    status: 'ready',
    src: `blob:${nodeId}`,
    resourceSrc: `blob:${nodeId}`,
    ...overrides,
  };
}

function createRasterEligibleImageNode(
  id: string,
  imageResourceOwner: 'raster' | 'dom' | 'none' = 'raster',
): CanvasRenderPlan['rasterEligibleImageNodes'][number] {
  return {
    id,
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      id: { value: id, display: `#${id}` },
      type: 'image',
      position: { x: 0, y: 0 },
      dimensions: { width: 100, height: 100 },
      rotation: 0,
      scale: 1,
      locked: false,
      status: 'idle',
      zIndex: 0,
      timestamp: { created: 1, updated: 1 },
      fileId: `file-${id}`,
      fileName: `${id}.png`,
      fileSize: 100,
      mimeType: 'image/png',
      source: { type: 'imported', importMethod: 'local', importedAt: 1 },
      metadata: {},
      imageResourceOwner,
    },
    width: 100,
    height: 100,
    selected: false,
  } as CanvasRenderPlan['rasterEligibleImageNodes'][number];
}

test('filterRasterItemsByRenderPlan removes deleted active and DOM-owned ready items immediately', () => {
  const items = [
    createRasterItem('raster-node'),
    createRasterItem('dom-node'),
    createRasterItem('active-node'),
    createRasterItem('deleted-node'),
  ];

  const filtered = filterRasterItemsByRenderPlan(
    items,
    [
      createRasterEligibleImageNode('raster-node', 'raster'),
      createRasterEligibleImageNode('dom-node', 'dom'),
      createRasterEligibleImageNode('active-node', 'raster'),
    ],
    new Set(['active-node']),
  );

  assert.deepEqual(filtered.map((item) => item.nodeId), ['raster-node']);
});

test('filterRasterItemsByRenderPlan keeps full proxy items when render plan injects raster owner', () => {
  const originalNode = createRasterEligibleImageNode('full-proxy-node');
  const renderedNode = {
    ...originalNode,
    data: {
      ...originalNode.data,
      renderTier: 'full' as const,
      activeState: 'passive' as const,
      imageResourceOwner: 'raster' as const,
    },
  };
  const filtered = filterRasterItemsByRenderPlan(
    [createRasterItem('full-proxy-node')],
    [renderedNode],
    new Set(),
  );

  assert.deepEqual(filtered.map((item) => item.nodeId), ['full-proxy-node']);
});

test('CanvasImagePixi cover descriptor is stable until source or target geometry changes', () => {
  const first = resolveCanvasImagePixiCoverTextureDescriptor({
    src: 'blob:image',
    sourceWidth: 1600,
    sourceHeight: 900,
    itemWidth: 400,
    itemHeight: 300,
  });
  const same = resolveCanvasImagePixiCoverTextureDescriptor({
    src: 'blob:image',
    sourceWidth: 1600,
    sourceHeight: 900,
    itemWidth: 400,
    itemHeight: 300,
  });
  const resized = resolveCanvasImagePixiCoverTextureDescriptor({
    src: 'blob:image',
    sourceWidth: 1600,
    sourceHeight: 900,
    itemWidth: 300,
    itemHeight: 300,
  });
  const replacedSource = resolveCanvasImagePixiCoverTextureDescriptor({
    src: 'blob:image-v2',
    sourceWidth: 1600,
    sourceHeight: 900,
    itemWidth: 400,
    itemHeight: 300,
  });

  assert.equal(first.cropKey, same.cropKey);
  assert.equal(first.cropKey === resized.cropKey, false);
  assert.equal(first.cropKey === replacedSource.cropKey, false);
  assert.equal(first.sourceWidth, 1200);
  assert.equal(first.sourceHeight, 900);
  assert.equal(first.sourceX, 200);
  assert.equal(first.sourceY, 0);
});
