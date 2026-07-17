import type { Viewport } from '@/types';

export interface CanvasDragRenderSnapshot {
  isDragging: boolean;
  anchorViewport: Viewport | null;
  currentViewport: Viewport | null;
}

export interface CanvasDragTransform {
  scale: number;
  translateX: number;
  translateY: number;
  matrix: string;
}

export interface CanvasDragRenderCoordinator {
  start: (viewport: Viewport) => CanvasDragRenderSnapshot;
  update: (viewport: Viewport) => CanvasDragRenderSnapshot;
  end: (viewport?: Viewport) => CanvasDragRenderSnapshot;
  cancel: () => CanvasDragRenderSnapshot;
  getSnapshot: () => CanvasDragRenderSnapshot;
  getTransform: () => CanvasDragTransform | null;
}

export function computeCanvasDragRenderTransform(
  anchorViewport: Viewport,
  currentViewport: Viewport
): CanvasDragTransform {
  const anchorZoom = anchorViewport.zoom || 1;
  const currentZoom = currentViewport.zoom || 1;
  const scale = currentZoom / anchorZoom;
  const translateX = currentViewport.x - anchorViewport.x * scale;
  const translateY = currentViewport.y - anchorViewport.y * scale;

  return {
    scale,
    translateX,
    translateY,
    matrix: `matrix(${scale},0,0,${scale},${translateX},${translateY})`,
  };
}

export function createCanvasDragRenderCoordinator(): CanvasDragRenderCoordinator {
  let snapshot: CanvasDragRenderSnapshot = {
    isDragging: false,
    anchorViewport: null,
    currentViewport: null,
  };

  const cloneViewport = (viewport: Viewport): Viewport => ({
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.zoom,
  });

  const getSnapshot = (): CanvasDragRenderSnapshot => ({
    isDragging: snapshot.isDragging,
    anchorViewport: snapshot.anchorViewport ? cloneViewport(snapshot.anchorViewport) : null,
    currentViewport: snapshot.currentViewport ? cloneViewport(snapshot.currentViewport) : null,
  });

  const setDragging = (anchorViewport: Viewport, currentViewport: Viewport): CanvasDragRenderSnapshot => {
    snapshot = {
      isDragging: true,
      anchorViewport: cloneViewport(anchorViewport),
      currentViewport: cloneViewport(currentViewport),
    };
    return getSnapshot();
  };

  return {
    start(viewport: Viewport): CanvasDragRenderSnapshot {
      return setDragging(viewport, viewport);
    },
    update(viewport: Viewport): CanvasDragRenderSnapshot {
      if (!snapshot.anchorViewport) {
        return setDragging(viewport, viewport);
      }
      return setDragging(snapshot.anchorViewport, viewport);
    },
    end(viewport?: Viewport): CanvasDragRenderSnapshot {
      const finalViewport = viewport ?? snapshot.currentViewport ?? snapshot.anchorViewport;
      snapshot = {
        isDragging: false,
        anchorViewport: null,
        currentViewport: finalViewport ? cloneViewport(finalViewport) : null,
      };
      return getSnapshot();
    },
    cancel(): CanvasDragRenderSnapshot {
      snapshot = {
        isDragging: false,
        anchorViewport: null,
        currentViewport: null,
      };
      return getSnapshot();
    },
    getSnapshot,
    getTransform(): CanvasDragTransform | null {
      if (!snapshot.isDragging || !snapshot.anchorViewport || !snapshot.currentViewport) {
        return null;
      }
      return computeCanvasDragRenderTransform(snapshot.anchorViewport, snapshot.currentViewport);
    },
  };
}
