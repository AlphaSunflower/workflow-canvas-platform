import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import {
  createDragVisibilityScheduler,
  type DragVisibilityCommitMetric,
  type DragVisibilityScheduler,
} from './drag-visibility-scheduler';
import {
  createViewportImageScheduler,
  type ViewportImageMetric,
  type ViewportImageScheduler,
} from './viewport-image-scheduler';

interface UseCanvasImageSchedulingResult {
  dragVisibilitySchedulerRef: MutableRefObject<DragVisibilityScheduler | null>;
  viewportImageSchedulerRef: MutableRefObject<ViewportImageScheduler | null>;
  scheduleDragVisibility: (options: Parameters<DragVisibilityScheduler['schedule']>[0]) => void;
  cancelDragVisibility: () => void;
  flushDragVisibility: (options?: Parameters<DragVisibilityScheduler['flush']>[0]) => boolean;
  scheduleViewportImageWork: (options: Parameters<ViewportImageScheduler['schedule']>[0]) => void;
  flushViewportImageWork: (options?: Parameters<ViewportImageScheduler['flush']>[0]) => boolean;
  suspendViewportImageWork: () => void;
  resumeViewportImageWork: () => void;
  suspend: () => void;
  resume: () => void;
  cancel: () => void;
}

export type { DragVisibilityCommitMetric, ViewportImageMetric };

export function useCanvasImageScheduling(): UseCanvasImageSchedulingResult {
  const dragVisibilitySchedulerRef = useRef<DragVisibilityScheduler | null>(null);
  const viewportImageSchedulerRef = useRef<ViewportImageScheduler | null>(null);

  useEffect(() => {
    dragVisibilitySchedulerRef.current = createDragVisibilityScheduler();
    viewportImageSchedulerRef.current = createViewportImageScheduler();

    return (): void => {
      dragVisibilitySchedulerRef.current?.cancel();
      dragVisibilitySchedulerRef.current = null;
      viewportImageSchedulerRef.current?.cancel();
      viewportImageSchedulerRef.current = null;
    };
  }, []);

  const scheduleDragVisibility = useCallback((options: Parameters<DragVisibilityScheduler['schedule']>[0]): void => {
    dragVisibilitySchedulerRef.current?.schedule(options);
  }, []);

  const flushDragVisibility = useCallback((options?: Parameters<DragVisibilityScheduler['flush']>[0]): boolean => {
    return dragVisibilitySchedulerRef.current?.flush(options) ?? false;
  }, []);

  const cancelDragVisibility = useCallback((): void => {
    dragVisibilitySchedulerRef.current?.cancel();
  }, []);

  const scheduleViewportImageWork = useCallback((options: Parameters<ViewportImageScheduler['schedule']>[0]): void => {
    viewportImageSchedulerRef.current?.schedule(options);
  }, []);

  const flushViewportImageWork = useCallback((options?: Parameters<ViewportImageScheduler['flush']>[0]): boolean => {
    return viewportImageSchedulerRef.current?.flush(options) ?? false;
  }, []);

  const suspendViewportImageWork = useCallback((): void => {
    viewportImageSchedulerRef.current?.suspend();
  }, []);

  const resumeViewportImageWork = useCallback((): void => {
    viewportImageSchedulerRef.current?.resume();
  }, []);

  const suspend = useCallback((): void => {
    dragVisibilitySchedulerRef.current?.suspend();
    viewportImageSchedulerRef.current?.suspend();
  }, []);

  const resume = useCallback((): void => {
    dragVisibilitySchedulerRef.current?.resume();
    viewportImageSchedulerRef.current?.resume();
  }, []);

  const cancel = useCallback((): void => {
    dragVisibilitySchedulerRef.current?.cancel();
    viewportImageSchedulerRef.current?.cancel();
  }, []);

  return {
    dragVisibilitySchedulerRef,
    viewportImageSchedulerRef,
    scheduleDragVisibility,
    cancelDragVisibility,
    flushDragVisibility,
    scheduleViewportImageWork,
    flushViewportImageWork,
    suspendViewportImageWork,
    resumeViewportImageWork,
    suspend,
    resume,
    cancel,
  };
}
