import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompletedImportProgress,
  buildRunningImportProgressMessage,
  getCanvasImportProgressPercent,
  getCanvasImportProgressProcessed,
  type CanvasImportProgressState,
} from './canvas-import-progress';

function createRunningProgress(overrides: Partial<CanvasImportProgressState> = {}): CanvasImportProgressState {
  return {
    batchId: 'batch-1',
    total: 5,
    completed: 2,
    failed: 1,
    status: 'running',
    message: '正在导入 3 / 5',
    ...overrides,
  };
}

test('buildRunningImportProgressMessage formats running text', () => {
  assert.equal(buildRunningImportProgressMessage(3, 5), '正在导入 3 / 5');
});

test('buildCompletedImportProgress produces success completion copy', () => {
  const nextProgress = buildCompletedImportProgress(createRunningProgress(), 5, 0);

  assert.equal(nextProgress.status, 'completed');
  assert.equal(nextProgress.completed, 5);
  assert.equal(nextProgress.failed, 0);
  assert.equal(nextProgress.message, '导入完成，共导入 5 个文件');
});

test('buildCompletedImportProgress produces partial-failure completion copy', () => {
  const nextProgress = buildCompletedImportProgress(createRunningProgress(), 3, 2);

  assert.equal(nextProgress.status, 'completed');
  assert.equal(nextProgress.completed, 3);
  assert.equal(nextProgress.failed, 2);
  assert.equal(nextProgress.message, '导入完成，成功 3 个，失败 2 个');
});

test('canvas import progress helpers derive processed count and percent', () => {
  const progress = createRunningProgress({
    total: 6,
    completed: 4,
    failed: 1,
  });

  assert.equal(getCanvasImportProgressProcessed(progress), 5);
  assert.equal(getCanvasImportProgressPercent(progress), 83);
  assert.equal(getCanvasImportProgressProcessed(null), 0);
  assert.equal(getCanvasImportProgressPercent(null), 0);
});
