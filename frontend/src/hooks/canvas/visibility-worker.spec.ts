import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeVisibleNodes,
  serializeVisibleNodesInput,
  type ComputeVisibleNodesOptions,
} from './useVisibleNodes';
import {
  computeVisibleNodesWithWorker,
  resetVisibilityWorkerClientForTests,
} from './visibility-worker-client';
import { computeVisibleNodesSerialized } from './useVisibleNodes';

function createOptions(): ComputeVisibleNodesOptions {
  return {
    nodes: [
      {
        id: 'node-1',
        position: { x: 100, y: 120 },
        width: 240,
        height: 160,
        selected: false,
        data: {
          dimensions: { width: 240, height: 160 },
        },
      },
      {
        id: 'node-2',
        position: { x: 640, y: 480 },
        width: 280,
        height: 200,
        selected: true,
        data: {
          dimensions: { width: 280, height: 200 },
        },
      },
    ] as ComputeVisibleNodesOptions['nodes'],
    viewport: { x: -80, y: -100, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
    recentlyInteractedNodeIds: ['node-2'],
    importingNodeIds: ['node-1'],
  };
}

function createMockWorker() {
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let errorHandler: ((event: Event) => void) | null = null;

  return {
    worker: {
      addEventListener(type: string, listener: EventListener): void {
        if (type === 'message') {
          messageHandler = listener as (event: MessageEvent) => void;
        }
        if (type === 'error') {
          errorHandler = listener as (event: Event) => void;
        }
      },
      postMessage(message: { id: string; payload: ReturnType<typeof serializeVisibleNodesInput> }): void {
        const result = computeVisibleNodesSerialized(message.payload);
        queueMicrotask(() => {
          messageHandler?.({
            data: {
              id: message.id,
              success: true,
              result,
            },
          } as MessageEvent);
        });
      },
      terminate(): void {
        messageHandler = null;
        errorHandler = null;
      },
    } as unknown as Worker,
    emitError(): void {
      errorHandler?.({ type: 'error' } as Event);
    },
  };
}

test('visibility worker path matches main-thread compute results', async () => {
  resetVisibilityWorkerClientForTests();
  const options = createOptions();
  const mock = createMockWorker();
  const mainThread = computeVisibleNodes(options);
  const workerResult = await computeVisibleNodesWithWorker(options, {
    createWorker: () => mock.worker,
    compareWithMainThread: true,
  });

  assert.deepEqual(Array.from(workerResult.entries()), Array.from(mainThread.entries()));
  resetVisibilityWorkerClientForTests();
});

test('visibility worker payload preserves spatial candidate filtering', async () => {
  resetVisibilityWorkerClientForTests();
  const options: ComputeVisibleNodesOptions = {
    ...createOptions(),
    candidateNodeIds: ['node-1'],
  };
  const mock = createMockWorker();
  const workerResult = await computeVisibleNodesWithWorker(options, {
    createWorker: () => mock.worker,
    compareWithMainThread: true,
  });

  assert.equal(workerResult.has('node-1'), true);
  assert.equal(workerResult.has('node-2'), false);
  resetVisibilityWorkerClientForTests();
});

test('visibility serialization includes forced offscreen nodes for fallback updates', () => {
  const payload = serializeVisibleNodesInput({
    ...createOptions(),
    candidateNodeIds: ['node-1'],
    forcedOffscreenNodeIds: ['node-2'],
  });
  const result = computeVisibleNodesSerialized(payload);

  assert.equal(result.some((entry) => entry.nodeId === 'node-1'), true);
  assert.equal(result.find((entry) => entry.nodeId === 'node-2')?.visibility.renderTier, 'minimal');
  assert.equal(result.find((entry) => entry.nodeId === 'node-2')?.visibility.isVisible, false);
});

test('visibility worker client falls back to main thread after worker failure', async () => {
  resetVisibilityWorkerClientForTests();
  const options = createOptions();
  const mainThread = computeVisibleNodes(options);
  let errorHandler: ((event: Event) => void) | null = null;

  const worker = {
    addEventListener(type: string, listener: EventListener): void {
      if (type === 'error') {
        errorHandler = listener as (event: Event) => void;
      }
    },
    postMessage(): void {
      queueMicrotask(() => {
        errorHandler?.({ type: 'error' } as Event);
      });
    },
    terminate(): void {
      errorHandler = null;
    },
  } as unknown as Worker;

  const workerResult = await computeVisibleNodesWithWorker(options, {
    createWorker: () => worker,
  });

  assert.deepEqual(Array.from(workerResult.entries()), Array.from(mainThread.entries()));
  resetVisibilityWorkerClientForTests();
});
