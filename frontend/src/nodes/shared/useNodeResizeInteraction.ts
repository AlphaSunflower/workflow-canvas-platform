import { useCallback } from 'react';
import type React from 'react';

import type { Dimensions } from '@/types';

export interface NodeResizePointer {
  x: number;
  y: number;
}

export interface NodeResizeDelta {
  x: number;
  y: number;
}

export interface NodeResizeInteractionSnapshot {
  startPointer: NodeResizePointer;
  currentPointer: NodeResizePointer;
  zoom: number;
  screenDelta: NodeResizeDelta;
  canvasDelta: NodeResizeDelta;
}

export interface NodeResizeDimensionsOptions {
  startDimensions: Dimensions;
  minDimensions: Dimensions;
  screenDelta: NodeResizeDelta;
  zoom: number;
}

export interface NodeResizeScaleOptions {
  startDimensions: Dimensions;
  baseDimensions: Dimensions;
  startScale: number;
  screenDelta: NodeResizeDelta;
  zoom: number;
  clampScale: (scale: number) => number;
}

export interface NodeResizeInteractionOptions<TUpdate> {
  getViewportZoom: () => number;
  shouldStart?: () => boolean;
  resolveUpdate: (snapshot: NodeResizeInteractionSnapshot) => TUpdate | null | undefined;
  applyUpdate: (update: TUpdate) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  onCommit?: (update: TUpdate | null) => void;
  captureElementRef?: React.RefObject<HTMLElement | null>;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  addWindowEventListener?: Window['addEventListener'];
  removeWindowEventListener?: Window['removeEventListener'];
}

export function resolveResizeCommitUpdate<TUpdate>(
  lastAppliedUpdate: TUpdate | null,
): TUpdate | null {
  return lastAppliedUpdate;
}

export function normalizeResizeInteractionZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function toCanvasResizeDelta(screenDelta: NodeResizeDelta, zoom: number): NodeResizeDelta {
  const normalizedZoom = normalizeResizeInteractionZoom(zoom);
  return {
    x: screenDelta.x / normalizedZoom,
    y: screenDelta.y / normalizedZoom,
  };
}

export function resolveNodeResizeDimensions(options: NodeResizeDimensionsOptions): Dimensions {
  const canvasDelta = toCanvasResizeDelta(options.screenDelta, options.zoom);
  return {
    width: Math.max(
      options.minDimensions.width,
      Math.round(options.startDimensions.width + canvasDelta.x),
    ),
    height: Math.max(
      options.minDimensions.height,
      Math.round(options.startDimensions.height + canvasDelta.y),
    ),
  };
}

export function resolveNodeResizeScale(options: NodeResizeScaleOptions): {
  scale: number;
  dimensions: Dimensions;
} {
  const canvasDelta = toCanvasResizeDelta(options.screenDelta, options.zoom);
  const dominantDelta = Math.abs(canvasDelta.x) > Math.abs(canvasDelta.y)
    ? canvasDelta.x
    : canvasDelta.y;
  const ratio = 1 + dominantDelta / Math.max(options.startDimensions.width, 1);
  const scale = options.clampScale(options.startScale * ratio);

  return {
    scale,
    dimensions: {
      width: Math.round(options.baseDimensions.width * scale),
      height: Math.round(options.baseDimensions.height * scale),
    },
  };
}

export function useNodeResizeInteraction<TUpdate>(
  options: NodeResizeInteractionOptions<TUpdate>
): (event: React.PointerEvent<HTMLElement>) => void {
  return useCallback((event: React.PointerEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();

    if (options.shouldStart && !options.shouldStart()) {
      return;
    }

    const startPointer = { x: event.clientX, y: event.clientY };
    const zoom = normalizeResizeInteractionZoom(options.getViewportZoom());
    const pointerId = event.pointerId;
    const animationFrame = options.requestAnimationFrame ?? window.requestAnimationFrame.bind(window);
    const cancelFrame = options.cancelAnimationFrame ?? window.cancelAnimationFrame.bind(window);
    const addEventListener = options.addWindowEventListener ?? window.addEventListener.bind(window);
    const removeEventListener = options.removeWindowEventListener ?? window.removeEventListener.bind(window);
    const captureElement = options.captureElementRef?.current;
    let frameId = 0;
    let pendingUpdate: TUpdate | null = null;
    let lastAppliedUpdate: TUpdate | null = null;

    options.onResizeStart?.();

    const flushPendingUpdate = (): void => {
      frameId = 0;
      if (!pendingUpdate) {
        return;
      }

      const update = pendingUpdate;
      options.applyUpdate(update);
      lastAppliedUpdate = update;
      pendingUpdate = null;
    };

    const queueUpdate = (nextUpdate: TUpdate | null | undefined): void => {
      if (!nextUpdate) {
        return;
      }

      pendingUpdate = nextUpdate;
      if (frameId === 0) {
        frameId = animationFrame(flushPendingUpdate);
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const currentPointer = { x: moveEvent.clientX, y: moveEvent.clientY };
      const screenDelta = {
        x: currentPointer.x - startPointer.x,
        y: currentPointer.y - startPointer.y,
      };
      queueUpdate(options.resolveUpdate({
        startPointer,
        currentPointer,
        zoom,
        screenDelta,
        canvasDelta: toCanvasResizeDelta(screenDelta, zoom),
      }));
    };

    const handlePointerUp = (): void => {
      options.onResizeEnd?.();
      if (frameId !== 0) {
        cancelFrame(frameId);
        frameId = 0;
      }
      flushPendingUpdate();
      removeEventListener('pointermove', handlePointerMove);
      removeEventListener('pointerup', handlePointerUp);
      removeEventListener('pointercancel', handlePointerUp);
      captureElement?.releasePointerCapture?.(pointerId);
      options.onCommit?.(resolveResizeCommitUpdate(lastAppliedUpdate));
    };

    addEventListener('pointermove', handlePointerMove);
    addEventListener('pointerup', handlePointerUp);
    addEventListener('pointercancel', handlePointerUp);
    captureElement?.setPointerCapture?.(pointerId);
  }, [options]);
}
