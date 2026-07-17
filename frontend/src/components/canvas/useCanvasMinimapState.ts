import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { Node, ReactFlowInstance } from 'reactflow';
import type { AnyNodeData } from '@/types';

const MINIMAP_DRAG_THRESHOLD = 4;
const MINIMAP_PANEL_MARGIN = 20;
const MINIMAP_COLLAPSED_SIZE = 40;
const MINIMAP_DEFAULT_SIZE = { width: 220, height: 160 };
const MINIMAP_MIN_SIZE = { width: 180, height: 120 };
const MINIMAP_MAX_SIZE = { width: 360, height: 260 };

export interface MinimapSize {
  width: number;
  height: number;
}

export interface MinimapPosition {
  bottom: number;
  right: number;
}

interface UseCanvasMinimapStateOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  reactFlowInstanceRef: RefObject<ReactFlowInstance<AnyNodeData> | null>;
}

interface UseCanvasMinimapStateResult {
  isMinimapCollapsed: boolean;
  isMinimapDragging: boolean;
  isMinimapResizing: boolean;
  minimapPosition: MinimapPosition;
  minimapSize: MinimapSize;
  reactFlowMinimapStyle: CSSProperties;
  toggleReactFlowMinimapVisibility: () => void;
  handleReactFlowMinimapNodeClick: (_event: ReactMouseEvent, node: Node) => void;
  handleMinimapCollapsedClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  stopMinimapControlPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  handleMinimapDragStart: (event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) => void;
  handleMinimapResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useCanvasMinimapState(
  options: UseCanvasMinimapStateOptions,
): UseCanvasMinimapStateResult {
  const { containerRef, reactFlowInstanceRef } = options;
  const [isMinimapCollapsed, setIsMinimapCollapsed] = useState(false);
  const [isMinimapDragging, setIsMinimapDragging] = useState(false);
  const [isMinimapResizing, setIsMinimapResizing] = useState(false);
  const [minimapPosition, setMinimapPosition] = useState<MinimapPosition>({
    bottom: MINIMAP_PANEL_MARGIN,
    right: MINIMAP_PANEL_MARGIN,
  });
  const [minimapSize, setMinimapSize] = useState<MinimapSize>(MINIMAP_DEFAULT_SIZE);
  const minimapDragMovedRef = useRef(false);
  const minimapResizeMovedRef = useRef(false);
  const suppressMinimapCollapsedClickRef = useRef(false);

  const getCanvasViewportBounds = useCallback((): { width: number; height: number } => {
    const rect = containerRef.current?.getBoundingClientRect();

    return {
      width: rect?.width ?? window.innerWidth,
      height: rect?.height ?? window.innerHeight,
    };
  }, [containerRef]);

  const clampMinimapPosition = useCallback((
    nextPosition: MinimapPosition,
    panelSize: MinimapSize,
  ): MinimapPosition => {
    const { width: viewportWidth, height: viewportHeight } = getCanvasViewportBounds();
    const maxRight = Math.max(
      MINIMAP_PANEL_MARGIN,
      viewportWidth - panelSize.width - MINIMAP_PANEL_MARGIN,
    );
    const maxBottom = Math.max(
      MINIMAP_PANEL_MARGIN,
      viewportHeight - panelSize.height - MINIMAP_PANEL_MARGIN,
    );

    return {
      right: Math.min(Math.max(nextPosition.right, MINIMAP_PANEL_MARGIN), maxRight),
      bottom: Math.min(Math.max(nextPosition.bottom, MINIMAP_PANEL_MARGIN), maxBottom),
    };
  }, [getCanvasViewportBounds]);

  const currentMinimapPanelSize = useMemo<MinimapSize>(() => (
    isMinimapCollapsed
      ? { width: MINIMAP_COLLAPSED_SIZE, height: MINIMAP_COLLAPSED_SIZE }
      : minimapSize
  ), [isMinimapCollapsed, minimapSize]);

  useEffect(() => {
    setMinimapPosition((previousPosition) => {
      const nextPosition = clampMinimapPosition(previousPosition, currentMinimapPanelSize);

      if (
        nextPosition.bottom === previousPosition.bottom &&
        nextPosition.right === previousPosition.right
      ) {
        return previousPosition;
      }

      return nextPosition;
    });
  }, [clampMinimapPosition, currentMinimapPanelSize]);

  const handleReactFlowMinimapNodeClick = useCallback((_event: ReactMouseEvent, node: Node): void => {
    const instance = reactFlowInstanceRef.current;
    if (!instance) {
      return;
    }

    const { x, y } = node.position;
    const zoom = instance.getZoom();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    instance.setViewport({
      x: -x * zoom + viewportWidth / 2,
      y: -y * zoom + viewportHeight / 2,
      zoom,
    }, { duration: 300 });
  }, [reactFlowInstanceRef]);

  const toggleReactFlowMinimapVisibility = useCallback((): void => {
    setIsMinimapCollapsed((previousVisible) => !previousVisible);
  }, []);

  const handleMinimapCollapsedClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressMinimapCollapsedClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressMinimapCollapsedClickRef.current = false;
      return;
    }

