import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Viewport } from '@/types';

export interface CanvasViewportSize {
  width: number;
  height: number;
}

interface UseCanvasReactFlowStateOptions {
  initialViewport: Viewport;
  containerRef: RefObject<HTMLElement | null>;
}

interface UseCanvasReactFlowStateResult {
  currentViewport: Viewport;
  canvasViewportSize: CanvasViewportSize;
  commitViewportForVisibility: (viewport: Viewport) => void;
}

export function useCanvasReactFlowState(
  options: UseCanvasReactFlowStateOptions,
): UseCanvasReactFlowStateResult {
  const { initialViewport, containerRef } = options;
  const [currentViewport, setCurrentViewport] = useState<Viewport>(initialViewport);
  const [canvasViewportSize, setCanvasViewportSize] = useState<CanvasViewportSize>({
    width: 0,
    height: 0,
  });

  const commitViewportForVisibility = useCallback((viewport: Viewport): void => {
    setCurrentViewport((current) => (
      current.x === viewport.x &&
      current.y === viewport.y &&
      current.zoom === viewport.zoom
        ? current
        : viewport
    ));
  }, []);

  useEffect(() => {
    const updateCanvasViewportSize = (): void => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const nextSize = {
        width: Math.round(container.clientWidth),
        height: Math.round(container.clientHeight),
      };

      setCanvasViewportSize((current) => (
        current.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize
      ));
    };

    updateCanvasViewportSize();
    window.addEventListener('resize', updateCanvasViewportSize);

    return (): void => {
      window.removeEventListener('resize', updateCanvasViewportSize);
    };
  }, [containerRef]);

  return {
    currentViewport,
    canvasViewportSize,
    commitViewportForVisibility,
  };
}
