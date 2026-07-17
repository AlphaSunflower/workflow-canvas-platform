import test from 'node:test';
import assert from 'node:assert/strict';

test('SVR-10 keeps the persistence coordinator on a single authoritative workflow save path', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const persistenceCoordinatorSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-persistence-coordinator.ts`,
    'utf8',
  );
  const orchestratorSource = readFileSync(
    `${cwd}/src/components/context/workflow-save-orchestrator.ts`,
    'utf8',
  );

  assert.equal(
    persistenceCoordinatorSource.includes('const saveOrchestrator = useMemo(() => createWorkflowSaveOrchestrator({'),
    true,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('await saveOrchestrator.saveAuthoritativeWorkflow(saveOptions);'),
    true,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('saveRuntimeSnapshot'),
    false,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('if (!runtimeSnapshot) {'),
    false,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('saveWorkflowFromRuntimeSnapshot'),
    false,
  );
  assert.equal(
    orchestratorSource.includes('saveAuthoritativeWorkflow: ('),
    true,
  );
  assert.equal(
    orchestratorSource.includes('saveWorkflowFromRuntimeSnapshot'),
    false,
  );
  assert.equal(
    orchestratorSource.includes('const result = await workflowApi.save(nextWorkflow);'),
    true,
  );
});

test('SVR-10 removes runtime snapshot save compatibility from workflow context public actions', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const workflowContextSource = readFileSync(
    `${cwd}/src/components/context/WorkflowContext.tsx`,
    'utf8',
  );
  const workflowContextTypesSource = readFileSync(
    `${cwd}/src/components/context/workflow-context.types.ts`,
    'utf8',
  );
  const providerSourcesSource = readFileSync(
    `${cwd}/src/components/context/workflow-provider-sources.ts`,
    'utf8',
  );

  assert.equal(
    workflowContextSource.includes('saveRuntimeSnapshot: persistence.saveRuntimeSnapshot'),
    false,
  );
  assert.equal(
    workflowContextTypesSource.includes('saveRuntimeSnapshot: (runtime?: WorkflowRuntimeSnapshot, options?: WorkflowSaveOptions) => Promise<void>;'),
    false,
  );
  assert.equal(
    workflowContextTypesSource.includes('export type WorkflowRuntimeSnapshotSupplier = () => WorkflowRuntimeSnapshot | null;'),
    false,
  );
  assert.equal(
    providerSourcesSource.includes("| 'saveRuntimeSnapshot'"),
    false,
  );
  assert.equal(
    providerSourcesSource.includes('saveRuntimeSnapshot: input.persistenceActions.saveRuntimeSnapshot,'),
    false,
  );
});

test('SVR-10 keeps toolbar manual save on the shared saveWorkflow action only', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const toolbarSource = readFileSync(
    `${cwd}/src/components/workflow/Toolbar.tsx`,
    'utf8',
  );
  const toolbarSaveSource = readFileSync(
    `${cwd}/src/components/workflow/toolbar-save.ts`,
    'utf8',
  );

  assert.equal(
    toolbarSource.includes('await runToolbarSave(actions, {'),
    true,
  );
  assert.equal(
    toolbarSource.includes('saveRuntimeSnapshot'),
    false,
  );
  assert.equal(
    toolbarSaveSource.includes("await actions.saveWorkflow({ force: true, silent: false, reason: 'manual' });"),
    true,
  );
});

test('SVR-10 keeps auto-save on the same preflighted authoritative workflow save entry', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const autoSaveSource = readFileSync(
    `${cwd}/src/components/context/workflow-auto-save.ts`,
    'utf8',
  );
  const persistenceCoordinatorSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-persistence-coordinator.ts`,
    'utf8',
  );

  assert.equal(
    autoSaveSource.includes('await saveWorkflow(createWorkflowAutoSaveOptions(reason));'),
    true,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('runWorkflowSavePreflight({'),
    true,
  );
  assert.equal(
    persistenceCoordinatorSource.includes("await saveOrchestrator.saveAuthoritativeWorkflow(saveOptions);"),
    true,
  );
});

test('workflow file sync coordinator reads upload snapshots for the active workflow only', async () => {
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

  assert.equal(
    fileSyncCoordinatorSource.includes('workflowUploadScheduler.getSnapshot(undefined, workflow.workflow?.id ?? null)'),
    true,
  );
});

test('workflow file sync failures pause auto-save without disabling manual toolbar save', async () => {
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
  const providerSourcesSource = readFileSync(
    `${cwd}/src/components/context/workflow-provider-sources.ts`,
    'utf8',
  );
  const workflowContextSource = readFileSync(
    `${cwd}/src/components/context/WorkflowContext.tsx`,
    'utf8',
  );
  const stateSourceCallBlock = workflowContextSource.slice(
    workflowContextSource.indexOf('const stateSource = useMemo(() => createWorkflowProviderStateSource({'),
    workflowContextSource.indexOf('const actionSource = useMemo(() => createWorkflowProviderActionSource({'),
  );

  assert.equal(
    fileSyncCoordinatorSource.includes('fileSyncBlockReason: workflowFileSyncBlockReason,'),
    true,
  );
  assert.equal(
    fileSyncCoordinatorSource.includes('fileSyncBlockReason: autoSaveFileSyncBlockReasonRef.current,'),
    true,
  );
  assert.equal(
    providerSourcesSource.includes('workflowFileSyncBlockReason: string | null;'),
    false,
  );
  assert.equal(
    providerSourcesSource.includes('input.workflowFileSyncBlockReason'),
    false,
  );
  assert.equal(
    stateSourceCallBlock.includes('workflowFileSyncBlockReason'),
    false,
  );
});

test('SVR-10 keeps local export on the authoritative workflow projection path', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const fileActionsSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-file-actions.ts`,
    'utf8',
  );
  const authoritativeWorkflowSource = readFileSync(
    `${cwd}/src/components/context/workflow-authoritative-workflow.ts`,
    'utf8',
  );

  assert.equal(
    fileActionsSource.includes('const activeWorkflow = getAuthoritativeWorkflow();'),
    true,
  );
  assert.equal(
    fileActionsSource.includes('const exportWorkflow = createAuthoritativeWorkflowExportProjection(activeWorkflow, savedAt);'),
    true,
  );
  assert.equal(
    fileActionsSource.includes('resolveWorkflowRuntimeSnapshot('),
    false,
  );
  assert.equal(
    fileActionsSource.includes('commitRuntimeSnapshot('),
    false,
  );
  assert.equal(
    authoritativeWorkflowSource.includes('export function createAuthoritativeWorkflowExportProjection('),
    true,
  );
});
