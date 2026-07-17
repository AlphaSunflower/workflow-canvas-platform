import test from 'node:test';
import assert from 'node:assert/strict';

import { createImageImportCoordinator, type ImageImportCoordinatorTask } from './image-import-coordinator';

function createTask(
  nodeType: ImageImportCoordinatorTask['nodeType'],
  index: number,
  batchId = 'batch-1',
): ImageImportCoordinatorTask {
  return {
    batchId,
    file: new File([`${nodeType}-${index}`], `${nodeType}-${index}`),
    nodeId: {
      value: `${index}`,
      display: `#${index}`,
    },
    fileId: `file-${index}`,
    nodeType,
    metadata: {},
    sessionId: `session-${batchId}`,
  };
}

test('ImageImportCoordinator routes image and video work to independent queues and settles batches', async () => {
  const processed: string[] = [];
  const settledBatches: string[] = [];
  const coordinator = createImageImportCoordinator({
    imageConcurrency: 1,
    videoConcurrency: 1,
    processImageTask: async (task) => {
      processed.push(`image:${task.fileId}`);
    },
    processVideoTask: async (task) => {
      processed.push(`video:${task.fileId}`);
    },
    onBatchSettled: (batchId) => {
      settledBatches.push(batchId);
    },
  });

  coordinator.enqueue(createTask('image', 1));
  coordinator.enqueue(createTask('video', 2));
  coordinator.enqueue(createTask('ply', 3));
  await coordinator.whenIdle();

  assert.deepEqual(processed.sort(), ['image:file-1', 'video:file-2']);
  assert.deepEqual(settledBatches, ['batch-1']);
  assert.equal(coordinator.getStats().pendingBatches, 0);
});

test('ImageImportCoordinator cancel prevents queued work from mutating settled batch state', async () => {
  let releaseFirstTask: (() => void) | undefined;
  const processed: string[] = [];
  const settledBatches: string[] = [];
  const coordinator = createImageImportCoordinator({
    imageConcurrency: 1,
    processImageTask: async (task) => {
      processed.push(task.fileId);
      if (task.fileId === 'file-1') {
        await new Promise<void>((resolve) => {
          releaseFirstTask = resolve;
        });
      }
    },
    processVideoTask: async () => undefined,
    onBatchSettled: (batchId) => {
      settledBatches.push(batchId);
    },
  });

  coordinator.enqueue(createTask('image', 1));
  coordinator.enqueue(createTask('image', 2));
  coordinator.cancel();
  releaseFirstTask?.();
  await coordinator.whenIdle();

  assert.deepEqual(processed, ['file-1']);
  assert.deepEqual(settledBatches, []);
  assert.equal(coordinator.getStats().pendingBatches, 0);
});

test('ImageImportCoordinator settles a batch only after all queued image enhancements finish', async () => {
  const settledBatches: string[] = [];
  const releases = new Map<string, () => void>();
  const coordinator = createImageImportCoordinator({
    imageConcurrency: 2,
    videoConcurrency: 1,
    processImageTask: async (task) => {
      await new Promise<void>((resolve) => {
        releases.set(task.fileId, resolve);
      });
    },
    processVideoTask: async () => undefined,
    onBatchSettled: (batchId) => {
      settledBatches.push(batchId);
    },
  });

  coordinator.enqueue(createTask('image', 1, 'batch-settled'));
  coordinator.enqueue(createTask('image', 2, 'batch-settled'));

  await Promise.resolve();
  releases.get('file-1')?.();
  await Promise.resolve();

  assert.deepEqual(settledBatches, []);
  assert.equal(coordinator.getStats().pendingBatches, 1);

  releases.get('file-2')?.();
  await coordinator.whenIdle();

  assert.deepEqual(settledBatches, ['batch-settled']);
  assert.equal(coordinator.getStats().pendingBatches, 0);
});
