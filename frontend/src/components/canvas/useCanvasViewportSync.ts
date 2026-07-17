import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Viewport } from '@/types';
import {
  createViewportSyncController,
  type ViewportSyncController,
} from './viewport-sync';

interface UseCanvasViewportSyncOptions {
  delayMs: number;
  onCommit: (viewport: Viewport) => void;
}

export interface UseCanvasViewportSyncResult {
  controllerRef: MutableRefObject<ViewportSyncController | null>;
  schedule: (viewport: Viewport) => void;
  flush: (viewport?: Viewport) => boolean;
  suspend: () => void;
  resume: () => void;
  cancel: () => void;
}

export function useCanvasViewportSync(
  options: UseCanvasViewportSyncOptions,
): UseCanvasViewportSyncResult {
  const { delayMs, onCommit } = options;
  const controllerRef = useRef<ViewportSyncController | null>(null);

  useEffect(() => {
    controllerRef.current = createViewportSyncController({
      delayMs,
      onCommit,
    });

    return (): void => {
      controllerRef.current?.cancel();
      controllerRef.current = null;
    };
  }, [delayMs, onCommit]);

  const schedule = useCallback((viewport: Viewport): void => {
    controllerRef.current?.schedule(viewport);
  }, []);

  const flush = useCallback((viewport?: Viewport): boolean => {
    return controllerRef.current?.flush(viewport) ?? false;
  }, []);

  const suspend = useCallback((): void => {
    controllerRef.current?.suspend();
  }, []);

  const resume = useCallback((): void => {
    controllerRef.current?.resume();
  }, []);

  const cancel = useCallback((): void => {
    controllerRef.current?.cancel();
  }, []);

  return {
    controllerRef,
    schedule,
    flush,
    suspend,
    resume,
    cancel,
  };
}
