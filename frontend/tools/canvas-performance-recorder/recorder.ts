import { analyzeCanvasPerformanceTrace, buildCanvasPerformanceTraceSummary } from './analyzer';
import { buildCanvasPerformanceTraceSummaryText, serializeCanvasPerformanceTraceExport } from './exporters';
import { startCanvasFrameMonitor, type CanvasFrameMonitorHandle } from './frame-monitor';
import { startCanvasLongTaskObserver, type CanvasLongTaskObserverHandle } from './long-task-observer';
import { getCanvasPerformanceTracePreset } from './presets';
import { sanitizeCanvasTraceData } from './privacy';
import { CanvasPerformanceRingBuffer } from './ring-buffer';
import type {
  CanvasPerformanceTraceCounterBucket,
  CanvasPerformanceTraceEvent,
  CanvasPerformanceTraceExport,
  CanvasPerformanceTracePresetConfig,
  CanvasPerformanceTraceRecordInput,
  CanvasTraceEventType,
  CanvasTracePreset,
} from './schema';

interface StartOptions {
  durationMs?: number;
  preset?: CanvasTracePreset;
  performanceSummaryProvider?: () => unknown;
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function getUserAgent(): string {
  return typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent;
}

function createCounterBucket(second: number): CanvasPerformanceTraceCounterBucket {
  return { second };
}

function isMemoryPerformance(performanceLike: Performance): performanceLike is Performance & {
  memory: {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
} {
  return 'memory' in performanceLike;
}

export class CanvasPerformanceRecorder {
  private config: CanvasPerformanceTracePresetConfig = getCanvasPerformanceTracePreset();
  private buffer = new CanvasPerformanceRingBuffer<CanvasPerformanceTraceEvent>({
    durationMs: this.config.durationMs,
    maxEvents: this.config.maxEvents,
  });
  private counters = new Map<number, CanvasPerformanceTraceCounterBucket>();
  private highFrequencyTypes = new Set<CanvasTraceEventType>(this.config.highFrequencyTypes);
  private startedAtIso = '';
  private startedAtMs = 0;
  private recording = false;
  private stopTimerId: number | null = null;
  private memoryTimerId: number | null = null;
  private summaryTimerId: number | null = null;
  private longTaskObserver: CanvasLongTaskObserverHandle | null = null;
  private frameMonitor: CanvasFrameMonitorHandle | null = null;
  private performanceSummaryProvider: (() => unknown) | undefined;

  start(options: StartOptions = {}): void {
    this.stop();
    const baseConfig = getCanvasPerformanceTracePreset(options.preset);
    this.config = {
      ...baseConfig,
      durationMs: options.durationMs ?? baseConfig.durationMs,
    };
    this.buffer = new CanvasPerformanceRingBuffer<CanvasPerformanceTraceEvent>({
      durationMs: this.config.durationMs,
      maxEvents: this.config.maxEvents,
    });
    this.counters.clear();
    this.highFrequencyTypes = new Set(this.config.highFrequencyTypes);
    this.performanceSummaryProvider = options.performanceSummaryProvider;
    this.startedAtIso = new Date().toISOString();
    this.startedAtMs = nowMs();
    this.recording = true;
    this.longTaskObserver = startCanvasLongTaskObserver(this);
    this.frameMonitor = startCanvasFrameMonitor(this, this.config.frameGapThresholdMs);
    this.scheduleMemorySamples();
    this.scheduleSummarySamples();

    if (typeof window !== 'undefined') {
      this.stopTimerId = window.setTimeout(() => {
        this.stop();
      }, this.config.durationMs);
    }
  }

  stop(): void {
    if (this.stopTimerId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.stopTimerId);
    }
    if (this.memoryTimerId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.memoryTimerId);
    }
    if (this.summaryTimerId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.summaryTimerId);
    }

    this.stopTimerId = null;
    this.memoryTimerId = null;
    this.summaryTimerId = null;
    this.longTaskObserver?.stop();
    this.frameMonitor?.stop();
    this.longTaskObserver = null;
    this.frameMonitor = null;
    this.recording = false;
  }

  clear(): void {
    this.buffer.clear();
    this.counters.clear();
    this.startedAtIso = '';
    this.startedAtMs = 0;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getStatus(): {
    recording: boolean;
    eventCount: number;
    startedAt?: string;
    remainingMs: number;
    longTaskCount: number;
  } {
    const elapsed = this.startedAtMs > 0 ? nowMs() - this.startedAtMs : 0;
    const events = this.buffer.values();
    return {
      recording: this.recording,
      eventCount: this.buffer.size,
      startedAt: this.startedAtIso || undefined,
      remainingMs: this.recording ? Math.max(0, this.config.durationMs - elapsed) : 0,
      longTaskCount: events.filter((event) => event.type === 'longtask').length,
    };
  }

  record(input: CanvasPerformanceTraceRecordInput): void {
    if (!this.recording) {
      return;
    }

    const ts = input.ts ?? nowMs();
    this.incrementCounter(input.type, ts);
    if (this.highFrequencyTypes.has(input.type) && input.phase !== 'start' && input.phase !== 'end') {
      return;
    }

    this.buffer.push({
      ts,
      type: input.type,
      phase: input.phase ?? 'instant',
      durationMs: input.durationMs,
      opId: input.opId,
      frameId: input.frameId,
      data: sanitizeCanvasTraceData(input.data),
    });
  }

  export(): CanvasPerformanceTraceExport {
    const timeline = this.buffer.values();
    const countersBySecond = Array.from(this.counters.values())
      .sort((left, right) => left.second - right.second);
    const summary = buildCanvasPerformanceTraceSummary(timeline, countersBySecond);
    const durationMs = this.startedAtMs > 0 ? Math.max(0, nowMs() - this.startedAtMs) : summary.recordedDurationMs;
    return {
      meta: {
        schemaVersion: 1,
        startedAt: this.startedAtIso || new Date().toISOString(),
        exportedAt: new Date().toISOString(),
        durationMs,
        preset: this.config.preset,
        userAgent: getUserAgent(),
      },
      summary,
      suspects: analyzeCanvasPerformanceTrace(timeline, countersBySecond),
      countersBySecond,
      timeline,
      performanceSummary: this.performanceSummaryProvider?.(),
    };
  }

  exportJson(): string {
    return serializeCanvasPerformanceTraceExport(this.export());
  }

  copySummaryText(): string {
    return buildCanvasPerformanceTraceSummaryText(this.export());
  }

  private incrementCounter(type: CanvasTraceEventType, ts: number): void {
    const second = Math.floor(ts / 1000);
    const bucket = this.counters.get(second) ?? createCounterBucket(second);
    bucket[type] = (bucket[type] ?? 0) + 1;
    this.counters.set(second, bucket);
  }

  private scheduleMemorySamples(): void {
    if (typeof window === 'undefined' || typeof performance === 'undefined') {
      return;
    }

    this.memoryTimerId = window.setInterval(() => {
      if (!isMemoryPerformance(performance)) {
        return;
      }

      this.record({
        type: 'memory.sample',
        phase: 'instant',
        data: {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        },
      });
    }, this.config.memorySampleIntervalMs);
  }

  private scheduleSummarySamples(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.summaryTimerId = window.setInterval(() => {
      const status = this.getStatus();
      this.record({
        type: 'summary.sample',
        phase: 'instant',
        data: {
          eventCount: status.eventCount,
          longTaskCount: status.longTaskCount,
          remainingMs: Math.round(status.remainingMs),
        },
      });
    }, this.config.summarySampleIntervalMs);
  }
}

export const canvasPerformanceRecorder = new CanvasPerformanceRecorder();
