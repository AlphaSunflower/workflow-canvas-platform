import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  AINodeData,
  FileInfo,
  FileNodeData,
  StoryboardConfig,
  StoryboardShotData,
  Workflow,
} from '@/types';
import type { ExecutionRuntimeRunState } from '@/execution-runtime/execution-runtime.types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import { AI_STORYBOARD_DEFAULT_SIZE } from './constants';
import { getAIStoryboardShotOutputHandle } from './groups';
import { applyStoryboardArrangeResult, resolveStoryboardArrangeImageFileId } from './arrange';
import {
  buildStoryboardConfigPatch,
  mergeStoryboardShotsFromInputs,
} from './shot-sync';
import type {
  StoryboardLocalState,
  StoryboardResolvedInputImage,
  StoryboardShotDefaults,
} from './types';
import { getStoryboardShotDefaults } from './types';
import {
  createStoryboardShotExecutionPayload,
  mergeStoryboardNodeTaskRefs,
  resolveStoryboardExecutionReferenceFileIds,
} from './storyboard-execution-service';
import { aiStoryboardExecutionRuntimeAdapter } from '@/execution-runtime/adapters/ai-storyboard.adapter';

const STORYBOARD_NODE_ID = '100';
const STORYBOARD_WORKFLOW_ID = 'workflow-storyboard-current-behavior';

function createShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
  return {
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
    sourceNodeId: '10',
    sourceFileId: 'source-file-1',
    sourceImageFileId: 'backend-source-1',
    imageFileId: undefined,
    videoFileId: undefined,
    prompt: 'camera move',
    imageModel: 'gemini-3-pro-image-preview',
    imageAspectRatio: 'auto',
    imageSize: '1K',
    videoModel: 'veo-3.1-landscape-fast-fl',
    videoDuration: 8,
    videoAspectRatio: '16:9',
    videoResolution: '720P',
    imageGenStatus: 'idle',
    imageGenMessage: undefined,
    imageGenRunId: undefined,
    videoGenStatus: 'idle',
    videoProgress: undefined,
    videoError: undefined,
    videoRunId: undefined,
    ...overrides,
  };
}

function createImageNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  return {
    ...createDefaultFileNodeData(
      createSequentialNodeId(10),
      { x: 0, y: 0 },
      'image',
      'source-file-1',
      'source.png',
      1024,
      'image/png',
      { width: 1024, height: 768 },
      {
        type: 'imported',
        sourceDisplayName: 'source.png',
        importedAt: 1,
      },
    ),
    ...overrides,
  };
}

function createStoryboardNode(overrides: Partial<AINodeData> = {}): AINodeData {
  const node = {
    ...createDefaultAINodeData(
      createSequentialNodeId(Number(STORYBOARD_NODE_ID)),
      { x: 100, y: 120 },
      'aiStoryboard',
    ),
    outputs: [],
    dimensions: { ...AI_STORYBOARD_DEFAULT_SIZE },
    tasks: [],
  } as AINodeData;

  node.config = {
    ...node.config,
    shots: [createShot()],
    processedInputFileIds: ['source-file-1'],
    defaultImageModel: 'gemini-3-pro-image-preview',
    defaultImageAspectRatio: 'auto',
    defaultImageSize: '1K',
    batchVideoModel: 'veo-3.1-landscape-fast-fl',
    batchVideoDuration: 8,
    batchVideoAspectRatio: '16:9',
    batchVideoResolution: '720P',
  } satisfies Partial<StoryboardConfig>;

  return {
    ...node,
    ...overrides,
  };
}

function createStoryboardWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const node = createStoryboardNode();
  return {
    id: STORYBOARD_WORKFLOW_ID,
    projectId: 'project-storyboard-current-behavior',
    name: 'Storyboard Current Behavior',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: Number(STORYBOARD_NODE_ID),
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: [STORYBOARD_NODE_ID],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
    ...overrides,
  };
}

function createDefaults(): StoryboardShotDefaults {
  return getStoryboardShotDefaults({
    defaultImageModel: 'gemini-3-pro-image-preview',
    defaultImageAspectRatio: 'auto',
    defaultImageSize: '1K',
    batchVideoModel: 'veo-3.1-landscape-fast-fl',
    batchVideoAspectRatio: '16:9',
    batchVideoResolution: '720P',
  });
}

