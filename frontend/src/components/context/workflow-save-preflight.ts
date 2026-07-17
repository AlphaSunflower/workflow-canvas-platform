import { flushCanvasRuntimeSync } from '../canvas/canvas-runtime-sync-flush';
import { flushMediaLayoutRuntimeSync } from '../node/file/media-layout-runtime-sync';

export type WorkflowSavePreflightReason =
  | 'manual-save'
  | 'switch-save'
  | 'local-export'
  | 'auto-idle'
  | 'auto-fallback';

export interface WorkflowSavePreflightOptions {
  reason: WorkflowSavePreflightReason;
  force?: boolean;
  diagnosticTag?: string;
}

function resolveFlushReason(options: WorkflowSavePreflightOptions): string {
  return options.diagnosticTag ?? options.reason;
}

export function runWorkflowSavePreflight(
  options: WorkflowSavePreflightOptions,
): void {
  const flushReason = resolveFlushReason(options);
  const force = options.force ?? false;

  flushMediaLayoutRuntimeSync({
    reason: flushReason,
    force,
  });
  flushCanvasRuntimeSync({
    reason: flushReason,
    force,
  });
}
