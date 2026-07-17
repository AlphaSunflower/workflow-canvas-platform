import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkflowPersistence } from './workflow-persistence';

test('workflow persistence debounces rapid saves and only persists the latest payload', async () => {
  const savedPayloads: string[] = [];
  const persistence = createWorkflowPersistence<string, string>({
    debounceMs: 20,
    save: async (payload) => {
      savedPayloads.push(payload);
      return payload;
    },
  });

  const first = persistence.save('v1', { mode: 'debounced' });
  const second = persistence.save('v2', { mode: 'debounced' });
  const third = persistence.save('v3', { mode: 'debounced' });
  const settledPromise = Promise.allSettled([first, second, third]);

  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  const settled = await settledPromise;

  assert.equal(savedPayloads.length, 1);
  assert.deepEqual(savedPayloads, ['v3']);
  assert.equal(settled[0]?.status, 'rejected');
  assert.equal(settled[1]?.status, 'rejected');
  assert.equal(settled[2]?.status, 'fulfilled');
  assert.equal(settled[2]?.status === 'fulfilled' ? settled[2].value : '', 'v3');
});

test('workflow persistence single-flights concurrent immediate saves and runs trailing latest save', async () => {
  const savedPayloads: string[] = [];
  const firstSaveControl: { resolve: (() => void) | null } = { resolve: null };

  const persistence = createWorkflowPersistence<string, string>({
    debounceMs: 10,
    save: async (payload) => {
      savedPayloads.push(payload);
      if (payload === 'v1') {
        await new Promise<void>((resolve) => {
          firstSaveControl.resolve = resolve;
        });
      }
      return payload;
    },
  });

  const first = persistence.save('v1');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const second = persistence.save('v2');
  const third = persistence.save('v3');
  const settledPromise = Promise.allSettled([first, second, third]);

  assert.equal(persistence.getState().isSaving, true);
  assert.equal(persistence.getState().hasQueuedSave, true);

  if (!firstSaveControl.resolve) {
    throw new Error('Expected the first save to be in flight.');
  }

  firstSaveControl.resolve();

  const settled = await settledPromise;

  assert.deepEqual(savedPayloads, ['v1', 'v3']);
  assert.equal(settled[0]?.status, 'fulfilled');
  assert.equal(settled[1]?.status, 'rejected');
  assert.equal(settled[2]?.status, 'fulfilled');
  assert.equal(settled[2]?.status === 'fulfilled' ? settled[2].value : '', 'v3');
});

test('workflow persistence flush executes a scheduled save immediately', async () => {
  const savedPayloads: string[] = [];
  const persistence = createWorkflowPersistence<string, string>({
    debounceMs: 100,
    save: async (payload) => {
      savedPayloads.push(payload);
      return payload;
    },
  });

  const pending = persistence.save('flush-me', { mode: 'debounced' });
  const flushed = await persistence.flush();
  const result = await pending;

  assert.equal(flushed, 'flush-me');
  assert.equal(result, 'flush-me');
  assert.deepEqual(savedPayloads, ['flush-me']);
});

test('workflow persistence exposes lastError after a failed save and clears it on the next success', async () => {
  let shouldFail = true;
  const persistence = createWorkflowPersistence<string, string>({
    debounceMs: 10,
    save: async (payload) => {
      if (shouldFail) {
        throw new Error(`failed:${payload}`);
      }
      return payload;
    },
  });

  await assert.rejects(() => persistence.save('v1'));
  const failedError = persistence.getState().lastError;
  assert.equal(failedError instanceof Error, true);
  assert.equal(
    failedError instanceof Error
      ? failedError.message
      : '',
    'failed:v1',
  );

  shouldFail = false;
  const result = await persistence.save('v2');
  assert.equal(result, 'v2');
  assert.equal(persistence.getState().lastError, null);
});
