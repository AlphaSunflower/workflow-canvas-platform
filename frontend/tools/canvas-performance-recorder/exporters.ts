import type { CanvasPerformanceTraceExport, CanvasPerformanceTraceSuspect } from './schema';

export function serializeCanvasPerformanceTraceExport(payload: CanvasPerformanceTraceExport): string {
  return JSON.stringify(payload, null, 2);
}

function formatSuspect(suspect: CanvasPerformanceTraceSuspect): string {
  return `[${suspect.severity}] ${Math.round(suspect.atMs)}ms ${suspect.reason}`;
}

export function buildCanvasPerformanceTraceSummaryText(payload: CanvasPerformanceTraceExport): string {
  const lines = [
    `Canvas Performance Trace (${payload.meta.preset})`,
    `duration=${Math.round(payload.summary.recordedDurationMs)}ms events=${payload.summary.totalEvents}`,
    `longTasks=${payload.summary.longTaskCount} maxLongTaskMs=${payload.summary.maxLongTaskMs ?? 0}`,
    `maxRasterDrawMs=${payload.summary.maxRasterDrawMs ?? 0} maxImageEmitPerSec=${payload.summary.maxImageEmitPerSec ?? 0}`,
    `maxNodesRefChangePerSec=${payload.summary.maxNodesRefChangePerSec ?? 0} maxPatchFlushMs=${payload.summary.maxPatchFlushMs ?? 0}`,
  ];

  if (payload.suspects.length > 0) {
    lines.push('Suspects:');
    payload.suspects.slice(0, 10).forEach((suspect) => {
      lines.push(`- ${formatSuspect(suspect)}`);
    });
  }

  return lines.join('\n');
}
