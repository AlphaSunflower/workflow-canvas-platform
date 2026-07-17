import type {
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSnapshotMeta,
  WorkflowRuntimeSyncOptions,
} from '@/contracts/workflow';
import type { Workflow } from '@/types';

interface WorkflowRefLike {
  current: Workflow | null;
}

type ApplyRuntimeSnapshot = (
  runtimeSnapshot: WorkflowRuntimeSnapshot,
  options?: WorkflowRuntimeSyncOptions,
) => Workflow | null;

function normalizeRuntimeSnapshotMeta(
  runtimeSnapshot: WorkflowRuntimeSnapshot,
  options?: WorkflowRuntimeSyncOptions,
): WorkflowRuntimeSnapshotMeta | undefined {
  const mergedMeta = {
    ...(runtimeSnapshot.snapshotMeta ?? {}),
    ...(options?.runtimeSnapshotMeta ?? {}),
  };

  if (Object.keys(mergedMeta).length === 0) {
    return undefined;
  }

  if (
    mergedMeta.scope === 'output-append'
    && options?.hydrationReason === 'external-output'
    && mergedMeta.source === 'external-output'
  ) {
    return mergedMeta;
  }

  return mergedMeta;
}

export function syncWorkflowRefWithRuntimeSnapshot(
  workflowRef: WorkflowRefLike,
  applyRuntimeSnapshot: ApplyRuntimeSnapshot,
  runtimeSnapshot: WorkflowRuntimeSnapshot,
  options?: WorkflowRuntimeSyncOptions,
): Workflow | null {
  const normalizedRuntimeSnapshotMeta = normalizeRuntimeSnapshotMeta(runtimeSnapshot, options);
  const nextWorkflow = applyRuntimeSnapshot(
    normalizedRuntimeSnapshotMeta
      ? {
        ...runtimeSnapshot,
        snapshotMeta: normalizedRuntimeSnapshotMeta,
      }
      : runtimeSnapshot,
    normalizedRuntimeSnapshotMeta
      ? {
        ...options,
        runtimeSnapshotMeta: normalizedRuntimeSnapshotMeta,
      }
      : options,
  );
  if (nextWorkflow) {
    workflowRef.current = nextWorkflow;
  }

  return nextWorkflow;
}
