import test from 'node:test';
import assert from 'node:assert/strict';

import { createThumbnailApplyScheduler } from './thumbnail-apply-scheduler';

function createManualFrameScheduler() {
  let nextFrameId = 0;
  const callbacks = new Map<number, () => void>();

  return {
    schedule(callback: FrameRequestCallback): number {
      nextFrameId += 1;
      callbacks.set(nextFrameId, () => callback(0));
      return nextFrameId;
    },
    cancel(frameId: number): void {
      callbacks.delete(frameId);
    },
    flushOne(): boolean {
      const next = callbacks.entries().next().value as [number, () => void] | undefined;
      if (!next) {
        return false;
      }

      const [frameId, callback] = next;
      callbacks.delete(frameId);
      callback();
      return true;
    },
    get size(): number {
      return callbacks.size;
    },
  };
}

test('thumbnail apply scheduler default flush respects the current frame budget', () => {
  const frames = createManualFrameScheduler();
  const applied: string[] = [];
  const scheduler = createThumbnailApplyScheduler({
    maxPerFrame: 2,
    requestAnimationFrameImpl: frames.schedule,
    cancelAnimationFrameImpl: frames.cancel,
  });

  scheduler.enqueue('a', { apply: () => applied.push('a') });
  scheduler.enqueue('b', { apply: () => applied.push('b') });
  scheduler.enqueue('c', { apply: () => applied.push('c') });

  scheduler.flush();

  assert.deepEqual(applied, ['a', 'b']);
  assert.equal(scheduler.getPendingCount(), 1);
  assert.equal(frames.size, 1);

  assert.equal(frames.flushOne(), true);
  assert.deepEqual(applied, ['a', 'b', 'c']);
});

test('thumbnail apply scheduler explicit flush limit overrides the default budget', () => {
  const frames = createManualFrameScheduler();
  const applied: string[] = [];
  const scheduler = createThumbnailApplyScheduler({
    maxPerFrame: 1,
    requestAnimationFrameImpl: frames.schedule,
    cancelAnimationFrameImpl: frames.cancel,
  });

  scheduler.enqueue('a', { apply: () => applied.push('a') });
  scheduler.enqueue('b', { apply: () => applied.push('b') });
  scheduler.enqueue('c', { apply: () => applied.push('c') });

  scheduler.flush({ limit: 2 });

  assert.deepEqual(applied, ['a', 'b']);
  assert.equal(scheduler.getPendingCount(), 1);
});
