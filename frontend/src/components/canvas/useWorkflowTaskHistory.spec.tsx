import test from 'node:test';
import assert from 'node:assert/strict';

test('useWorkflowTaskHistory subscribes per task instead of subscribeAll and patches list items incrementally', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const source = readFileSync(
    `${cwd}/src/components/canvas/useWorkflowTaskHistory.ts`,
    'utf8',
  );

  assert.equal(source.includes('executionRuntimeStore.subscribeAll('), false);
  assert.equal(source.includes('executionRuntimeStore.subscribeTask(taskId, () => {'), true);
  assert.equal(source.includes('const taskSubscriptionsRef = useRef<Map<string, () => void>>(new Map());'), true);
  assert.equal(source.includes('taskSubscriptionsRef.current.forEach((unsubscribe, taskId) => {'), true);
  assert.equal(source.includes('canvasTaskHistoryStore.patchItem({'), true);
  assert.equal(source.includes('buildRuntimePatchedItem'), true);
});

test('useWorkflowTaskHistory keeps list state lightweight while detail loading remains separate', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const hookSource = readFileSync(
    `${cwd}/src/components/canvas/useWorkflowTaskHistory.ts`,
    'utf8',
  );
  const storeSource = readFileSync(
    `${cwd}/src/components/canvas/canvas-task-history.store.ts`,
    'utf8',
  );

  assert.equal(hookSource.includes('detailsByTaskId: snapshot.detailsByTaskId,'), true);
  assert.equal(storeSource.includes('export function createTaskHistorySummaryItem('), true);
  assert.equal(storeSource.includes('raw:'), false);
  assert.equal(storeSource.includes('inputPreviewItems: item.inputPreviewItems,'), true);
  assert.equal(storeSource.includes('artifactPreviewItems: item.artifactPreviewItems,'), true);
});
