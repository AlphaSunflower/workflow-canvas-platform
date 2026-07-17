import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  WorkflowRuntimeSnapshot,
  WorkflowRuntimeSyncOptions,
} from '@/hooks/workflow/useWorkflow';
import type { Workflow } from '@/types';
import { buildWorkflowWithRuntime, createEmptyWorkflow } from '@/hooks/workflow/useWorkflow';
import { syncWorkflowRefWithRuntimeSnapshot } from './workflow-runtime-sync';

function createRuntimeSnapshot(x: number): WorkflowRuntimeSnapshot {
  return {
    nodes: {},
    connections: [],
    viewport: {
      x,
      y: 0,
      zoom: 1,
    },
  };
}

test('syncWorkflowRefWithRuntimeSnapshot updates workflowRef immediately', () => {
  const initialWorkflow = createEmptyWorkflow('project-runtime-ref-sync', 'Runtime Ref Sync');
  const workflowRef: { current: Workflow | null } = {
    current: initialWorkflow,
  };
  const runtimeSnapshot = createRuntimeSnapshot(180);

  const nextWorkflow = syncWorkflowRefWithRuntimeSnapshot(
    workflowRef,
    (runtime) => buildWorkflowWithRuntime(initialWorkflow, runtime, 100),
    runtimeSnapshot,
    { hydrateCanvas: true },
  );

  assert.ok(nextWorkflow);
  if (!nextWorkflow) {
    throw new Error('Expected next workflow to be returned');
  }
  assert.equal(nextWorkflow.viewport.x, 180);
  assert.equal(workflowRef.current, nextWorkflow);
});

test('syncWorkflowRefWithRuntimeSnapshot keeps current ref when runtime returns null', () => {
  const initialWorkflow = createEmptyWorkflow('project-runtime-ref-unchanged', 'Runtime Ref Unchanged');
  const workflowRef: { current: Workflow | null } = {
    current: initialWorkflow,
  };

  const nextWorkflow = syncWorkflowRefWithRuntimeSnapshot(
    workflowRef,
    () => null,
    createRuntimeSnapshot(200),
  );

  assert.equal(nextWorkflow, null);
  assert.equal(workflowRef.current, initialWorkflow);
});

test('syncWorkflowRefWithRuntimeSnapshot forwards hydration metadata', () => {
  const initialWorkflow = createEmptyWorkflow('project-runtime-ref-reason', 'Runtime Ref Reason');
  const workflowRef: { current: Workflow | null } = {
    current: initialWorkflow,
  };
  let seenOptions: WorkflowRuntimeSyncOptions | undefined;

  syncWorkflowRefWithRuntimeSnapshot(
    workflowRef,
    (runtime, options) => {
      seenOptions = options;
      return buildWorkflowWithRuntime(initialWorkflow, runtime, 101);
    },
    createRuntimeSnapshot(240),
    {
      hydrateCanvas: true,
      hydrationReason: 'external-output',
    },
  );

  assert.deepEqual(seenOptions, {
    hydrateCanvas: true,
    hydrationReason: 'external-output',
  });
});

test('syncWorkflowRefWithRuntimeSnapshot preserves runtime snapshot metadata across the workflow ref bridge', () => {
  const initialWorkflow = createEmptyWorkflow('project-runtime-ref-meta', 'Runtime Ref Meta');
  const workflowRef: { current: Workflow | null } = {
    current: initialWorkflow,
  };
  let seenRuntime: WorkflowRuntimeSnapshot | undefined;
  let seenOptions: WorkflowRuntimeSyncOptions | undefined;

  syncWorkflowRefWithRuntimeSnapshot(
    workflowRef,
    (runtime, options) => {
      seenRuntime = runtime;
      seenOptions = options;
      return buildWorkflowWithRuntime(initialWorkflow, runtime, 103);
    },
    {
      ...createRuntimeSnapshot(260),
      snapshotMeta: {
        source: 'external-output',
        scope: 'output-append',
        baseUpdatedAt: initialWorkflow.timestamp.updated,
        baseNodeCount: 0,
        baseConnectionCount: 0,
        affectedNodeIds: ['100'],
        allowNodeShrink: false,
      },
    },
    {
      hydrateCanvas: true,
      hydrationReason: 'external-output',
      runtimeSnapshotMeta: {
        sourceNodeId: '100',
      },
    },
  );

  assert.deepEqual(seenRuntime?.snapshotMeta, {
    source: 'external-output',
    scope: 'output-append',
    baseUpdatedAt: initialWorkflow.timestamp.updated,
    baseNodeCount: 0,
    baseConnectionCount: 0,
    sourceNodeId: '100',
    affectedNodeIds: ['100'],
    allowNodeShrink: false,
  });
  assert.deepEqual(seenOptions, {
    hydrateCanvas: true,
    hydrationReason: 'external-output',
    runtimeSnapshotMeta: {
      source: 'external-output',
      scope: 'output-append',
      baseUpdatedAt: initialWorkflow.timestamp.updated,
      baseNodeCount: 0,
      baseConnectionCount: 0,
      sourceNodeId: '100',
      affectedNodeIds: ['100'],
      allowNodeShrink: false,
    },
  });
});