function createResultFileInfo(fileType: 'image' | 'video', fileId: string): FileInfo {
  return fileType === 'image'
    ? {
      id: fileId,
      name: `${fileId}.png`,
      originalName: `${fileId}.png`,
      size: 1024,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image',
      status: 'ready',
      hash: `hash-${fileId}`,
      path: `/files/${fileId}/download`,
      metadata: {
        width: 1024,
        height: 768,
      },
      source: { type: 'node-output' },
      timestamp: { created: 1, updated: 1 },
    }
    : {
      id: fileId,
      name: `${fileId}.mp4`,
      originalName: `${fileId}.mp4`,
      size: 2048,
      mimeType: 'video/mp4',
      format: 'mp4',
      fileType: 'video',
      status: 'ready',
      hash: `hash-${fileId}`,
      path: `/files/${fileId}/download`,
      metadata: {
        width: 1920,
        height: 1080,
        duration: 8,
      },
      source: { type: 'node-output' },
      timestamp: { created: 1, updated: 1 },
    };
}

function createRunSnapshot(options: {
  fileType: 'image' | 'video';
  resultFileId: string;
  runId?: string;
  taskId?: string;
  groupId?: string;
}): ExecutionRuntimeRunState {
  const runId = options.runId ?? `run-${options.resultFileId}`;
  const taskId = options.taskId ?? `task-${options.resultFileId}`;
  const resultFileInfo = createResultFileInfo(options.fileType, options.resultFileId);

  return {
    runId,
    runNo: `RUN-${options.resultFileId}`,
    workflowId: STORYBOARD_WORKFLOW_ID,
    nodeId: STORYBOARD_NODE_ID,
    nodeType: 'aiStoryboard',
    status: 'completed',
    totalTaskCount: 1,
    completedTaskCount: 1,
    failedTaskCount: 0,
    progress: 100,
    message: 'done',
    createdAt: 1,
    startedAt: 2,
    completedAt: 3,
    isTerminal: true,
    hasCommittableOutput: true,
    allOutputsCommitted: false,
    tasks: [{
      taskId,
      taskNo: `TASK-${options.resultFileId}`,
      runId,
      runNo: `RUN-${options.resultFileId}`,
      nodeId: STORYBOARD_NODE_ID,
      nodeType: 'aiStoryboard',
      groupId: options.groupId ?? 'shot-1',
      groupOrder: 1,
      status: 'completed',
      currentStep: 'final',
      currentAttemptNo: 1,
      retryCount: 0,
      maxRetries: 2,
      maxAttempts: 3,
      progress: 100,
      message: 'done',
      error: null,
      errorCode: null,
      lastErrorCode: null,
      resultFileId: options.resultFileId,
      resultFileInfo,
      resultCommitStatus: 'ready',
      resultCommittedAt: null,
      resultCommitError: null,
      canCommitOutput: true,
      isTerminal: true,
      isOutputCommitted: false,
    }],
  };
}

function createPayload(
  node: AINodeData,
  shot: StoryboardShotData,
  mediaKind: 'image' | 'video',
) {
  return createStoryboardShotExecutionPayload(node, 'AI Storyboard', shot, mediaKind);
}

test('current arrange behavior keeps untouched shots and normalizes final order', () => {
  const shots = [
    createShot({ id: 'shot-a', order: 1, prompt: 'old A', imageFileId: 'file-a' }),
    createShot({ id: 'shot-b', order: 2, prompt: 'old B', imageFileId: 'file-b' }),
    createShot({ id: 'shot-c', order: 3, prompt: 'old C' }),
  ];

  const arranged = applyStoryboardArrangeResult(shots, [
    { shotId: 'shot-b', order: 1, prompt: 'new B' },
    { shotId: 'shot-a', order: 2, prompt: 'new A' },
  ]);

  assert.deepEqual(arranged.map((shot) => shot.id), ['shot-b', 'shot-a', 'shot-c']);
  assert.deepEqual(arranged.map((shot) => shot.order), [1, 2, 3]);
  assert.deepEqual(arranged.map((shot) => shot.prompt), ['new B', 'new A', 'old C']);
  assert.deepEqual(arranged.map((shot) => shot.originalTotal), [3, 3, 3]);
});

test('current arrange file-id resolution prefers ready generated image then source node then ready fallback', async () => {
  const sourceNode = createImageNode();
  const readyGenerated = await resolveStoryboardArrangeImageFileId({
    shot: createShot({ imageFileId: 'generated-ready', sourceImageFileId: 'fallback-ready' }),
    sourceNode,
    isBackendFileReady: async (fileId) => fileId === 'generated-ready',
    ensureBackendFileId: async () => {
      throw new Error('source node should not be used when generated image is ready');
    },
  });
  const sourceFallback = await resolveStoryboardArrangeImageFileId({
    shot: createShot({ imageFileId: 'stale-generated', sourceImageFileId: 'fallback-ready' }),
    sourceNode,
    isBackendFileReady: async () => false,
    ensureBackendFileId: async () => 'backend-source-ready',
  });
  const readyFallback = await resolveStoryboardArrangeImageFileId({
    shot: createShot({ imageFileId: 'missing-generated', sourceImageFileId: 'backend-fallback' }),
    sourceNode: null,
    isBackendFileReady: async (fileId) => fileId === 'backend-fallback',
    ensureBackendFileId: async () => null,
  });

  assert.equal(readyGenerated, 'generated-ready');
  assert.equal(sourceFallback, 'backend-source-ready');
  assert.equal(readyFallback, 'backend-fallback');
});

