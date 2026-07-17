import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData, StoryboardShotData } from '@/types';
import { aiStoryboardExecution, aiStoryboardNodeActions, getAIStoryboardActionIds } from './runtime';
import {
  AIStoryboardArrangeRequestController,
  applyStoryboardArrangeResult,
  getStoryboardArrangeReferenceCount,
  resolveStoryboardArrangeImageFileId,
  resolveAIStoryboardArrangeAvailability,
} from './arrange';

const importNodeFs = new Function('return import("node:fs")') as () => Promise<{
  readFileSync: (path: URL | string, encoding: string) => string;
}>;
const { readFileSync } = await importNodeFs();
const frontendRoot = (new Function('return process.cwd()') as () => string)();
const definitionSource = readFileSync(
  `${frontendRoot}/src/nodes/ai-storyboard/index.tsx`,
  'utf8',
);

function expectContains(source: string, pattern: RegExp, message?: string): void {
  assert.equal(pattern.test(source), true, message ?? `Expected source to match ${pattern}`);
}

function createShot(overrides: Partial<StoryboardShotData>): StoryboardShotData {
  return {
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
    prompt: '',
    imageModel: 'gemini-3-pro-image-preview',
    imageAspectRatio: 'auto',
    imageSize: '1K',
    videoModel: 'veo-3.1-landscape-fast-fl',
    videoDuration: 8,
    videoAspectRatio: '16:9',
    videoResolution: '720P',
    imageGenStatus: 'idle',
    videoGenStatus: 'idle',
    ...overrides,
  };
}

function createSourceNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  return {
    id: {
      value: 'source-node-1',
      display: '#source-node-1',
    },
    type: 'image',
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    rotation: 0,
    zIndex: 1,
    selected: false,
    dragging: false,
    fileId: 'local-file-1',
    fileName: 'source.png',
    fileSize: 1024,
    mimeType: 'image/png',
    backendFileId: undefined,
    source: {
      type: 'upload',
      sourceDisplayName: 'source.png',
      importedAt: Date.now(),
    },
    data: undefined,
    style: undefined,
    timestamp: {
      created: Date.now(),
      updated: Date.now(),
    },
    ...overrides,
  } as FileNodeData;
}

test('storyboard arrange stays on the formal node contract instead of a placeholder boundary', () => {
  assert.deepEqual(aiStoryboardNodeActions?.map((action) => action.id), [
    'arrange',
    'shot-image',
    'shot-video',
    'batch-video',
  ]);
  assert.deepEqual(getAIStoryboardActionIds(), [
    'arrange',
    'shot-image',
    'shot-video',
    'batch-video',
  ]);
  assert.equal(aiStoryboardExecution.mode, 'node-action-only');
  assert.equal(aiStoryboardExecution.canRun({} as never, []).valid, true);
  expectContains(definitionSource, /stage:\s*'full'/);
  expectContains(definitionSource, /actions:\s*aiStoryboardNodeActions/);
  expectContains(definitionSource, /execution:\s*aiStoryboardExecution/);
});

test('storyboard arrange availability only counts shots with reference images', () => {
  const shots = [
    createShot({ id: 'shot-a', imageFileId: 'file-a' }),
    createShot({ id: 'shot-b', sourceImageFileId: 'file-b' }),
    createShot({ id: 'shot-c' }),
  ];

  assert.equal(getStoryboardArrangeReferenceCount(shots), 2);

  const available = resolveAIStoryboardArrangeAvailability({
    shots,
  });
  assert.equal(available.enabled, true);
  assert.equal(available.referenceCount, 2);

  const unavailable = resolveAIStoryboardArrangeAvailability({
    shots: [createShot({ id: 'shot-empty' })],
    isArranging: true,
  });
  assert.equal(unavailable.enabled, false);
});

test('storyboard arrange request controller only accepts latest response', () => {
  const controller = new AIStoryboardArrangeRequestController();

  const first = controller.start();
  const second = controller.start();

  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(controller.finish(first.requestId), false);
  assert.equal(controller.finish(second.requestId), true);

  const third = controller.start();
  controller.cancel();
  assert.equal(third.signal.aborted, true);
  assert.equal(controller.finish(third.requestId), false);
});

test('resolveStoryboardArrangeImageFileId keeps an already-ready backend image file id', async () => {
  const shot = createShot({
    imageFileId: 'backend-image-ready',
    sourceImageFileId: 'fallback-image',
  });
  const sourceNode = createSourceNode();

  const resolved = await resolveStoryboardArrangeImageFileId({
    shot,
    sourceNode,
    isBackendFileReady: async (fileId) => fileId === 'backend-image-ready',
    ensureBackendFileId: async () => {
      throw new Error('ensureBackendFileId should not be called when imageFileId is valid');
    },
  });

  assert.equal(resolved, 'backend-image-ready');
});

test('resolveStoryboardArrangeImageFileId falls back to source node when shot image file id is stale', async () => {
  const shot = createShot({
    imageFileId: 'stale-local-or-missing-id',
    sourceImageFileId: 'old-fallback-id',
  });
  const sourceNode = createSourceNode();
  let ensureCalls = 0;

  const resolved = await resolveStoryboardArrangeImageFileId({
    shot,
    sourceNode,
    isBackendFileReady: async () => false,
    ensureBackendFileId: async (node) => {
      ensureCalls += 1;
      assert.equal(node.id.value, sourceNode.id.value);
      return 'backend-source-ready-id';
    },
  });

  assert.equal(resolved, 'backend-source-ready-id');
  assert.equal(ensureCalls, 1);
});

test('resolveStoryboardArrangeImageFileId uses ready fallback ids when no source node is available', async () => {
  const shot = createShot({
    imageFileId: 'missing-id',
    sourceImageFileId: 'backend-source-image',
    sourceFileId: 'local-source-file',
  });

  const resolved = await resolveStoryboardArrangeImageFileId({
    shot,
    sourceNode: null,
    isBackendFileReady: async (fileId) => fileId === 'backend-source-image',
    ensureBackendFileId: async () => null,
  });

  assert.equal(resolved, 'backend-source-image');
});

test('applyStoryboardArrangeResult updates arranged shots and appends untouched shots after them', () => {
  const shots = [
    createShot({ id: 'shot-a', order: 1, prompt: 'old A', imageFileId: 'file-a' }),
    createShot({ id: 'shot-b', order: 2, prompt: 'old B', imageFileId: 'file-b' }),
    createShot({ id: 'shot-c', order: 3, prompt: 'old C' }),
  ];

  const nextShots = applyStoryboardArrangeResult(shots, [
    {
      shotId: 'shot-b',
      order: 1,
      prompt: 'new B',
    },
    {
      shotId: 'shot-a',
      order: 2,
      prompt: 'new A',
    },
  ]);

  assert.deepEqual(nextShots.map((shot) => shot.id), ['shot-b', 'shot-a', 'shot-c']);
  assert.deepEqual(nextShots.map((shot) => shot.order), [1, 2, 3]);
  assert.equal(nextShots[0]?.prompt, 'new B');
  assert.equal(nextShots[1]?.prompt, 'new A');
  assert.equal(nextShots[2]?.prompt, 'old C');
  assert.equal(nextShots.every((shot) => shot.originalTotal === 3), true);
});
