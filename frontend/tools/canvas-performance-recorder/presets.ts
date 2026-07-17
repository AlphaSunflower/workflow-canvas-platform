import type { CanvasPerformanceTracePresetConfig, CanvasTracePreset } from './schema';

const HIGH_FREQUENCY_TYPES = [
  'operation.pan',
  'operation.zoom',
  'imageManager.emit',
  'summary.sample',
] as const;

export function getCanvasPerformanceTracePreset(
  preset: CanvasTracePreset = '10min-default',
): CanvasPerformanceTracePresetConfig {
  switch (preset) {
    case 'high-detail-2min':
      return {
        preset,
        durationMs: 2 * 60 * 1000,
        maxEvents: 80_000,
        highFrequencyTypes: [],
        frameGapThresholdMs: 40,
        memorySampleIntervalMs: 1000,
        summarySampleIntervalMs: 1000,
      };
    case 'summary-only':
      return {
        preset,
        durationMs: 10 * 60 * 1000,
        maxEvents: 12_000,
        highFrequencyTypes: HIGH_FREQUENCY_TYPES,
        frameGapThresholdMs: 50,
        memorySampleIntervalMs: 1000,
        summarySampleIntervalMs: 1000,
      };
    case '10min-default':
    default:
      return {
        preset: '10min-default',
        durationMs: 10 * 60 * 1000,
        maxEvents: 50_000,
        highFrequencyTypes: HIGH_FREQUENCY_TYPES,
        frameGapThresholdMs: 50,
        memorySampleIntervalMs: 1000,
        summarySampleIntervalMs: 1000,
      };
  }
}