test('current input sync appends new image inputs once and preserves processed input ids', () => {
  const defaults = createDefaults();
  const currentState: StoryboardLocalState = {
    shots: [],
    processedInputFileIds: [],
  };
  const inputs: StoryboardResolvedInputImage[] = [
    {
      sourceNodeId: '10',
      sourceFileId: 'source-file-1',
      sourceImageFileId: 'source-file-1',
      sourceNode: createImageNode(),
      fileName: 'source-1.png',
      promptHint: 'prompt one',
      order: 0,
    },
    {
      sourceNodeId: '11',
      sourceFileId: 'source-file-2',
      sourceImageFileId: 'source-file-2',
      sourceNode: createImageNode({
        id: { value: '11', display: '#11' },
        fileId: 'source-file-2',
        fileName: 'source-2.png',
      }),
      fileName: 'source-2.png',
      promptHint: 'prompt two',
      order: 1,
    },
  ];

  const once = mergeStoryboardShotsFromInputs(currentState, inputs, defaults);
  const twice = mergeStoryboardShotsFromInputs(once, inputs, defaults);
  const patch = buildStoryboardConfigPatch({}, once);

  assert.deepEqual(once.processedInputFileIds, ['source-file-1', 'source-file-2']);
  assert.deepEqual(once.shots.map((shot) => shot.prompt), ['prompt one', 'prompt two']);
  assert.equal(twice.shots.length, 2);
  assert.deepEqual(twice.processedInputFileIds, ['source-file-1', 'source-file-2']);
  assert.deepEqual(patch.processedInputFileIds, ['source-file-1', 'source-file-2']);
});

test('current execution payload keeps shot id as group id and routes output through the shot handle', () => {
  const node = createStoryboardNode();
  const shot = (node.config.shots as StoryboardShotData[])[0];
  assert.ok(shot);

  const imagePayload = createPayload(node, shot, 'image');
  const videoPayload = createPayload(node, shot, 'video');

  assert.equal(imagePayload.taskType, 'image-gen');
  assert.equal(videoPayload.taskType, 'video-gen');
  assert.equal(imagePayload.targets[0]?.groupId, shot.id);
  assert.equal(videoPayload.targets[0]?.groupId, shot.id);
  assert.equal(imagePayload.targets[0]?.outputHandle, getAIStoryboardShotOutputHandle(shot.id));
  assert.equal(videoPayload.targets[0]?.outputHandle, getAIStoryboardShotOutputHandle(shot.id));
});

test('current task ref merge replaces older refs for same shot output identity', () => {
  const outputHandle = getAIStoryboardShotOutputHandle('shot-1');
  const merged = mergeStoryboardNodeTaskRefs([
    {
      taskId: 'task-old',
      runId: 'run-old',
      taskType: 'video-gen',
      scope: 'group',
      groupId: 'shot-1',
      outputHandle,
      status: 'processing',
      createdAt: 1,
    },
  ], {
    taskId: 'task-new',
    runId: 'run-new',
    taskType: 'video-gen',
    scope: 'group',
    groupId: 'shot-1',
    outputHandle,
    status: 'processing',
    createdAt: 2,
  });

  assert.deepEqual(merged.map((taskRef) => taskRef.taskId), ['task-new']);
});

test('current task ref merge still keeps same-shot image and video refs separated after identity normalization', () => {
  const outputHandle = getAIStoryboardShotOutputHandle('shot-1');
  const merged = mergeStoryboardNodeTaskRefs([{
    taskId: 'task-image-old',
    runId: 'run-image-old',
    taskType: 'image-gen',
    scope: 'group',
    groupId: 'shot-1',
    outputHandle,
    status: 'completed',
    createdAt: 1,
  }], {
    taskId: 'task-video-new',
    runId: 'run-video-new',
    taskType: 'video-gen',
    scope: 'group',
    groupId: 'shot-1',
    outputHandle,
    status: 'processing',
    createdAt: 2,
  });

  assert.deepEqual(
    merged.map((taskRef) => `${taskRef.taskType}:${taskRef.taskId}`).sort(),
    ['image-gen:task-image-old', 'video-gen:task-video-new'],
  );
});

