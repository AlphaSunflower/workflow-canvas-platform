import type { CanvasPerformanceRecorder } from './recorder';

export interface CanvasFrameMonitorHandle {
  stop: () => void;
}

export function startCanvasFrameMonitor(
  recorder: CanvasPerformanceRecorder,
  thresholdMs: number,
): CanvasFrameMonitorHandle {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return { stop: () => undefined };
  }

  let stopped = false;
  let frameId = 0;
  let lastFrameAt: number | null = null;
  let frameCount = 0;

  const tick = (timestamp: number): void => {
    if (stopped) {
      return;
    }

    frameCount += 1;
    if (lastFrameAt !== null) {
      const gapMs = timestamp - lastFrameAt;
      if (gapMs >= thresholdMs) {
        recorder.record({
          type: 'frame.gap',
          phase: 'instant',
          durationMs: gapMs,
          frameId: frameCount,
          ts: timestamp,
        });
      }
    }

    lastFrameAt = timestamp;
    frameId = window.requestAnimationFrame(tick);
  };

  frameId = window.requestAnimationFrame(tick);

  return {
    stop(): void {
      stopped = true;
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    },
  };
}
