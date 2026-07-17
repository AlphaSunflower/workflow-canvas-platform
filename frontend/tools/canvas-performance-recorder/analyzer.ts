import type {
  CanvasPerformanceTraceCounterBucket,
  CanvasPerformanceTraceEvent,
  CanvasPerformanceTraceSummary,
  CanvasPerformanceTraceSuspect,
} from './schema';

function maxNumber(values: Array<number | undefined>): number | undefined {
  const finiteValues = values.filter((value): value is number => (
    typeof value === 'number' && Number.isFinite(value)
  ));
  return finiteValues.length > 0 ? Math.max(...finiteValues) : undefined;
}

function countEvents(events: readonly CanvasPerformanceTraceEvent[], type: CanvasPerformanceTraceEvent['type']): number {
  return events.filter((event) => event.type === type).length;
}

export function buildCanvasPerformanceTraceSummary(
  events: readonly CanvasPerformanceTraceEvent[],
  countersBySecond: readonly CanvasPerformanceTraceCounterBucket[],
): CanvasPerformanceTraceSummary {
  const firstTs = events[0]?.ts ?? 0;
  const lastTs = events[events.length - 1]?.ts ?? firstTs;
  return {
    longTaskCount: countEvents(events, 'longtask'),
    maxLongTaskMs: maxNumber(events.filter((event) => event.type === 'longtask').map((event) => event.durationMs)),
    maxFrameGapMs: maxNumber(events.filter((event) => event.type === 'frame.gap').map((event) => event.durationMs)),
    maxRasterDrawMs: maxNumber(events.filter((event) => event.type === 'raster.draw').map((event) => event.durationMs)),
    maxImageEmitPerSec: maxNumber(countersBySecond.map((bucket) => bucket['imageManager.emit'])),
    maxNodesRefChangePerSec: maxNumber(countersBySecond.map((bucket) => bucket['reactFlow.nodesRefChange'])),
    maxPatchFlushMs: maxNumber(events.filter((event) => event.type === 'nodePatch.flush').map((event) => event.durationMs)),
    totalEvents: events.length,
    recordedDurationMs: Math.max(0, lastTs - firstTs),
  };
}

export function analyzeCanvasPerformanceTrace(
  events: readonly CanvasPerformanceTraceEvent[],
  countersBySecond: readonly CanvasPerformanceTraceCounterBucket[],
): CanvasPerformanceTraceSuspect[] {
  const suspects: CanvasPerformanceTraceSuspect[] = [];

  events.forEach((event) => {
    if (event.type === 'longtask' && (event.durationMs ?? 0) >= 50) {
      const nearbyEvents = events.filter((candidate) => Math.abs(candidate.ts - event.ts) <= 500);
      suspects.push({
        severity: (event.durationMs ?? 0) >= 120 ? 'critical' : 'warning',
        reason: `long task ${Math.round(event.durationMs ?? 0)}ms near ${nearbyEvents.length} trace events`,
        atMs: event.ts,
        evidence: {
          durationMs: event.durationMs,
          nearbyEventCount: nearbyEvents.length,
        },
      });
    }

    if (event.type === 'raster.draw' && (event.durationMs ?? 0) >= 32) {
      suspects.push({
        severity: (event.durationMs ?? 0) >= 50 ? 'critical' : 'warning',
        reason: `raster draw exceeded frame budget (${Math.round(event.durationMs ?? 0)}ms)`,
        atMs: event.ts,
        evidence: {
          durationMs: event.durationMs,
          itemCount: event.data?.itemCount,
          readyCount: event.data?.readyCount,
        },
      });
    }

    if (event.type === 'nodePatch.flush' && (event.durationMs ?? 0) >= 16) {
      suspects.push({
        severity: (event.durationMs ?? 0) >= 50 ? 'critical' : 'warning',
        reason: `node patch flush exceeded frame budget (${Math.round(event.durationMs ?? 0)}ms)`,
        atMs: event.ts,
        evidence: {
          durationMs: event.durationMs,
          pendingCount: event.data?.pendingCount,
          flushCount: event.data?.flushCount,
        },
      });
    }

    if (event.type === 'renderPlan.build' && (event.durationMs ?? 0) >= 16) {
      suspects.push({
        severity: (event.durationMs ?? 0) >= 50 ? 'critical' : 'warning',
        reason: `render plan build exceeded frame budget (${Math.round(event.durationMs ?? 0)}ms)`,
        atMs: event.ts,
        evidence: {
          durationMs: event.durationMs,
          nodeCount: event.data?.nodeCount,
          renderedNodeCount: event.data?.renderedNodeCount,
        },
      });
    }
  });

  countersBySecond.forEach((bucket) => {
    const imageEmits = bucket['imageManager.emit'] ?? 0;
    if (imageEmits >= 120) {
      suspects.push({
        severity: imageEmits >= 300 ? 'critical' : 'warning',
        reason: `imageManager emit spike (${imageEmits}/sec)`,
        atMs: bucket.second * 1000,
        evidence: {
          emitsPerSecond: imageEmits,
        },
      });
    }

    const nodeRefChanges = bucket['reactFlow.nodesRefChange'] ?? 0;
    if (nodeRefChanges >= 10) {
      suspects.push({
        severity: nodeRefChanges >= 30 ? 'critical' : 'warning',
        reason: `React Flow nodes reference changed ${nodeRefChanges} times in one second`,
        atMs: bucket.second * 1000,
        evidence: {
          nodesRefChangesPerSecond: nodeRefChanges,
          renderPlanBuilds: bucket['renderPlan.build'] ?? 0,
          rasterRebuilds: bucket['raster.rebuild'] ?? 0,
        },
      });
    }
  });

  return suspects.sort((left, right) => {
    const severityRank = { critical: 0, warning: 1, info: 2 };
    return severityRank[left.severity] - severityRank[right.severity] || left.atMs - right.atMs;
  });
}
