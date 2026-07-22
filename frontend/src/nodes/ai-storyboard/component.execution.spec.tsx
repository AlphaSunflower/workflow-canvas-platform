import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, StoryboardShotData, Workflow } from '@/types';
import type { WorkflowNodeActionAccess } from '@/contracts/node-actions';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import { NODE_ACTION_ONLY_EXECUTION_MODE } from '@/execution-runtime/node-action-only-execution';
import {
  AIStoryboardShotImageRequestController,
  resolveAIStoryboardShotImageAvailability,
} from './shot-image-execution';
import {
  AIStoryboardShotVideoRequestController,
  getStoryboardShotVideoUnavailableReason,
  resolveAIStoryboardShotVideoAvailability,
} from './shot-video-execution';
import {
  getStoryboardExecutionDebtMap,
} from './storyboard-execution-service';
import {
  aiStoryboardExecution,
  aiStoryboardNodeActions,
  createAIStoryboardNodeActionOnlyExecutionRequest,
  getAIStoryboardActionIds,
} from './runtime';
import { defaultNodeActionServiceRegistry } from '../shared/node-action-service-registry.default';
import { runNodeAction } from '../shared/node-actions';

const importNodeFs = new Function('return import("node:fs")') as () => Promise<{
  readFileSync: (path: URL | string, encoding: string) => string;
}>;
const { readFileSync } = await importNodeFs();
const frontendRoot = (new Function('return process.cwd()') as () => string)();
const componentSource = readFileSync(
  `${frontendRoot}/src/nodes/ai-storyboard/component.tsx`,
  'utf8',
);
const definitionSource = readFileSync(
  `${frontendRoot}/src/nodes/ai-storyboard/index.tsx`,
  'utf8',
);
const workflowExecutionCoordinatorSource = readFileSync(
  `${frontendRoot}/src/components/context/coordinators/workflow-execution-coordinator.ts`,
  'utf8',
);

type LegacyStoryboardContextActionKeys = Extract<
  never,
  | 'arrangeStoryboardShots'
  | 'generateStoryboardShotImage'
  | 'generateStoryboardShotVideo'
  | 'batchGenerateStoryboardVideos'
  | 'updateAIStoryboardShots'
  | 'getAIStoryboardDebtMap'
>;

const workflowContextTypeGuards = {
  hasSharedActions: null as unknown as WorkflowNodeActionAccess,
  noLegacyStoryboardActions: true as LegacyStoryboardContextActionKeys extends never ? true : never,
};
void workflowContextTypeGuards;

function expectContains(source: string, pattern: RegExp, message?: string): void {
  assert.equal(pattern.test(source), true, message ?? `Expected source to match ${pattern}`);
}

