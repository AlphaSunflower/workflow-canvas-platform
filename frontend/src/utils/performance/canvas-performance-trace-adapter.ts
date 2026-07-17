import {
  canvasPerformanceRecorder,
} from '../../../tools/canvas-performance-recorder/recorder';
import {
  buildCanvasPerformanceTraceSummaryText,
  serializeCanvasPerformanceTraceExport,
} from '../../../tools/canvas-performance-recorder/exporters';
import type {
  CanvasPerformanceTraceExport,
  CanvasPerformanceTraceRecordInput,
  CanvasTracePreset,
} from '../../../tools/canvas-performance-recorder/schema';

const TRACE_STORAGE_KEY = 'canvas-performance-trace-enabled';
const TRACE_QUERY_KEYS = ['canvasPerfTrace', 'canvasTrace'];
const TRACE_START_QUERY_KEYS = ['canvasPerfTraceStart', 'canvasTraceStart'];
const TRACE_PRESET_QUERY_KEY = 'canvasPerfTracePreset';
const TRACE_DURATION_QUERY_KEY = 'canvasPerfTraceDurationMs';

let traceEnabledOverride: boolean | undefined;
let diagnosticsEnabledReader: (() => boolean) | undefined;
let performanceSummaryProvider: (() => unknown) | undefined;
let traceQueryAutoStartAttempted = false;

export function bindCanvasPerformanceTraceDiagnostics(options: {
  isDiagnosticsEnabled: () => boolean;
  getPerformanceSummary?: () => unknown;
}): void {
  diagnosticsEnabledReader = options.isDiagnosticsEnabled;
  performanceSummaryProvider = options.getPerformanceSummary;
  startTraceFromQueryIfRequested();
}

function parseBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function readTraceStorageFlag(): boolean | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return parseBooleanFlag(window.localStorage.getItem(TRACE_STORAGE_KEY) ?? undefined);
  } catch {
    return undefined;
  }
}

function readQueryValue(key: string): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function readQueryFlag(keys: readonly string[]): boolean | undefined {
  for (const key of keys) {
    const value = readQueryValue(key);
    const parsedValue = parseBooleanFlag(value ?? undefined);
    if (typeof parsedValue === 'boolean') {
      return parsedValue;
    }
  }

  return undefined;
}

function readTracePresetQuery(): CanvasTracePreset | undefined {
  const value = readQueryValue(TRACE_PRESET_QUERY_KEY);
  if (value === '10min-default' || value === 'high-detail-2min' || value === 'summary-only') {
    return value;
  }

  return undefined;
}

function readTraceDurationQuery(): number | undefined {
  const value = Number(readQueryValue(TRACE_DURATION_QUERY_KEY));
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function writeTraceStorageFlag(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(TRACE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Diagnostics must never fail app code.
  }
}

export function isCanvasPerformanceTraceEnabled(): boolean {
  return Boolean(diagnosticsEnabledReader?.()) && Boolean(
    traceEnabledOverride ??
    parseBooleanFlag(typeof window === 'undefined' ? undefined : window.__CANVAS_PERF_TRACE_ENABLED__) ??
    readQueryFlag(TRACE_QUERY_KEYS) ??
    readTraceStorageFlag() ??
    false
  );
}

function startTraceFromQueryIfRequested(): void {
  if (traceQueryAutoStartAttempted || typeof window === 'undefined') {
    return;
  }

  if (readQueryFlag(TRACE_START_QUERY_KEYS) !== true) {
    return;
  }

  traceQueryAutoStartAttempted = true;
  if (!isCanvasPerformanceTraceEnabled()) {
    return;
  }

  canvasPerformanceRecorder.start({
    preset: readTracePresetQuery(),
    durationMs: readTraceDurationQuery(),
    performanceSummaryProvider,
  });
}

export function setCanvasPerformanceTraceEnabled(enabled: boolean): boolean {
  traceEnabledOverride = enabled;
  writeTraceStorageFlag(enabled);
  if (typeof window !== 'undefined') {
    window.__CANVAS_PERF_TRACE_ENABLED__ = enabled;
  }

  if (!enabled) {
    canvasPerformanceRecorder.stop();
  }

  return isCanvasPerformanceTraceEnabled();
}

export function startCanvasPerformanceTrace(options: {
  durationMs?: number;
  preset?: CanvasTracePreset;
} = {}): void {
  if (!isCanvasPerformanceTraceEnabled()) {
    return;
  }

  canvasPerformanceRecorder.start({
    ...options,
    performanceSummaryProvider,
  });
}

export function stopCanvasPerformanceTrace(): void {
  canvasPerformanceRecorder.stop();
}

export function clearCanvasPerformanceTrace(): void {
  canvasPerformanceRecorder.clear();
}

export function recordCanvasTraceEvent(event: CanvasPerformanceTraceRecordInput): void {
  if (!isCanvasPerformanceTraceEnabled()) {
    return;
  }

  canvasPerformanceRecorder.record(event);
}

export function exportCanvasPerformanceTrace(): CanvasPerformanceTraceExport {
  return canvasPerformanceRecorder.export();
}

export function exportCanvasPerformanceTraceJson(): string {
  return serializeCanvasPerformanceTraceExport(exportCanvasPerformanceTrace());
}

export function copyCanvasPerformanceTraceSummary(): string {
  return buildCanvasPerformanceTraceSummaryText(exportCanvasPerformanceTrace());
}

export function getCanvasPerformanceTraceStatus(): ReturnType<typeof canvasPerformanceRecorder.getStatus> & {
  enabled: boolean;
} {
  return {
    ...canvasPerformanceRecorder.getStatus(),
    enabled: isCanvasPerformanceTraceEnabled(),
  };
}

export function downloadCanvasPerformanceTraceJson(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const json = exportCanvasPerformanceTraceJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `canvas-performance-trace-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

declare global {
  interface Window {
    __CANVAS_PERF_TRACE_ENABLED__?: boolean | string;
    __CANVAS_PERF_TRACE_START__?: typeof startCanvasPerformanceTrace;
    __CANVAS_PERF_TRACE_STOP__?: typeof stopCanvasPerformanceTrace;
    __CANVAS_PERF_TRACE_EXPORT__?: typeof exportCanvasPerformanceTrace;
    __CANVAS_PERF_TRACE_EXPORT_JSON__?: typeof exportCanvasPerformanceTraceJson;
    __CANVAS_PERF_TRACE_SUMMARY__?: typeof copyCanvasPerformanceTraceSummary;
    __CANVAS_PERF_TRACE_ENABLE__?: (enabled?: boolean) => boolean;
  }
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__CANVAS_PERF_TRACE_START__ = startCanvasPerformanceTrace;
  window.__CANVAS_PERF_TRACE_STOP__ = stopCanvasPerformanceTrace;
  window.__CANVAS_PERF_TRACE_EXPORT__ = exportCanvasPerformanceTrace;
  window.__CANVAS_PERF_TRACE_EXPORT_JSON__ = exportCanvasPerformanceTraceJson;
  window.__CANVAS_PERF_TRACE_SUMMARY__ = copyCanvasPerformanceTraceSummary;
  window.__CANVAS_PERF_TRACE_ENABLE__ = (enabled = true): boolean => setCanvasPerformanceTraceEnabled(enabled);
}
