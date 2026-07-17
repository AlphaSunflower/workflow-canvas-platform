import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useViewport } from 'reactflow';

import type { VisibleNodeMap } from '@/hooks/canvas/useVisibleNodes';
import { imageThumbnailRuntimeStore } from '@/services/image/image-thumbnail-runtime-store';
import type { Viewport } from '@/types';
import {
  getCanvasImageDiagnosticsConfig,
  recordCanvasTraceEvent,
  recordCanvasRasterMetric,
  recordCanvasRasterRebuild,
} from '@/utils/performance';

import {
  drawCanvasImageRasterLayer,
  type CanvasImageRasterItem,
} from './canvas-image-raster-draw';
import {
  CanvasImagePixiRenderer,
  type CanvasImagePixiRenderResult,
} from './canvas-image-pixi-renderer';
import {
  buildCanvasImageLodPlan,
  type CanvasImageLodMode,
} from './canvas-image-lod';
import {
  clearCanvasImageFirstPaint,
  markCanvasImageFirstPainted,
  retainCanvasImageFirstPaintNodeIds,
} from './canvas-image-first-paint-store';
import {
  computeCanvasDragRenderTransform,
  type CanvasDragRenderSnapshot,
} from './canvas-drag-render-coordinator';
import {
  reportCanvasRasterImageLoadFailure,
} from './canvas-raster-image-resource-bridge';
import {
  type CanvasRasterResourceSchedulerMetric,
} from './canvas-raster-resource-scheduler';
import {
  buildCanvasImageResourceMetricContext,
  createCanvasImageResourceController,
  recordCanvasImageResourceControllerBatch,
  type CanvasImageResourceController,
  type CanvasImageResourceControllerMetricContext,
} from './canvas-image-resource-controller';
import type { CanvasRenderPlan } from './canvas-render-plan';
import { canvasRasterReadyStore } from './canvas-raster-ready-store';
import { filterRasterItemsByRenderPlan } from './canvas-raster-item-filter';

const RASTER_IMAGE_FAILURE_SUPPRESSION_MS = 3_000;
const RASTER_RESOURCE_ZOOM_STABLE_DELAY_MS = 160;
const RASTER_IMAGE_CACHE_RETENTION_MS = 4_000;
const RASTER_DRAW_FRAME_BUDGET_MS = 7;
const PIXI_RENDERER_ENABLED = true;
const PIXI_RENDERER_FAILURE_SUPPRESSION_MS = 5_000;
const PIXI_TEXTURE_UPLOAD_BUDGET_IDLE = 8;
const PIXI_TEXTURE_UPLOAD_BUDGET_INTERACTING = 0;
const RASTER_VIEWPORT_TRANSLATE_EPSILON = 0.5;
const RASTER_VIEWPORT_ZOOM_EPSILON = 0.001;

interface CanvasImageRasterLayerProps {
  renderPlan: Pick<CanvasRenderPlan, 'rasterEligibleImageNodes' | 'imageNodeIds' | 'renderedNodes'>;
  visibleNodes: VisibleNodeMap;
  activeImageNodeIdSet: ReadonlySet<string>;
  canvasSize: {
    width: number;
    height: number;
  };
  dragRenderState?: Pick<CanvasDragRenderSnapshot, 'isDragging' | 'anchorViewport'>;
}

interface RasterImageCacheEntry {
  image: HTMLImageElement;
  status: 'loading' | 'ready' | 'error';
}

interface RasterItemStatusCounts {
  ready: number;
  loading: number;
  unavailable: number;
  cluster: number;
}

function areCanvasRasterViewportsAligned(
  left: Viewport | null,
  right: Viewport | null,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    Math.abs(left.x - right.x) <= RASTER_VIEWPORT_TRANSLATE_EPSILON &&
    Math.abs(left.y - right.y) <= RASTER_VIEWPORT_TRANSLATE_EPSILON &&
    Math.abs(left.zoom - right.zoom) <= RASTER_VIEWPORT_ZOOM_EPSILON
  );
}

function countRasterItemStatuses(items: readonly CanvasImageRasterItem[]): RasterItemStatusCounts {
  return items.reduce((counts, item) => {
    if (item.status === 'ready') {
      counts.ready += 1;
    } else if (item.status === 'loading') {
      counts.loading += 1;
    } else if (item.status === 'unavailable') {
      counts.unavailable += 1;
    } else if (item.status === 'cluster') {
      counts.cluster += 1;
    }

    return counts;
  }, {
    ready: 0,
    loading: 0,
    unavailable: 0,
    cluster: 0,
  });
}

