import type { CanvasPerformanceRecorder } from './recorder';

export interface CanvasLongTaskObserverHandle {
  stop: () => void;
}

export function startCanvasLongTaskObserver(recorder: CanvasPerformanceRecorder): CanvasLongTaskObserverHandle {
  if (typeof PerformanceObserver === 'undefined') {
    return { stop: () => undefined };
  }

  const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];
  if (!supportedEntryTypes.includes('longtask')) {
    return { stop: () => undefined };
  }

  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      recorder.record({
        type: 'longtask',
        phase: 'instant',
        durationMs: entry.duration,
        ts: entry.startTime,
        data: {
          name: entry.name,
        },
      });
    });
  });

  observer.observe({
    type: 'longtask',
    buffered: true,
  });

  return {
    stop(): void {
      observer.disconnect();
    },
  };
}
