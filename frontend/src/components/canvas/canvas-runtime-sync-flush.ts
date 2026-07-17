import type {
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
} from '@/contracts/workflow';

interface CanvasRuntimeSyncMetricOptions {
  batchId?: string;
  reason?: string;
  force?: boolean;
  allowNodeShrink?: boolean;
}

export interface CanvasRuntimeSyncFlushRequest extends CanvasRuntimeSyncMetricOptions {
  runtimeSnapshot?: WorkflowRuntimeSnapshot;
  runtimeSyncOptions?: WorkflowRuntimeSyncOptions;
}

type CanvasRuntimeSyncFlushDelegate = (
  options?: CanvasRuntimeSyncFlushRequest,
) => unknown;

let canvasRuntimeSyncFlushDelegate: CanvasRuntimeSyncFlushDelegate | null = null;

export function bindCanvasRuntimeSyncFlushDelegate(
  delegate: CanvasRuntimeSyncFlushDelegate | null,
): () => void {
  canvasRuntimeSyncFlushDelegate = delegate;

  return () => {
    if (canvasRuntimeSyncFlushDelegate === delegate) {
      canvasRuntimeSyncFlushDelegate = null;
    }
  };
}

export function flushCanvasRuntimeSync(
  options: CanvasRuntimeSyncFlushRequest = {},
): unknown {
  return canvasRuntimeSyncFlushDelegate?.(options) ?? null;
}

export type { CanvasRuntimeSyncMetricOptions };