test('syncWorkflowRefWithRuntimeSnapshot keeps workflowRef as the single authoritative workflow source', () => {
  const initialWorkflow = createEmptyWorkflow('project-runtime-ref-authoritative', 'Runtime Ref Authoritative');
  const workflowRef: { current: Workflow | null } = {
    current: initialWorkflow,
  };
  let applyCalls = 0;

  const nextWorkflow = syncWorkflowRefWithRuntimeSnapshot(
    workflowRef,
    (runtime) => {
      applyCalls += 1;
      return buildWorkflowWithRuntime(initialWorkflow, runtime, 102);
    },
    createRuntimeSnapshot(360),
  );

  assert.equal(applyCalls, 1);
  assert.equal(workflowRef.current, nextWorkflow);
  assert.equal(workflowRef.current?.viewport.x, 360);
  assert.equal(workflowRef.current?.nodes, nextWorkflow?.nodes);
  assert.equal(workflowRef.current?.connections, nextWorkflow?.connections);
});

test('canvas exposes a runtime sync flush delegate so saves can force workflowRef reconciliation before snapshot reads', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const runtimeFlushSource = readFileSync(
    `${cwd}/src/components/canvas/canvas-runtime-sync-flush.ts`,
    'utf8',
  );

  assert.equal(
    runtimeFlushSource.includes('export function flushCanvasRuntimeSync('),
    true,
  );
  assert.equal(
    runtimeFlushSource.includes('export function bindCanvasRuntimeSyncFlushDelegate('),
    true,
  );
});

test('canvas force-flush path forwards the force flag through hydration guards before runtime snapshot reconciliation', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const canvasSource = readFileSync(
    `${cwd}/src/components/canvas/Canvas.tsx`,
    'utf8',
  );

  assert.equal(
    canvasSource.includes('if (hasPendingExternalHydration(options.force)) {'),
    true,
  );
  assert.equal(
    canvasSource.includes('if (hasPendingExternalHydration(force)) {'),
    true,
  );
});

test('save preflight is centralized so auto-save callers delegate without local flush details', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const fileSyncCoordinatorSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-file-sync-coordinator.ts`,
    'utf8',
  );
  const persistenceCoordinatorSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-persistence-coordinator.ts`,
    'utf8',
  );

  assert.equal(
    fileSyncCoordinatorSource.includes("reason: 'auto-idle'"),
    false,
  );
  assert.equal(
    fileSyncCoordinatorSource.includes("reason: 'auto-fallback'"),
    false,
  );
  assert.equal(
    fileSyncCoordinatorSource.includes('requestWorkflowAutoSave(saveWorkflow, idleDecision.reason)'),
    true,
  );
  assert.equal(
    fileSyncCoordinatorSource.includes('requestWorkflowAutoSave(saveWorkflow, fallbackDecision.reason)'),
    true,
  );
  assert.equal(
    fileSyncCoordinatorSource.includes('flushCanvasRuntimeSync('),
    false,
  );
  assert.equal(
    fileSyncCoordinatorSource.includes('flushMediaLayoutRuntimeSync('),
    false,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('runWorkflowSavePreflight({'),
    true,
  );
});

test('workflow provider action source routes structural runtime sync through canvas flush while preserving direct runtime updates', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const providerSource = readFileSync(
    `${cwd}/src/components/context/workflow-provider-sources.ts`,
    'utf8',
  );

  assert.equal(
    providerSource.includes('syncRuntimeSnapshot: (runtimeSnapshot, options) => {'),
    true,
  );
  assert.equal(
    providerSource.includes('const flushedWorkflow = flushCanvasRuntimeSync({'),
    true,
  );
  assert.equal(
    providerSource.includes('updateRuntimeSnapshot: input.workflowActions.applyRuntimeSnapshot'),
    true,
  );
});