test('current reference resolution accepts generated image, source-node backend id, and confirmed legacy fallback only', async () => {
  const generated = await resolveStoryboardExecutionReferenceFileIds({
    shot: createShot({ imageFileId: 'generated-image', sourceImageFileId: 'source-local', sourceFileId: 'source-local' }),
    sourceNode: null,
    maxReferences: 5,
    ensureBackendFileId: async () => null,
  });
  const sourceNode = await resolveStoryboardExecutionReferenceFileIds({
    shot: createShot({ imageFileId: undefined, sourceImageFileId: 'source-local', sourceFileId: 'source-local' }),
    sourceNode: createImageNode(),
    maxReferences: 5,
    ensureBackendFileId: async () => 'backend-source-id',
  });
  const legacyFallback = await resolveStoryboardExecutionReferenceFileIds({
    shot: createShot({ imageFileId: undefined, sourceImageFileId: 'backend-fallback', sourceFileId: 'local-source' }),
    sourceNode: null,
    maxReferences: 5,
    ensureBackendFileId: async () => null,
  });
  const ambiguousLocal = await resolveStoryboardExecutionReferenceFileIds({
    shot: createShot({ imageFileId: undefined, sourceImageFileId: 'local-source', sourceFileId: 'local-source' }),
    sourceNode: null,
    maxReferences: 5,
    ensureBackendFileId: async () => null,
  });

  assert.deepEqual(generated.referenceFileIds, ['generated-image']);
  assert.deepEqual(sourceNode.referenceFileIds, ['backend-source-id']);
  assert.deepEqual(legacyFallback.referenceFileIds, ['backend-fallback']);
  assert.deepEqual(ambiguousLocal.referenceFileIds, []);
  assert.equal(typeof ambiguousLocal.unavailableReason, 'string');
});

test('current adapter extracts image and video outputs onto the storyboard shot output handle', () => {
  const workflow = createStoryboardWorkflow();
  const node = workflow.nodes[STORYBOARD_NODE_ID] as AINodeData;
  const shot = (node.config.shots as StoryboardShotData[])[0];
  assert.ok(shot);
  const imageSnapshot = createRunSnapshot({ fileType: 'image', resultFileId: 'storyboard-image-result' });
  const videoSnapshot = createRunSnapshot({ fileType: 'video', resultFileId: 'storyboard-video-result' });

  const imageOutputs = aiStoryboardExecutionRuntimeAdapter.extractExecutionOutputs(imageSnapshot, {
    workflowId: workflow.id,
    nodeId: STORYBOARD_NODE_ID,
    payload: createPayload(node, shot, 'image'),
    previousSnapshot: null,
  });
  const videoOutputs = aiStoryboardExecutionRuntimeAdapter.extractExecutionOutputs(videoSnapshot, {
    workflowId: workflow.id,
    nodeId: STORYBOARD_NODE_ID,
    payload: createPayload(node, shot, 'video'),
    previousSnapshot: null,
  });

  assert.equal(imageOutputs[0]?.taskType, 'image-gen');
  assert.equal(videoOutputs[0]?.taskType, 'video-gen');
  assert.equal(imageOutputs[0]?.sourceHandle, getAIStoryboardShotOutputHandle(shot.id));
  assert.equal(videoOutputs[0]?.sourceHandle, getAIStoryboardShotOutputHandle(shot.id));
  assert.equal(imageOutputs[0]?.groupOrder, shot.order);
  assert.equal(videoOutputs[0]?.groupOrder, shot.order);
});