function expectNotContains(source: string, pattern: RegExp, message?: string): void {
  assert.equal(pattern.test(source), false, message ?? `Expected source not to match ${pattern}`);
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

function createStoryboardWorkflow(): { workflow: Workflow; node: AINodeData } {
  const node = createDefaultAINodeData(
    createSequentialNodeId(200),
    { x: 100, y: 100 },
    'aiStoryboard',
  );
  node.config = {
    ...node.config,
    shots: [
      createShot({
        prompt: 'shot prompt',
        imageFileId: 'backend-image-file',
        sourceNodeId: 'source-node-1',
        sourceFileId: 'local-file-a',
        sourceImageFileId: 'backend-image-file',
      }),
    ],
  };

  return {
    node,
    workflow: {
      id: 'workflow-storyboard-execution',
      projectId: 'project-storyboard-execution',
      name: 'Storyboard Execution',
      nodes: {
        [node.id.value]: node,
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 200,
        canvasSize: { width: 1920, height: 1080 },
        relatedTasks: [],
        usedNodeIds: [node.id.value],
        releasedNodeIds: [],
      },
      timestamp: {
        created: 1,
        updated: 1,
      },
    },
  };
}

test('storyboard definition exposes a formal node-action-only execution contract', () => {
  assert.deepEqual(aiStoryboardNodeActions?.map((action) => action.id), [
    'arrange',
    'shot-image',
    'shot-video',
    'batch-video',
    'story-arrange',
  ]);
  assert.deepEqual(getAIStoryboardActionIds(), [
    'arrange',
    'shot-image',
    'shot-video',
    'batch-video',
    'story-arrange',
  ]);
  assert.equal(aiStoryboardExecution.mode, NODE_ACTION_ONLY_EXECUTION_MODE);
  assert.equal(aiStoryboardExecution.taskType, 'video-gen');
  assert.equal(aiStoryboardExecution.provider, 'laozhang');
  assert.equal(aiStoryboardExecution.canRun({} as never, []).valid, true);
  expectContains(definitionSource, /stage:\s*'full'/);
  expectContains(definitionSource, /actions:\s*aiStoryboardNodeActions/);
  expectContains(definitionSource, /execution:\s*aiStoryboardExecution/);
  assert.deepEqual(createAIStoryboardNodeActionOnlyExecutionRequest(), {
    boundary: NODE_ACTION_ONLY_EXECUTION_MODE,
    actionIds: ['arrange', 'shot-image', 'shot-video', 'batch-video', 'story-arrange'],
    plan: {
      files: [],
      references: [],
      config: {},
    },
  });
});

test('storyboard node actions forward target ids and options through the public action contract', async () => {
  const { workflow, node } = createStoryboardWorkflow();
  const calls: Array<{
    actionId: string;
    nodeId: string;
    targetId?: string;
    suppressNotifications?: boolean;
  }> = [];
  const services = {
    arrange: async (nodeId: string): Promise<void> => {
      calls.push({ actionId: 'arrange', nodeId });
    },
    runStoryArrange: async (nodeId: string, storyText: string, creationType: string): Promise<void> => {
      calls.push({ actionId: 'story-arrange', nodeId, targetId: `${storyText}:${creationType}` });
    },
    runShotImage: async (nodeId: string, targetId: string): Promise<void> => {
      calls.push({ actionId: 'shot-image', nodeId, targetId });
    },
    runShotVideo: async (
      nodeId: string,
      targetId: string,
      options?: { suppressNotifications?: boolean },
    ): Promise<void> => {
      calls.push({
        actionId: 'shot-video',
        nodeId,
        targetId,
        suppressNotifications: Boolean(options?.suppressNotifications),
      });
    },
    runBatchVideo: async (nodeId: string): Promise<void> => {
      calls.push({ actionId: 'batch-video', nodeId });
    },
  };

  for (const action of aiStoryboardNodeActions ?? []) {
    await action.run({
      workflow,
      node,
      inputs: [],
      targetId: action.targetRequired ? 'shot-1' : undefined,
      options: action.id === 'shot-video' ? { suppressNotifications: true } : {},
      services,
    });
  }

  assert.deepEqual(calls, [
    { actionId: 'arrange', nodeId: node.id.value },
    { actionId: 'shot-image', nodeId: node.id.value, targetId: 'shot-1' },
    {
      actionId: 'shot-video',
      nodeId: node.id.value,
      targetId: 'shot-1',
      suppressNotifications: true,
    },
    { actionId: 'batch-video', nodeId: node.id.value },
    { actionId: 'story-arrange', nodeId: node.id.value, targetId: ':custom' },
  ]);
});

test('runNodeAction rejects unknown storyboard shot targets before runner logic executes', async () => {
  const { workflow, node } = createStoryboardWorkflow();
  const services = {
    arrange: async (): Promise<void> => undefined,
    runStoryArrange: async (): Promise<void> => undefined,
    runShotImage: async (): Promise<void> => undefined,
    runShotVideo: async (): Promise<void> => undefined,
    runBatchVideo: async (): Promise<void> => undefined,
  };

  await assert.rejects(
    runNodeAction({
      workflow,
      node,
      actionId: 'shot-image',
      targetId: 'missing-shot',
      inputs: [],
      services,
      resolveNodeDefinition: (nodeType) => (
        nodeType === 'aiStoryboard' ? { actions: aiStoryboardNodeActions } : null
      ),
    }),
    /Current storyboard shot does not exist\./i,
  );
});

test('storyboard service registry resolves a facade-shaped service surface for aiStoryboard actions', () => {
  const { workflow, node } = createStoryboardWorkflow();
  const resolved = defaultNodeActionServiceRegistry.resolve({
    workflow,
    node,
    actionId: 'arrange',
    inputs: [],
    services: {},
  }) as Record<string, unknown>;

  assert.equal(typeof resolved.arrange, 'function');
  assert.equal(typeof resolved.runStoryArrange, 'function');
  assert.equal(typeof resolved.runShotImage, 'function');
  assert.equal(typeof resolved.runShotVideo, 'function');
  assert.equal(typeof resolved.runBatchVideo, 'function');
});

test('single-shot image execution availability requires prompt and reference image', () => {
  const disabledWithoutPrompt = resolveAIStoryboardShotImageAvailability({
    shot: createShot({ imageFileId: 'file-a' }),
  });
  assert.equal(disabledWithoutPrompt.enabled, false);

  const disabledWithoutImage = resolveAIStoryboardShotImageAvailability({
    shot: createShot({ prompt: 'shot prompt' }),
  });
  assert.equal(disabledWithoutImage.enabled, false);

  const enabled = resolveAIStoryboardShotImageAvailability({
    shot: createShot({ prompt: 'shot prompt', imageFileId: 'file-a' }),
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.reason, null);
});

test('single-shot video execution availability requires prompt and a confirmed reference image', () => {
  const disabledWhileGenerating = resolveAIStoryboardShotVideoAvailability({
    shot: createShot({ prompt: 'camera motion prompt', imageFileId: 'file-a', videoGenStatus: 'generating' }),
  });
  assert.equal(disabledWhileGenerating.enabled, false);

  const enabledWithGeneratedImage = resolveAIStoryboardShotVideoAvailability({
    shot: createShot({ prompt: 'camera motion prompt', imageFileId: 'backend-image-file' }),
  });
  assert.equal(enabledWithGeneratedImage.enabled, true);
  assert.equal(enabledWithGeneratedImage.reason, null);

  const enabledWithSourceNode = resolveAIStoryboardShotVideoAvailability({
    shot: createShot({
      prompt: 'camera motion prompt',
      sourceNodeId: 'node-image-1',
      sourceImageFileId: 'local-file-a',
      sourceFileId: 'local-file-a',
    }),
  });
  assert.equal(enabledWithSourceNode.enabled, true);
  assert.equal(enabledWithSourceNode.reason, null);

  const enabledWithLegacyBackendFallback = resolveAIStoryboardShotVideoAvailability({
    shot: createShot({
      prompt: 'camera motion prompt',
      sourceImageFileId: 'backend-file-a',
      sourceFileId: 'local-file-a',
    }),
  });
  assert.equal(enabledWithLegacyBackendFallback.enabled, true);
  assert.equal(enabledWithLegacyBackendFallback.reason, null);

  const ambiguousLocalFallbackShot = createShot({
    prompt: 'camera motion prompt',
    sourceImageFileId: 'local-file-a',
    sourceFileId: 'local-file-a',
  });
  const disabledWithAmbiguousLocalFallback = resolveAIStoryboardShotVideoAvailability({
    shot: ambiguousLocalFallbackShot,
  });
  assert.equal(disabledWithAmbiguousLocalFallback.enabled, false);
  assert.equal(
    disabledWithAmbiguousLocalFallback.reason,
    getStoryboardShotVideoUnavailableReason(ambiguousLocalFallbackShot),
  );
});

test('storyboard image and video request controllers cancel stale requests', () => {
  const imageController = new AIStoryboardShotImageRequestController();
  const firstImage = imageController.start();
  const secondImage = imageController.start();

  assert.equal(firstImage.signal.aborted, true);
  assert.equal(imageController.finish(firstImage.requestId), false);
  assert.equal(imageController.finish(secondImage.requestId), true);

  const videoController = new AIStoryboardShotVideoRequestController();
  const firstVideo = videoController.start();
  const secondVideo = videoController.start();

  assert.equal(firstVideo.signal.aborted, true);
  assert.equal(videoController.finish(firstVideo.requestId), false);
  assert.equal(videoController.finish(secondVideo.requestId), true);
});

test('batch storyboard video dispatch filters out generating shots and keeps original order', () => {
  const shots = [
    createShot({ id: 'shot-a', order: 1, videoGenStatus: 'idle' }),
    createShot({ id: 'shot-b', order: 2, videoGenStatus: 'generating' }),
    createShot({ id: 'shot-c', order: 3, videoGenStatus: 'failed' }),
  ];

  const executableShots = shots.filter((shot) => shot.videoGenStatus !== 'generating');

  assert.deepEqual(executableShots.map((shot) => shot.id), ['shot-a', 'shot-c']);
});

test('storyboard component smoke dispatches arrange and media actions through runNodeAction only', () => {
  expectContains(componentSource, /await actions\.runNodeAction\(\{\s*nodeId:\s*data\.id\.value,\s*actionId:\s*'shot-image',\s*targetId:\s*shotId,/s);
  expectContains(componentSource, /await actions\.runNodeAction\(\{\s*nodeId:\s*data\.id\.value,\s*actionId:\s*'shot-video',\s*targetId:\s*shotId,/s);
  expectContains(componentSource, /await actions\.runNodeAction\(\{\s*nodeId:\s*data\.id\.value,\s*actionId:\s*'arrange'/s);
  expectContains(componentSource, /void actions\.runNodeAction\(\{\s*nodeId:\s*data\.id\.value,\s*actionId:\s*'batch-video'/s);
  expectNotContains(
    componentSource,
    /actions\.generateStoryboardShotImage|actions\.generateStoryboardShotVideo|actions\.arrangeStoryboardShots|actions\.batchGenerateStoryboardVideos/,
  );
});

test('storyboard debt map keeps remaining context-owned service wiring explicit', () => {
  expectNotContains(
    workflowExecutionCoordinatorSource,
    /arrangeStoryboardShots:\s*aiStoryboardApi\.arrangeStoryboardShots/,
  );
  expectContains(
    workflowExecutionCoordinatorSource,
    /services:\s*\{[\s\S]*?commitBackendExecutionOutputs[\s\S]*?buildExecutionRuntimeAdapterContext[\s\S]*?setNodeExecutionState[\s\S]*?setGroupExecutionState/s,
  );
  expectNotContains(
    workflowExecutionCoordinatorSource,
    /setStoryboardNodeExecutionState|setStoryboardGroupExecutionState/,
  );
  assert.equal(
    getStoryboardExecutionDebtMap().some((item) => item.includes('node action service registry')),
    true,
  );
});
