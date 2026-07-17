import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAsyncTaskQueue,
  runWithConcurrency,
} from './async-pool';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

test('runWithConcurrency preserves result order while respecting the concurrency limit', async () => {
  const gates = [createDeferred(), createDeferred(), createDeferred(), createDeferred()];
  const started: number[] = [];
  let active = 0;
  let maxActive = 0;

  const resultPromise = runWithConcurrency([1, 2, 3, 4], 2, async (value, index) => {
    started.push(value);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await gates[index].promise;
    active -= 1;
    return value * 10;
  });

  await Promise.resolve();
  assert.deepEqual(started, [1, 2]);
  assert.equal(maxActive, 2);

  gates[1].resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  assert.deepEqual(started, [1, 2, 3]);

  gates[0].resolve();
  gates[2].resolve();
  gates[3].resolve();

  assert.deepEqual(await resultPromise, [10, 20, 30, 40]);
  assert.equal(maxActive, 2);
});

test('runWithConcurrency propagates worker errors to the caller', async () => {
  await assert.rejects(
    () => runWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) {
        throw new Error('worker failed');
      }
      return value;
    }),
    /worker failed/,
  );
});

test('createAsyncTaskQueue limits active tasks and resolves when idle', async () => {
  const gates = [createDeferred(), createDeferred(), createDeferred()];
  const started: number[] = [];
  let active = 0;
  let maxActive = 0;
  let idleCount = 0;

  const queue = createAsyncTaskQueue<number>({
    concurrency: 2,
    worker: async (value) => {
      started.push(value);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gates[value - 1].promise;
      active -= 1;
    },
    onIdle: () => {
      idleCount += 1;
    },
  });

  queue.enqueue(1);
  queue.enqueue(2);
  queue.enqueue(3);

  await Promise.resolve();
  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(queue.getStats(), {
    queued: 1,
    active: 2,
    concurrency: 2,
  });

  gates[0].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, [1, 2, 3]);

  gates[1].resolve();
  gates[2].resolve();
  await queue.whenIdle();

  assert.equal(maxActive, 2);
  assert.equal(idleCount, 1);
  assert.deepEqual(queue.getStats(), {
    queued: 0,
    active: 0,
    concurrency: 2,
  });
});

test('createAsyncTaskQueue reports errors and keeps draining later tasks', async () => {
  const errors: Array<{ error: unknown; item: number }> = [];
  const processed: number[] = [];

  const queue = createAsyncTaskQueue<number>({
    concurrency: 1,
    worker: async (value) => {
      processed.push(value);
      if (value === 2) {
        throw new Error('task failed');
      }
    },
    onTaskError: (error, item) => {
      errors.push({ error, item });
    },
  });

  queue.enqueue(1);
  queue.enqueue(2);
  queue.enqueue(3);
  await queue.whenIdle();

  assert.deepEqual(processed, [1, 2, 3]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].item, 2);
  assert.equal(
    (errors[0].error instanceof Error ? errors[0].error.message : '').includes('task failed'),
    true,
  );
});

test('createAsyncTaskQueue cancel clears queued work and resolves idle waiters', async () => {
  const gate = createDeferred();
  const processed: number[] = [];

  const queue = createAsyncTaskQueue<number>({
    concurrency: 1,
    worker: async (value) => {
      processed.push(value);
      await gate.promise;
    },
  });

  queue.enqueue(1);
  queue.enqueue(2);

  await Promise.resolve();
  queue.cancel();
  gate.resolve();
  await queue.whenIdle();

  assert.deepEqual(processed, [1]);
  assert.deepEqual(queue.getStats(), {
    queued: 0,
    active: 0,
    concurrency: 1,
  });
});