function useRasterItems(
  renderPlan: Pick<CanvasRenderPlan, 'rasterEligibleImageNodes' | 'renderedNodes'>,
  visibleNodes: VisibleNodeMap,
  activeImageNodeIdSet: ReadonlySet<string>,
  deferResourceRequests: boolean,
  viewport: Viewport,
  canvasSize: CanvasImageRasterLayerProps['canvasSize'],
): {
  items: CanvasImageRasterItem[];
  lodMode: CanvasImageLodMode;
  sourceCandidateCount: number;
  visibleCandidateCount: number;
} {
  const rasterEligibleImageNodes = renderPlan.rasterEligibleImageNodes;
  const [runtimeRegistrationRevision, bumpRuntimeRegistrationRevision] = useState(0);
  const stableItemsRef = useRef<readonly CanvasImageRasterItem[]>([]);
  const schedulerMetricContextRef = useRef<CanvasImageResourceControllerMetricContext & {
    candidateNodeCount: number;
  }>({
    itemCount: 0,
    activeImageNodeCount: 0,
    readyItemCount: 0,
    loadingItemCount: 0,
    unavailableItemCount: 0,
    candidateNodeCount: 0,
  });
  const controllerRef = useRef<CanvasImageResourceController | null>(null);
  const diagnosticsEnabled = getCanvasImageDiagnosticsConfig().enabled;
  const shouldReuseStableItems = deferResourceRequests && stableItemsRef.current.length > 0;
  const readySnapshot = useSyncExternalStore(
    canvasRasterReadyStore.subscribe,
    canvasRasterReadyStore.getSnapshot,
    canvasRasterReadyStore.getSnapshot,
  );
  const recordedReadyStoreVersionRef = useRef(readySnapshot.version);
  const retainedItems = shouldReuseStableItems
    ? stableItemsRef.current
    : readySnapshot.items;
  const canvasWidth = canvasSize.width;
  const canvasHeight = canvasSize.height;
  const viewportX = viewport.x;
  const viewportY = viewport.y;
  const viewportZoom = viewport.zoom;
  const lodPlan = useMemo(() => buildCanvasImageLodPlan({
    nodes: rasterEligibleImageNodes,
    readyItems: retainedItems,
    viewport: {
      x: viewportX,
      y: viewportY,
      zoom: viewportZoom,
    },
    canvasSize: {
      width: canvasWidth,
      height: canvasHeight,
    },
    activeImageNodeIdSet,
  }), [
    activeImageNodeIdSet,
    canvasHeight,
    canvasWidth,
    rasterEligibleImageNodes,
    retainedItems,
    viewportX,
    viewportY,
    viewportZoom,
  ]);
  const items = useMemo(() => (
    lodPlan.mode === 'cluster'
      ? lodPlan.clusterItems
      : filterRasterItemsByRenderPlan(
        retainedItems,
        lodPlan.rasterEligibleImageNodes,
        activeImageNodeIdSet,
      )
  ), [
    activeImageNodeIdSet,
    lodPlan,
    retainedItems,
  ]);
  if (!shouldReuseStableItems) {
    stableItemsRef.current = readySnapshot.items;
  }
  schedulerMetricContextRef.current = {
    ...buildCanvasImageResourceMetricContext(items, activeImageNodeIdSet),
    candidateNodeCount: lodPlan.visibleNodeCount,
  };
  if (!controllerRef.current) {
    controllerRef.current = createCanvasImageResourceController({
      onBatch: (metric: CanvasRasterResourceSchedulerMetric) => {
        const context = schedulerMetricContextRef.current;
        recordCanvasImageResourceControllerBatch(metric, context);
      },
    });
  }

  useEffect(() => {
    if (
      !diagnosticsEnabled ||
      shouldReuseStableItems ||
      recordedReadyStoreVersionRef.current === readySnapshot.version
    ) {
      return;
    }

    recordedReadyStoreVersionRef.current = readySnapshot.version;
    const rasterItemStatusCounts = countRasterItemStatuses(items);
    recordCanvasRasterRebuild({
      reason: 'ready-store-snapshot',
      candidateNodeCount: lodPlan.visibleNodeCount,
      itemCount: items.length,
    });
    recordCanvasRasterMetric({
      reason: 'items-built',
      candidateNodeCount: lodPlan.visibleNodeCount,
      itemCount: items.length,
      registeredNodeCount: 0,
      requestedNodeCount: 0,
      activeImageNodeCount: activeImageNodeIdSet.size,
      readyItemCount: rasterItemStatusCounts.ready,
      loadingItemCount: rasterItemStatusCounts.loading,
      unavailableItemCount: rasterItemStatusCounts.unavailable,
    });
  }, [
    activeImageNodeIdSet.size,
    diagnosticsEnabled,
    items,
    lodPlan.visibleNodeCount,
    readySnapshot.version,
    shouldReuseStableItems,
  ]);

  useEffect(() => {
    if (deferResourceRequests) {
      controllerRef.current?.pauseRequests();
      controllerRef.current?.commitReadySnapshotFromUpdate({
        renderPlan,
        lodRasterEligibleImageNodes: lodPlan.rasterEligibleImageNodes,
        visibleNodes,
        activeImageNodeIdSet,
        runtimeRegistrationRevision,
        deferResourceRequests: true,
      });
      return;
    }

    controllerRef.current?.resumeRequests();
    controllerRef.current?.update({
      renderPlan,
      lodRasterEligibleImageNodes: lodPlan.rasterEligibleImageNodes,
      visibleNodes,
      activeImageNodeIdSet,
      runtimeRegistrationRevision,
      deferResourceRequests,
    });
  }, [
    activeImageNodeIdSet,
    deferResourceRequests,
    lodPlan,
    renderPlan,
    runtimeRegistrationRevision,
    visibleNodes,
  ]);

  useEffect(() => (): void => {
    controllerRef.current?.dispose();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    let frameId: number | null = null;
    const unsubscribe = imageThumbnailRuntimeStore.subscribeAll(() => {
      if (frameId !== null) {
        return;
      }

      frameId = requestAnimationFrame(() => {
        frameId = null;
        bumpRuntimeRegistrationRevision((version) => version + 1);
      });
    });

    return (): void => {
      unsubscribe();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return {
    items,
    lodMode: lodPlan.mode,
    sourceCandidateCount: lodPlan.sourceNodeCount,
    visibleCandidateCount: lodPlan.visibleNodeCount,
  };
}

export function CanvasImageRasterLayer({
  renderPlan,
  visibleNodes,
  activeImageNodeIdSet,
  canvasSize,
  dragRenderState,
}: CanvasImageRasterLayerProps): JSX.Element {
  const viewport = useViewport();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pixiRendererRef = useRef<CanvasImagePixiRenderer | null>(null);
  const pixiInitPromiseRef = useRef<Promise<void> | null>(null);
  const pixiRenderFailureRef = useRef(false);
  const lastPixiFailureReportedAtRef = useRef(0);
  const imageCacheRef = useRef<Map<string, RasterImageCacheEntry>>(new Map());
  const imageCacheRetainUntilRef = useRef<Map<string, number>>(new Map());
  const failedSourceReportedAtRef = useRef<Map<string, number>>(new Map());
  const frameRef = useRef<number | null>(null);
  const requestRedrawRef = useRef<() => void>(() => undefined);
  const zoomStableTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const zoomSettlingRef = useRef(false);
  const pendingRedrawRef = useRef(false);
  const pendingDrawStartIndexRef = useRef(0);
  const drawSignatureRef = useRef('');
  const lastDrawViewportRef = useRef<Viewport | null>(null);
  const latestViewportRef = useRef<Viewport>(viewport);
  const canvasHandoffBufferRef = useRef<HTMLCanvasElement | null>(null);
  const forceDrawRequestedRef = useRef(false);
  const [isZoomSettling, setIsZoomSettling] = useState(false);
  const previousZoomRef = useRef(viewport.zoom);
  const hasZoomChangedSinceLastRender = Math.abs(viewport.zoom - previousZoomRef.current) >= 0.001;
  const shouldDeferRasterResourceWork = isZoomSettling || hasZoomChangedSinceLastRender;
  const isDragging = Boolean(dragRenderState?.isDragging && dragRenderState.anchorViewport);
  zoomSettlingRef.current = isZoomSettling;
  latestViewportRef.current = viewport;
  const drawViewport: Viewport = useMemo(() => (
    isDragging && dragRenderState?.anchorViewport
      ? dragRenderState.anchorViewport
      : viewport
  ), [dragRenderState?.anchorViewport, isDragging, viewport]);
  const rasterState = useRasterItems(
    renderPlan,
    visibleNodes,
    activeImageNodeIdSet,
    shouldDeferRasterResourceWork,
    drawViewport,
    canvasSize,
  );
  const items = rasterState.items;
  const diagnosticsEnabled = getCanvasImageDiagnosticsConfig().enabled;
  const dragAnchorViewport = isDragging
    ? lastDrawViewportRef.current ?? dragRenderState?.anchorViewport ?? null
    : null;
  const dragTransform = useMemo(() => (
    isDragging && dragAnchorViewport
      ? computeCanvasDragRenderTransform(dragAnchorViewport, viewport)
      : null
  ), [dragAnchorViewport, isDragging, viewport]);
  const drawStateRef = useRef({
    items,
    lodMode: rasterState.lodMode,
    sourceCandidateCount: rasterState.sourceCandidateCount,
    visibleCandidateCount: rasterState.visibleCandidateCount,
    viewport: drawViewport,
    canvasSize,
    signature: '',
  });
  const itemSignature = useMemo(() => (
    items
      .map((item) => [
        item.nodeId,
        item.kind ?? 'image',
        item.x,
        item.y,
        item.width,
        item.height,
        item.rotation,
        item.status,
        item.src ?? '',
        item.clusterCount ?? '',
      ].join(':'))
      .join('|')
  ), [items]);
  const drawSignature = useMemo(() => [
    drawViewport.x,
    drawViewport.y,
    drawViewport.zoom,
    canvasSize.width,
    canvasSize.height,
    itemSignature,
  ].join('|'), [
    canvasSize.height,
    canvasSize.width,
    drawViewport.x,
    drawViewport.y,
    drawViewport.zoom,
    itemSignature,
  ]);

  drawStateRef.current = {
    items,
    lodMode: rasterState.lodMode,
    sourceCandidateCount: rasterState.sourceCandidateCount,
    visibleCandidateCount: rasterState.visibleCandidateCount,
    viewport: drawViewport,
    canvasSize,
    signature: drawSignature,
  };
  const handleImagePainted = useCallback((item: Pick<CanvasImageRasterItem, 'nodeId' | 'src'> & { src: string }): void => {
    markCanvasImageFirstPainted(item.nodeId, item.src);
  }, []);

  const reportPixiFailure = useCallback((reason: string): void => {
    const now = Date.now();
    if (now - lastPixiFailureReportedAtRef.current < PIXI_RENDERER_FAILURE_SUPPRESSION_MS) {
      return;
    }

    lastPixiFailureReportedAtRef.current = now;
    recordCanvasTraceEvent({
      type: 'raster.pixiFallback',
      phase: 'instant',
      data: {
        reason,
      },
    });
    recordCanvasTraceEvent({
      type: 'raster.backendFallback',
      phase: 'instant',
      data: {
        from: 'pixi',
        to: 'canvas2d',
        reason,
      },
    });
  }, []);

  const setCanvasFallbackVisible = useCallback((visible: boolean): void => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.style.opacity = visible ? '1' : '0';
  }, []);

  const applyRasterCanvasTransform = useCallback((matrix: string): void => {
    const canvas = canvasRef.current;
    const pixiCanvas = pixiRendererRef.current?.canvas ?? null;
    [canvas, pixiCanvas].forEach((element) => {
      if (!element) {
        return;
      }

      element.style.transformOrigin = '0 0';
      element.style.willChange = 'transform';
      element.style.transform = matrix;
    });
  }, []);

  const clearRasterCanvasTransform = useCallback((): void => {
    const canvas = canvasRef.current;
    const pixiCanvas = pixiRendererRef.current?.canvas ?? null;
    [canvas, pixiCanvas].forEach((element) => {
      if (!element) {
        return;
      }

      element.style.transform = '';
      element.style.transformOrigin = '';
      element.style.willChange = '';
    });
  }, []);

  const syncRasterCanvasTransformAfterDraw = useCallback((drawnViewport: Viewport): void => {
    if (draggingRef.current) {
      return;
    }

    const latestViewport = latestViewportRef.current;
    if (areCanvasRasterViewportsAligned(drawnViewport, latestViewport)) {
      clearRasterCanvasTransform();
      return;
    }

    applyRasterCanvasTransform(
      computeCanvasDragRenderTransform(drawnViewport, latestViewport).matrix,
    );
  }, [applyRasterCanvasTransform, clearRasterCanvasTransform]);

  const shouldUseRasterViewportHandoff = useCallback((drawnViewport: Viewport): boolean => (
    !draggingRef.current &&
    lastDrawViewportRef.current !== null &&
    !areCanvasRasterViewportsAligned(lastDrawViewportRef.current, drawnViewport)
  ), []);

  const getCanvasHandoffBuffer = useCallback((sourceCanvas: HTMLCanvasElement): HTMLCanvasElement => {
    const buffer = canvasHandoffBufferRef.current ?? document.createElement('canvas');
    canvasHandoffBufferRef.current = buffer;
    if (buffer.width !== sourceCanvas.width) {
      buffer.width = sourceCanvas.width;
    }
    if (buffer.height !== sourceCanvas.height) {
      buffer.height = sourceCanvas.height;
    }
    return buffer;
  }, []);

  const ensurePixiRenderer = useCallback((): CanvasImagePixiRenderer | null => {
    if (!PIXI_RENDERER_ENABLED || pixiRenderFailureRef.current) {
      return null;
    }

    const container = containerRef.current;
    if (!container) {
      return null;
    }

    const existing = pixiRendererRef.current;
    if (existing) {
      return existing;
    }

    if (pixiInitPromiseRef.current !== null) {
      return null;
    }

    pixiInitPromiseRef.current = CanvasImagePixiRenderer.create({
      canvasSize,
      devicePixelRatio: window.devicePixelRatio || 1,
      onImagePainted: handleImagePainted,
    })
      .then((renderer) => {
        if (!containerRef.current) {
          renderer.destroy();
          return;
        }

        pixiRendererRef.current = renderer;
        renderer.canvas.className = 'canvas-image-raster-pixi-canvas';
        renderer.canvas.style.width = '100%';
        renderer.canvas.style.height = '100%';
        renderer.canvas.style.pointerEvents = 'none';
        containerRef.current.appendChild(renderer.canvas);
        requestRedrawRef.current();
      })
      .catch((error: unknown) => {
        pixiRenderFailureRef.current = true;
        reportPixiFailure(error instanceof Error ? error.message : 'pixi init failed');
        setCanvasFallbackVisible(true);
      })
      .finally(() => {
        pixiInitPromiseRef.current = null;
      });

    return null;
  }, [
    canvasSize,
    handleImagePainted,
    reportPixiFailure,
    setCanvasFallbackVisible,
  ]);

  const draw = useCallback((): void => {
    forceDrawRequestedRef.current = false;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    const nextState = drawStateRef.current;
    const pixiRenderer = ensurePixiRenderer();
    if (pixiRenderer) {
      const startedAt = performance.now();
      let pixiResult: CanvasImagePixiRenderResult | null = null;
      try {
        pixiResult = pixiRenderer.render({
          items: nextState.items,
          viewport: nextState.viewport,
          canvasSize: nextState.canvasSize,
          devicePixelRatio: window.devicePixelRatio || 1,
          textureUploadBudget: (
            draggingRef.current || zoomSettlingRef.current
              ? PIXI_TEXTURE_UPLOAD_BUDGET_INTERACTING
              : PIXI_TEXTURE_UPLOAD_BUDGET_IDLE
          ),
          resolveImage: (src) => {
            const cached = imageCacheRef.current.get(src);
            return cached?.status === 'ready' ? cached.image : undefined;
          },
          onImagePainted: handleImagePainted,
        });
        setCanvasFallbackVisible(false);
      } catch (error) {
        pixiRenderFailureRef.current = true;
        pixiRenderer.destroy();
        pixiRendererRef.current = null;
        reportPixiFailure(error instanceof Error ? error.message : 'pixi render failed');
        setCanvasFallbackVisible(true);
      }

      if (pixiResult) {
        const durationMs = performance.now() - startedAt;
        const rasterItemStatusCounts = countRasterItemStatuses(nextState.items);
        recordCanvasTraceEvent({
          type: 'raster.draw',
          phase: 'end',
          durationMs,
          data: {
            backend: 'pixi',
            lodMode: nextState.lodMode,
            itemCount: nextState.items.length,
            sourceCandidateCount: nextState.sourceCandidateCount,
            visibleCandidateCount: nextState.visibleCandidateCount,
            readyCount: rasterItemStatusCounts.ready,
            loadingCount: rasterItemStatusCounts.loading,
            unavailableCount: rasterItemStatusCounts.unavailable,
            clusterCount: rasterItemStatusCounts.cluster,
            viewportZoom: nextState.viewport.zoom,
            dragging: draggingRef.current,
            zoomSettling: isZoomSettling,
            drawnItemCount: pixiResult.drawnItemCount,
            cacheMissItemCount: pixiResult.cacheMissItemCount,
            lodSkippedItemCount: pixiResult.lodSkippedItemCount,
            deferredItemCount: pixiResult.deferredItemCount,
            budgetExhausted: pixiResult.deferredItemCount > 0,
            textureUploadBudget: pixiResult.textureUploadBudget,
            textureUploadCount: pixiResult.textureUploadCount,
            textureEvictedCount: pixiResult.textureEvictedCount,
            textureRetainedCount: pixiResult.textureRetainedCount,
            textureByteEstimate: pixiResult.textureByteEstimate,
            activeSpriteCount: pixiResult.activeSpriteCount,
            spritePoolSize: pixiResult.spritePoolSize,
            createdSpriteCount: pixiResult.createdSpriteCount,
            reusedSpriteCount: pixiResult.reusedSpriteCount,
            releasedSpriteCount: pixiResult.releasedSpriteCount,
          },
        });
        if (pixiResult.textureUploadCount > 0) {
          recordCanvasTraceEvent({
            type: 'raster.textureUpload',
            phase: 'instant',
            data: {
              count: pixiResult.textureUploadCount,
              budget: pixiResult.textureUploadBudget,
              deferredItemCount: pixiResult.deferredItemCount,
              textureRetainedCount: pixiResult.textureRetainedCount,
            },
          });
        }
        if (pixiResult.textureEvictedCount > 0) {
          recordCanvasTraceEvent({
            type: 'raster.textureEvict',
            phase: 'instant',
            data: {
              count: pixiResult.textureEvictedCount,
              textureRetainedCount: pixiResult.textureRetainedCount,
              textureByteEstimate: pixiResult.textureByteEstimate,
            },
          });
        }
        if (
          pixiResult.createdSpriteCount > 0 ||
          pixiResult.reusedSpriteCount > 0 ||
          pixiResult.releasedSpriteCount > 0
        ) {
          recordCanvasTraceEvent({
            type: 'raster.spritePool',
            phase: 'instant',
            data: {
              createdSpriteCount: pixiResult.createdSpriteCount,
              reusedSpriteCount: pixiResult.reusedSpriteCount,
              releasedSpriteCount: pixiResult.releasedSpriteCount,
              activeSpriteCount: pixiResult.activeSpriteCount,
              spritePoolSize: pixiResult.spritePoolSize,
            },
          });
        }
        if (diagnosticsEnabled) {
          recordCanvasRasterMetric({
            reason: 'draw',
            candidateNodeCount: nextState.visibleCandidateCount,
            itemCount: nextState.items.length,
            registeredNodeCount: 0,
            requestedNodeCount: 0,
            activeImageNodeCount: activeImageNodeIdSet.size,
            readyItemCount: rasterItemStatusCounts.ready,
            loadingItemCount: rasterItemStatusCounts.loading,
            unavailableItemCount: rasterItemStatusCounts.unavailable,
            durationMs,
            drawnItemCount: pixiResult.drawnItemCount,
            deferredItemCount: pixiResult.deferredItemCount,
            lodSkippedItemCount: pixiResult.lodSkippedItemCount,
            budgetExhausted: pixiResult.deferredItemCount > 0,
            textureUploadCount: pixiResult.textureUploadCount,
            textureEvictedCount: pixiResult.textureEvictedCount,
            textureRetainedCount: pixiResult.textureRetainedCount,
            textureByteEstimate: pixiResult.textureByteEstimate,
            activeSpriteCount: pixiResult.activeSpriteCount,
            spritePoolSize: pixiResult.spritePoolSize,
          });
        }
        pendingDrawStartIndexRef.current = 0;
        lastDrawViewportRef.current = nextState.viewport;
        pendingRedrawRef.current = pixiResult.deferredItemCount > 0;
        syncRasterCanvasTransformAfterDraw(nextState.viewport);
        if (pixiResult.deferredItemCount > 0 && frameRef.current === null && !draggingRef.current && !zoomSettlingRef.current) {
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            draw();
          });
        }
        return;
      }
    }

    setCanvasFallbackVisible(true);
    const useViewportHandoffBuffer = shouldUseRasterViewportHandoff(nextState.viewport);
    const targetCanvas = useViewportHandoffBuffer
      ? getCanvasHandoffBuffer(canvas)
      : canvas;
    const targetContext = useViewportHandoffBuffer
      ? targetCanvas.getContext('2d')
      : context;
    if (!targetContext) {
      return;
    }

    const isContinuingDraw = (
      pendingDrawStartIndexRef.current > 0 &&
      drawSignatureRef.current === nextState.signature
    );
    if (!isContinuingDraw) {
      pendingDrawStartIndexRef.current = 0;
      drawSignatureRef.current = nextState.signature;
    }
    const startedAt = performance.now();
    const drawResult = drawCanvasImageRasterLayer(targetContext, {
      items: nextState.items,
      viewport: nextState.viewport,
      canvasSize: nextState.canvasSize,
      devicePixelRatio: window.devicePixelRatio || 1,
      startIndex: pendingDrawStartIndexRef.current,
      clear: !isContinuingDraw,
      maxDurationMs: RASTER_DRAW_FRAME_BUDGET_MS,
      resolveImage: (src) => {
        const cached = imageCacheRef.current.get(src);
        return cached?.status === 'ready' ? cached.image : undefined;
      },
      onImagePainted: handleImagePainted,
    });
    const durationMs = performance.now() - startedAt;
    pendingDrawStartIndexRef.current = drawResult.nextStartIndex;
    if (drawResult.budgetExhausted) {
      pendingRedrawRef.current = true;
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          if (draggingRef.current) {
            pendingRedrawRef.current = true;
            return;
          }
          draw();
        });
      }
    }
    const rasterItemStatusCounts = countRasterItemStatuses(nextState.items);
    recordCanvasTraceEvent({
      type: 'raster.draw',
      phase: 'end',
      durationMs,
      data: {
        lodMode: nextState.lodMode,
        itemCount: nextState.items.length,
        sourceCandidateCount: nextState.sourceCandidateCount,
        visibleCandidateCount: nextState.visibleCandidateCount,
        readyCount: rasterItemStatusCounts.ready,
        loadingCount: rasterItemStatusCounts.loading,
        unavailableCount: rasterItemStatusCounts.unavailable,
        clusterCount: rasterItemStatusCounts.cluster,
        viewportZoom: nextState.viewport.zoom,
        dragging: draggingRef.current,
        zoomSettling: isZoomSettling,
        drawnItemCount: drawResult.drawnItemCount,
        visitedItemCount: drawResult.visitedItemCount,
        placeholderItemCount: drawResult.placeholderItemCount,
        cacheMissItemCount: drawResult.cacheMissItemCount,
        lodSkippedItemCount: drawResult.lodSkippedItemCount,
        deferredItemCount: drawResult.deferredItemCount,
        budgetExhausted: drawResult.budgetExhausted,
      },
    });
    if (diagnosticsEnabled) {
      recordCanvasRasterMetric({
        reason: 'draw',
        candidateNodeCount: nextState.visibleCandidateCount,
        itemCount: nextState.items.length,
        registeredNodeCount: 0,
        requestedNodeCount: 0,
        activeImageNodeCount: activeImageNodeIdSet.size,
        readyItemCount: rasterItemStatusCounts.ready,
        loadingItemCount: rasterItemStatusCounts.loading,
        unavailableItemCount: rasterItemStatusCounts.unavailable,
        durationMs,
        drawnItemCount: drawResult.drawnItemCount,
        deferredItemCount: drawResult.deferredItemCount,
        lodSkippedItemCount: drawResult.lodSkippedItemCount,
        budgetExhausted: drawResult.budgetExhausted,
      });
    }
    if (!drawResult.budgetExhausted) {
      if (useViewportHandoffBuffer) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(targetCanvas, 0, 0);
      }
      lastDrawViewportRef.current = nextState.viewport;
      syncRasterCanvasTransformAfterDraw(nextState.viewport);
    }
    pendingRedrawRef.current = drawResult.budgetExhausted;
  }, [
    activeImageNodeIdSet.size,
    diagnosticsEnabled,
    ensurePixiRenderer,
    getCanvasHandoffBuffer,
    handleImagePainted,
    isZoomSettling,
    reportPixiFailure,
    setCanvasFallbackVisible,
    shouldUseRasterViewportHandoff,
    syncRasterCanvasTransformAfterDraw,
  ]);

  const scheduleDraw = useCallback((): void => {
    if (zoomSettlingRef.current && !forceDrawRequestedRef.current) {
      pendingRedrawRef.current = true;
      return;
    }

    if (draggingRef.current) {
      pendingRedrawRef.current = true;
      return;
    }

    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  }, [draw]);
  requestRedrawRef.current = scheduleDraw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const nextWidth = Math.max(1, Math.round(canvasSize.width * pixelRatio));
    const nextHeight = Math.max(1, Math.round(canvasSize.height * pixelRatio));
    if (canvas.width !== nextWidth) {
      canvas.width = nextWidth;
    }
    if (canvas.height !== nextHeight) {
      canvas.height = nextHeight;
    }
    if (draggingRef.current) {
      pendingRedrawRef.current = true;
      return;
    }
    scheduleDraw();
  }, [canvasSize.height, canvasSize.width, scheduleDraw]);

  useEffect(() => {
    draggingRef.current = isDragging;
    if (!isDragging && pendingRedrawRef.current) {
      scheduleDraw();
    }
  }, [isDragging, scheduleDraw]);

  useEffect(() => {
    if (Math.abs(viewport.zoom - previousZoomRef.current) < 0.001) {
      return;
    }

    previousZoomRef.current = viewport.zoom;
    setIsZoomSettling(true);
    if (zoomStableTimerRef.current !== null) {
      window.clearTimeout(zoomStableTimerRef.current);
    }
    zoomStableTimerRef.current = window.setTimeout(() => {
      zoomStableTimerRef.current = null;
      setIsZoomSettling(false);
    }, RASTER_RESOURCE_ZOOM_STABLE_DELAY_MS);
  }, [viewport.zoom]);

  useEffect(() => {
    retainCanvasImageFirstPaintNodeIds(renderPlan.imageNodeIds);
    canvasRasterReadyStore.retainNodeIds(renderPlan.imageNodeIds);
    forceDrawRequestedRef.current = true;
    pendingRedrawRef.current = true;
    scheduleDraw();
  }, [renderPlan.imageNodeIds, scheduleDraw]);

  useEffect(() => {
    activeImageNodeIdSet.forEach((nodeId) => {
      clearCanvasImageFirstPaint(nodeId);
    });
  }, [activeImageNodeIdSet]);

  useEffect(() => {
    const liveSources = new Set(items.map((item) => item.src).filter((src): src is string => Boolean(src)));
    const sourceItems = new Map<string, Array<Pick<CanvasImageRasterItem, 'nodeId'>>>();
    items.forEach((item) => {
      if (!item.src) {
        return;
      }

      const current = sourceItems.get(item.src) ?? [];
      current.push({
        nodeId: item.nodeId,
      });
      sourceItems.set(item.src, current);
    });

    const now = Date.now();
    imageCacheRef.current.forEach((entry, src) => {
      if (liveSources.has(src)) {
        imageCacheRetainUntilRef.current.delete(src);
        return;
      }

      const retainUntil = imageCacheRetainUntilRef.current.get(src) ?? (now + RASTER_IMAGE_CACHE_RETENTION_MS);
      imageCacheRetainUntilRef.current.set(src, retainUntil);
      if (retainUntil <= now) {
        entry.image.onload = null;
        entry.image.onerror = null;
        imageCacheRef.current.delete(src);
        imageCacheRetainUntilRef.current.delete(src);
        failedSourceReportedAtRef.current.delete(src);
      }
    });

    liveSources.forEach((src) => {
      if (imageCacheRef.current.has(src)) {
        return;
      }

      const lastFailureAt = failedSourceReportedAtRef.current.get(src) ?? 0;
      if (lastFailureAt > 0 && Date.now() - lastFailureAt < RASTER_IMAGE_FAILURE_SUPPRESSION_MS) {
        return;
      }

      const image = new Image();
      image.decoding = 'async';
      const entry: RasterImageCacheEntry = {
        image,
        status: 'loading',
      };
      image.onload = (): void => {
        entry.status = 'ready';
        scheduleDraw();
      };
      image.onerror = (): void => {
        entry.status = 'error';
        imageCacheRef.current.delete(src);
        const now = Date.now();
        const lastReportedAt = failedSourceReportedAtRef.current.get(src) ?? 0;
        if (now - lastReportedAt >= RASTER_IMAGE_FAILURE_SUPPRESSION_MS) {
          failedSourceReportedAtRef.current.set(src, now);
          const affectedItems = sourceItems.get(src) ?? [];
          affectedItems.forEach((item) => {
            reportCanvasRasterImageLoadFailure(
              item.nodeId,
              src,
              `Canvas raster image failed to load: ${src}`,
            );
          });
        }
        scheduleDraw();
      };
      imageCacheRef.current.set(src, entry);
      image.src = src;
    });
  }, [items, scheduleDraw]);

  useEffect(() => {
    if (isZoomSettling) {
      pendingRedrawRef.current = true;
      return;
    }

    if (
      pendingRedrawRef.current ||
      !areCanvasRasterViewportsAligned(lastDrawViewportRef.current, drawViewport)
    ) {
      forceDrawRequestedRef.current = true;
    }
    scheduleDraw();
  }, [drawSignature, drawViewport, isZoomSettling, scheduleDraw]);

  useEffect(() => {
    if (!canvasRef.current && !pixiRendererRef.current?.canvas) {
      return;
    }

    const zoomTransform = (
      !isDragging &&
      lastDrawViewportRef.current &&
      !areCanvasRasterViewportsAligned(lastDrawViewportRef.current, viewport)
    )
      ? computeCanvasDragRenderTransform(lastDrawViewportRef.current, viewport)
      : null;
    const interactionTransform = dragTransform ?? zoomTransform;

    if (interactionTransform) {
      applyRasterCanvasTransform(interactionTransform.matrix);
      return;
    }

    clearRasterCanvasTransform();
  }, [
    applyRasterCanvasTransform,
    clearRasterCanvasTransform,
    dragTransform,
    isDragging,
    viewport,
  ]);

  useEffect(() => () => {
    imageCacheRef.current.forEach((entry) => {
      entry.image.onload = null;
      entry.image.onerror = null;
    });
    imageCacheRef.current.clear();
    imageCacheRetainUntilRef.current.clear();
    failedSourceReportedAtRef.current.clear();
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (zoomStableTimerRef.current !== null) {
      window.clearTimeout(zoomStableTimerRef.current);
      zoomStableTimerRef.current = null;
    }
    pixiRendererRef.current?.destroy();
    pixiRendererRef.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      className="canvas-image-raster-layer"
      style={{
        width: canvasSize.width,
        height: canvasSize.height,
      }}
      aria-hidden="true"
      data-raster-item-count={import.meta.env?.DEV ? items.length : undefined}
      data-raster-candidate-count={import.meta.env?.DEV ? rasterState.visibleCandidateCount : undefined}
      data-raster-source-candidate-count={import.meta.env?.DEV ? rasterState.sourceCandidateCount : undefined}
      data-raster-lod-mode={import.meta.env?.DEV ? rasterState.lodMode : undefined}
      data-raster-backend={pixiRendererRef.current ? 'pixi' : 'canvas2d'}
    >
      <canvas
        ref={canvasRef}
        className="canvas-image-raster-canvas2d"
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}

CanvasImageRasterLayer.displayName = 'CanvasImageRasterLayer';