    toggleReactFlowMinimapVisibility();
  }, [toggleReactFlowMinimapVisibility]);

  const stopMinimapControlPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  }, []);

  const handleMinimapDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const startPointer = { x: event.clientX, y: event.clientY };
    const startPosition = { ...minimapPosition };
    const panelSize = isMinimapCollapsed
      ? { width: MINIMAP_COLLAPSED_SIZE, height: MINIMAP_COLLAPSED_SIZE }
      : minimapSize;
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    minimapDragMovedRef.current = false;
    setIsMinimapDragging(true);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startPointer.x;
      const deltaY = moveEvent.clientY - startPointer.y;

      if (!minimapDragMovedRef.current && Math.hypot(deltaX, deltaY) >= MINIMAP_DRAG_THRESHOLD) {
        minimapDragMovedRef.current = true;
      }

      setMinimapPosition(clampMinimapPosition({
        bottom: startPosition.bottom - deltaY,
        right: startPosition.right - deltaX,
      }, panelSize));
    };

    const handlePointerUp = (): void => {
      setIsMinimapDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      target.releasePointerCapture?.(pointerId);

      if (minimapDragMovedRef.current) {
        suppressMinimapCollapsedClickRef.current = true;
      }

      window.setTimeout(() => {
        minimapDragMovedRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    target.setPointerCapture?.(pointerId);
  }, [clampMinimapPosition, isMinimapCollapsed, minimapPosition, minimapSize]);

  const handleMinimapResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const startPointer = { x: event.clientX, y: event.clientY };
    const startSize = { ...minimapSize };
    const startPosition = { ...minimapPosition };
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const { width: viewportWidth, height: viewportHeight } = getCanvasViewportBounds();
    const startLeft = viewportWidth - startPosition.right - startSize.width;
    const startTop = viewportHeight - startPosition.bottom - startSize.height;
    minimapResizeMovedRef.current = false;
    setIsMinimapResizing(true);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startPointer.x;
      const deltaY = moveEvent.clientY - startPointer.y;

      if (!minimapResizeMovedRef.current && Math.hypot(deltaX, deltaY) >= MINIMAP_DRAG_THRESHOLD) {
        minimapResizeMovedRef.current = true;
      }

      const maxWidth = Math.max(
        MINIMAP_MIN_SIZE.width,
        Math.min(MINIMAP_MAX_SIZE.width, viewportWidth - startLeft - MINIMAP_PANEL_MARGIN),
      );
      const maxHeight = Math.max(
        MINIMAP_MIN_SIZE.height,
        Math.min(MINIMAP_MAX_SIZE.height, viewportHeight - startTop - MINIMAP_PANEL_MARGIN),
      );
      const nextWidth = Math.min(Math.max(startSize.width + deltaX, MINIMAP_MIN_SIZE.width), maxWidth);
      const nextHeight = Math.min(Math.max(startSize.height + deltaY, MINIMAP_MIN_SIZE.height), maxHeight);

      setMinimapSize({
        width: nextWidth,
        height: nextHeight,
      });
      setMinimapPosition({
        right: viewportWidth - startLeft - nextWidth,
        bottom: viewportHeight - startTop - nextHeight,
      });
    };

    const handlePointerUp = (): void => {
      setIsMinimapResizing(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      target.releasePointerCapture?.(pointerId);

      window.setTimeout(() => {
        minimapResizeMovedRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    target.setPointerCapture?.(pointerId);
  }, [getCanvasViewportBounds, minimapPosition, minimapSize]);

  const reactFlowMinimapStyle = useMemo<CSSProperties>(() => ({
    backgroundColor: 'var(--color-bg-secondary)',
    borderRadius: '12px',
    width: minimapSize.width,
    height: minimapSize.height,
  }), [minimapSize.height, minimapSize.width]);

  return {
    isMinimapCollapsed,
    isMinimapDragging,
    isMinimapResizing,
    minimapPosition,
    minimapSize,
    reactFlowMinimapStyle,
    toggleReactFlowMinimapVisibility,
    handleReactFlowMinimapNodeClick,
    handleMinimapCollapsedClick,
    stopMinimapControlPointerDown,
    handleMinimapDragStart,
    handleMinimapResizeStart,
  };
}
