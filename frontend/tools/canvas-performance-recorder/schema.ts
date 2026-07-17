export type CanvasTraceEventPhase = 'start' | 'end' | 'instant';

export type CanvasTracePreset = '10min-default' | 'high-detail-2min' | 'summary-only';

export type CanvasTraceSeverity = 'info' | 'warning' | 'critical';

export type CanvasTraceDataValue = string | number | boolean | null | undefined;

export type CanvasTraceData = Record<string, CanvasTraceDataValue>;

export type CanvasTraceEventType =
  | 'operation.pan'
  | 'operation.zoom'
  | 'operation.drag'
  | 'operation.boxSelect'
  | 'operation.import'
  | 'operation.save'
  | 'operation.viewer'
  | 'visibility.compute'
  | 'visibility.apply'
  | 'visibility.flush'
  | 'visibility.worker'
  | 'renderPlan.build'
  | 'reactFlow.nodesRefChange'
  | 'nodePatch.enqueue'
  | 'nodePatch.flush'
  | 'nodePatch.cancel'
  | 'imageManager.emit'
  | 'imageManager.request'
  | 'imageManager.ready'
  | 'imageManager.error'
  | 'imageManager.cancel'
  | 'resource.batch'
  | 'resource.register'
  | 'resource.request'
  | 'resource.cancel'
  | 'raster.readyStoreCommit'
  | 'raster.rebuild'
  | 'raster.draw'
  | 'raster.pixiFallback'
  | 'raster.backendFallback'
  | 'raster.textureUpload'
  | 'raster.textureEvict'
  | 'raster.spritePool'
  | 'thumbnail.queue'
  | 'thumbnail.start'
  | 'thumbnail.done'
  | 'thumbnail.error'
  | 'longtask'
  | 'frame.gap'
  | 'memory.sample'
  | 'summary.sample';

export interface CanvasPerformanceTraceEvent {
  ts: number;
  type: CanvasTraceEventType;
  phase: CanvasTraceEventPhase;
  durationMs?: number;
  opId?: string;
  frameId?: number;
  data?: CanvasTraceData;
}

export interface CanvasPerformanceTracePresetConfig {
  preset: CanvasTracePreset;
  durationMs: number;
  maxEvents: number;
  highFrequencyTypes: readonly CanvasTraceEventType[];
  frameGapThresholdMs: number;
  memorySampleIntervalMs: number;
  summarySampleIntervalMs: number;
}

export interface CanvasPerformanceTraceSummary {
  longTaskCount: number;
  maxLongTaskMs?: number;
  maxFrameGapMs?: number;
  maxRasterDrawMs?: number;
  maxImageEmitPerSec?: number;
  maxNodesRefChangePerSec?: number;
  maxPatchFlushMs?: number;
  totalEvents: number;
  recordedDurationMs: number;
}

export interface CanvasPerformanceTraceSuspect {
  severity: CanvasTraceSeverity;
  reason: string;
  atMs: number;
  evidence: CanvasTraceData;
}

export type CanvasPerformanceTraceCounterBucket = Record<string, number> & {
  second: number;
};

export interface CanvasPerformanceTraceExport {
  meta: {
    schemaVersion: 1;
    startedAt: string;
    exportedAt: string;
    durationMs: number;
    preset: CanvasTracePreset;
    userAgent: string;
  };
  summary: CanvasPerformanceTraceSummary;
  suspects: CanvasPerformanceTraceSuspect[];
  countersBySecond: CanvasPerformanceTraceCounterBucket[];
  timeline: CanvasPerformanceTraceEvent[];
  performanceSummary?: unknown;
}

export interface CanvasPerformanceTraceRecordInput {
  type: CanvasTraceEventType;
  phase?: CanvasTraceEventPhase;
  durationMs?: number;
  opId?: string;
  frameId?: number;
  data?: CanvasTraceData;
  ts?: number;
}
