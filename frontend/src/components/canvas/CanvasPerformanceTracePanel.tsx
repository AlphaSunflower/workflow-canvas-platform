import { useEffect, useMemo, useState } from 'react';

import {
  clearCanvasPerformanceTrace,
  copyCanvasPerformanceTraceSummary,
  downloadCanvasPerformanceTraceJson,
  getCanvasImageDiagnosticsConfig,
  getCanvasPerformanceTraceStatus,
  setCanvasPerformanceTraceEnabled,
  startCanvasPerformanceTrace,
  stopCanvasPerformanceTrace,
} from '@/utils/performance';

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function CanvasPerformanceTracePanel(): JSX.Element | null {
  const diagnosticsEnabled = getCanvasImageDiagnosticsConfig().enabled;
  const [status, setStatus] = useState(() => getCanvasPerformanceTraceStatus());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStatus(getCanvasPerformanceTraceStatus());
    }, 1000);

    return (): void => {
      window.clearInterval(intervalId);
    };
  }, []);

  const isVisible = diagnosticsEnabled || status.enabled || status.recording;
  const title = useMemo(() => (
    status.recording
      ? `Recording ${formatDuration(status.remainingMs)}`
      : status.enabled
        ? 'Trace ready'
        : 'Trace disabled'
  ), [status.enabled, status.recording, status.remainingMs]);

  if (!isVisible) {
    return null;
  }

  const handleEnable = (): void => {
    setCanvasPerformanceTraceEnabled(true);
    setStatus(getCanvasPerformanceTraceStatus());
  };

  const handleStart = (): void => {
    setCanvasPerformanceTraceEnabled(true);
    startCanvasPerformanceTrace({
      preset: '10min-default',
    });
    setStatus(getCanvasPerformanceTraceStatus());
  };

  const handleStop = (): void => {
    stopCanvasPerformanceTrace();
    setStatus(getCanvasPerformanceTraceStatus());
  };

  const handleClear = (): void => {
    clearCanvasPerformanceTrace();
    setCopied(false);
    setStatus(getCanvasPerformanceTraceStatus());
  };

  const handleCopySummary = (): void => {
    const summary = copyCanvasPerformanceTraceSummary();
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(summary).then(() => {
        setCopied(true);
      });
      return;
    }

    setCopied(true);
  };

  const handleExport = (): void => {
    downloadCanvasPerformanceTraceJson();
    setStatus(getCanvasPerformanceTraceStatus());
  };

  return (
    <div className="canvas-performance-trace-panel">
      <div className="canvas-performance-trace-panel__header">
        <span className="canvas-performance-trace-panel__title">{title}</span>
        <span className="canvas-performance-trace-panel__meta">
          {status.eventCount} events · {status.longTaskCount} long tasks
        </span>
      </div>
      <div className="canvas-performance-trace-panel__actions">
        {!status.enabled && (
          <button type="button" onClick={handleEnable}>Enable</button>
        )}
        <button type="button" onClick={handleStart}>Start 10min</button>
        <button type="button" onClick={handleStop} disabled={!status.recording}>Stop</button>
        <button type="button" onClick={handleExport} disabled={status.eventCount === 0}>Export JSON</button>
        <button type="button" onClick={handleCopySummary} disabled={status.eventCount === 0}>
          {copied ? 'Copied' : 'Copy Summary'}
        </button>
        <button type="button" onClick={handleClear} disabled={status.eventCount === 0}>Clear</button>
      </div>
    </div>
  );
}