test('current adapter does not create canvas file nodes for storyboard outputs', async () => {
  let workflow = createStoryboardWorkflow();
  const node = workflow.nodes[STORYBOARD_NODE_ID] as AINodeData;
  const shot = (node.config.shots as StoryboardShotData[])[0];
  assert.ok(shot);

  const commitSnapshot = async (
    snapshot: ExecutionRuntimeRunState,
    mediaKind: 'image' | 'video',
  ): Promise<{ changed: boolean }> => {
    const outputs = aiStoryboardExecutionRuntimeAdapter.extractExecutionOutputs(snapshot, {
      workflowId: workflow.id,
      nodeId: STORYBOARD_NODE_ID,
      payload: createPayload(node, shot, mediaKind),
      previousSnapshot: null,
    });
    const output = outputs[0];
    assert.ok(output);
    if (!output) {
      throw new Error('Expected storyboard output');
    }

    const result = await aiStoryboardExecutionRuntimeAdapter.commitExecutionOutputs?.({
      workflowId: workflow.id,
      runId: snapshot.runId,
      node,
      snapshot,
      payload: createPayload(node, shot, mediaKind),
      adapter: aiStoryboardExecutionRuntimeAdapter,
      adapterContext: {
        workflowId: workflow.id,
        workflow,
        node,
        nodeTitle: 'AI Storyboard',
        inputs: [],
        resolvedInputGroups: [],
        services: {},
      },
      workflowAccess: {
        getCurrentWorkflow: () => workflow,
        applyRuntimeSnapshot: (runtime) => {
          workflow = {
            ...workflow,
            nodes: runtime.nodes,
            connections: runtime.connections,
            viewport: runtime.viewport,
            metadata: {
              ...workflow.metadata,
              ...runtime.metadata,
            },
          };
          return workflow;
        },
        resolveFileUrl: (fileId) => `/files/${fileId}/download`,
      },
      currentWorkflow: workflow,
      preparedOutputs: [{
        output,
        fileInfo: output.resultFile,
        runtimeResource: null,
      }],
    });

    return result ?? { changed: false };
  };

  // Image outputs: no-op (displayed in shot preview, not as canvas file nodes)
  const imageResult = await commitSnapshot(
    createRunSnapshot({ fileType: 'image', resultFileId: 'storyboard-image-result' }),
    'image',
  );
  assert.deepEqual(imageResult, { changed: false });

  // Video outputs: creates file nodes on the canvas connected to the output handle
  const videoResult = await commitSnapshot(
    createRunSnapshot({ fileType: 'video', resultFileId: 'storyboard-video-result' }),
    'video',
  );
  assert.deepEqual(videoResult, { changed: true });

  // Verify video file node was created, but image was not
  const outputNodes = Object.values(workflow.nodes).filter((candidate) => (
    'fileId' in candidate
    && (candidate.fileId === 'storyboard-image-result' || candidate.fileId === 'storyboard-video-result')
  ));
  const outputLinks = workflow.connections.filter((connection) => connection.type === 'output-link');

  assert.equal(outputNodes.length, 1, 'should create a file node for video only');
  assert.equal(outputLinks.length, 1, 'should create an output-link connection for video only');
});

test('current committed-state check treats stale storyboard snapshots as already handled', async () => {
  const workflow = createStoryboardWorkflow();
  const node = workflow.nodes[STORYBOARD_NODE_ID] as AINodeData;
  const shot = (node.config.shots as StoryboardShotData[])[0];
  assert.ok(shot);
  node.tasks = [{
    taskId: 'task-newer',
    runId: 'run-newer',
    taskType: 'video-gen',
    scope: 'group',
    groupId: shot.id,
    outputHandle: getAIStoryboardShotOutputHandle(shot.id),
    status: 'completed',
    createdAt: 2,
  }];
  workflow.metadata.relatedTasks = [{
    taskId: 'task-newer',
    taskNo: 'TASK-NEWER',
    runId: 'run-newer',
    runNo: 'RUN-NEWER',
    taskType: 'video-gen',
    nodeId: STORYBOARD_NODE_ID,
    nodeDisplayId: node.id.display,
    nodeType: 'aiStoryboard',
    groupId: shot.id,
    outputHandle: getAIStoryboardShotOutputHandle(shot.id),
  }];

  const staleSnapshot = createRunSnapshot({
    fileType: 'video',
    resultFileId: 'storyboard-video-stale',
    runId: 'run-stale',
    taskId: 'task-stale',
  });
  const staleOutput = aiStoryboardExecutionRuntimeAdapter.extractExecutionOutputs(staleSnapshot, {
    workflowId: workflow.id,
    nodeId: STORYBOARD_NODE_ID,
    payload: createPayload(node, shot, 'video'),
    previousSnapshot: null,
  })[0];

  assert.ok(staleOutput);
  if (!staleOutput) {
    throw new Error('Expected stale storyboard output');
  }

  const committed = await aiStoryboardExecutionRuntimeAdapter.isOutputCommitted?.({
    workflow,
    node,
    snapshot: staleSnapshot,
    payload: createPayload(node, shot, 'video'),
    output: staleOutput,
    adapterContext: {
      workflowId: workflow.id,
      workflow,
      node,
      nodeTitle: 'AI Storyboard',
      inputs: [],
      resolvedInputGroups: [],
      services: {},
    },
    workflowAccess: {
      getCurrentWorkflow: () => workflow,
      applyRuntimeSnapshot: () => workflow,
      resolveFileUrl: (fileId) => `/files/${fileId}/download`,
    },
  });

  assert.equal(committed, true);
});
