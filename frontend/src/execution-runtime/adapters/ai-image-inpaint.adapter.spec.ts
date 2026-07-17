import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import type { Workflow, AINodeData } from '@/types';
import { getAIImageInpaintInputHandle } from '@/nodes/ai-image-inpaint/groups';
import { AI_IMAGE_INPAINT_GROUP_ID, AI_IMAGE_INPAINT_INPUT_PORT_ID } from '@/nodes/ai-image-inpaint/constants';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import type { ExecutionRuntimeNodeAdapterContext } from '../node-execution-adapter.types';
import type { ExecutionRuntimeRunState } from '../execution-runtime.types';
import { aiImageInpaintExecutionRuntimeAdapter } from './ai-image-inpaint.adapter';
import { registerAIImageInpaintMaskExporter } from '@/nodes/ai-image-inpaint/export-registry';
import type { AIImageInpaintMaskStroke } from '@/nodes/ai-image-inpaint/mask-strokes';

const SAMPLE_MASK_STROKES: AIImageInpaintMaskStroke[] = [{
  id: 'stroke-1',
  tool: 'brush',
  brushSize: 24,
  points: [
    { x: 12, y: 18 },
    { x: 42, y: 54 },
  ],
}];

function createImageNode(sequence: number, fileId: string, fileName: string) {
  return createDefaultFileNodeData(
    createSequentialNodeId(sequence),
    { x: sequence * 10, y: sequence * 10 },
    'image',
    fileId,
    fileName,
    1024,
    'image/png',
    {
      width: 1024,
      height: 768,
    },
  );
}

function createWorkflow(node: AINodeData, fileNodes: ReturnType<typeof createImageNode>[]): Workflow {
  const nodes: Workflow['nodes'] = {
    [node.id.value]: node,
  };

  fileNodes.forEach((fileNode) => {
    nodes[fileNode.id.value] = fileNode;
  });

  return {
    id: 'workflow-ai-image-inpaint',
    projectId: 'project-ai-image-inpaint',
    name: '图片局部重绘测试画布',
    nodes,
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: Object.keys(nodes).length,
      connectionCount: 0,
      lastNodeId: Math.max(...Object.keys(nodes).map((value) => Number.parseInt(value, 10))),
      canvasSize: {
        width: 1920,
        height: 1080,
      },
      relatedTasks: [],
      usedNodeIds: Object.keys(nodes),
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createResolvedGroup(inputNodes: ReturnType<typeof createImageNode>[]): WorkflowResolvedNodeGroupState {
  return {
    group: {
      id: AI_IMAGE_INPAINT_GROUP_ID,
      label: '原图',
      order: 0,
    },
    ports: [{
      portId: AI_IMAGE_INPAINT_INPUT_PORT_ID,
      label: '原图',
      handle: getAIImageInpaintInputHandle(),
      inputs: inputNodes.map((sourceNode, index) => ({
        groupId: AI_IMAGE_INPAINT_GROUP_ID,
        portId: AI_IMAGE_INPAINT_INPUT_PORT_ID,
        handle: getAIImageInpaintInputHandle(),
        connection: {
          id: `connection-main-${index + 1}`,
          type: 'file-reference',
          sourceId: sourceNode.id.value,
          targetId: '100',
          targetHandle: getAIImageInpaintInputHandle(),
          order: index,
        },
        sourceNode,
      })),
    }],
  };
}

function createContext(options: {
  prompt?: string;
  hasMaskMarks?: boolean;
  maskStrokes?: AIImageInpaintMaskStroke[];
  maskMode?: string;
  groups: WorkflowResolvedNodeGroupState[];
  services?: ExecutionRuntimeNodeAdapterContext['services'];
}): ExecutionRuntimeNodeAdapterContext {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiImageInpaint',
  );

  node.config = {
    ...node.config,
    prompt: options.prompt ?? '把标记区域改成木质纹理',
    model: 'gemini-3-pro-image-preview',
    imageSize: '2K',
    aspectRatio: '16:9',
    maskMode: options.maskMode ?? 'original-markup',
    hasMaskMarks: options.hasMaskMarks ?? true,
    maskStrokes: options.maskStrokes ?? (options.hasMaskMarks === false ? [] : SAMPLE_MASK_STROKES),
  };

  const fileNodes = options.groups.flatMap((group) => group.ports.flatMap((port) => port.inputs.map((input) => input.sourceNode)));

  return {
    workflowId: 'workflow-ai-image-inpaint',
    workflow: createWorkflow(node, fileNodes),
    node,
    nodeTitle: '图片局部重绘',
    inputs: [],
    resolvedInputGroups: options.groups,
    services: options.services,
  };
}

function createRunSnapshot(): ExecutionRuntimeRunState {
  return {
    runId: 'run-ai-image-inpaint',
    runNo: 'RUN-AI-INPAINT-001',
    workflowId: 'workflow-ai-image-inpaint',
    nodeId: '100',
    nodeType: 'aiImageInpaint',
    status: 'completed',
    totalTaskCount: 1,
    completedTaskCount: 1,
    failedTaskCount: 0,
    progress: 100,
    message: 'completed',
    createdAt: 1,
    startedAt: 2,
    completedAt: 3,
    isTerminal: true,
    hasCommittableOutput: true,
    allOutputsCommitted: false,
    tasks: [
      {
        taskId: 'task-inpaint-main',
        taskNo: 'TASK-INPAINT-001',
        runId: 'run-ai-image-inpaint',
        runNo: 'RUN-AI-INPAINT-001',
        nodeId: '100',
        nodeType: 'aiImageInpaint',
        groupId: AI_IMAGE_INPAINT_GROUP_ID,
        groupOrder: 0,
        status: 'completed',
        currentStep: 'final',
        currentAttemptNo: 1,
        retryCount: 0,
        maxRetries: 2,
        maxAttempts: 3,
        progress: 100,
        message: 'completed',
        error: null,
        errorCode: null,
        lastErrorCode: null,
        resultFileId: 'inpaint-result-file',
        resultFileInfo: {
          id: 'inpaint-result-file',
          name: 'inpaint-result-file.png',
          originalName: 'inpaint-result-file.png',
          size: 1024,
          mimeType: 'image/png',
          format: 'png',
          fileType: 'image',
          status: 'ready',
          hash: 'hash-inpaint-result-file',
          path: '/files/inpaint-result-file',
          metadata: {
            width: 1024,
            height: 768,
          },
          source: {
            type: 'node-output',
            producerNodeId: '100',
            producerNodeDisplayId: '#00100',
            producerNodeType: 'aiImageInpaint',
            taskId: 'task-inpaint-main',
            taskNo: 'TASK-INPAINT-001',
            taskCreatedAt: 1,
            taskStartedAt: 2,
            taskCompletedAt: 3,
          },
          timestamp: {
            created: 1,
            updated: 1,
          },
        },
        resultCommitStatus: 'ready',
        resultCommittedAt: null,
        resultCommitError: null,
        canCommitOutput: true,
        isTerminal: true,
        isOutputCommitted: false,
      },
    ],
  };
}

function assertInpaintRequestShape(request: unknown): asserts request is {
  maskMode: string;
  groups: Array<{
    sourceFileId: string;
    maskFileId: string;
  }>;
} {
  assert.equal(typeof request, 'object');
  assert.ok(request !== null);
  assert.equal(Array.isArray((request as { groups?: unknown }).groups), true);
}

test('aiImageInpaint adapter blocks execution when no mask mark exists', () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const context = createContext({
    hasMaskMarks: false,
    groups: [createResolvedGroup([imageNode])],
  });

  const result = aiImageInpaintExecutionRuntimeAdapter.validateExecution(context);

  assert.equal(result.valid, false);
  assert.ok(result.valid === false && result.reason.includes('标记'));
});

test('aiImageInpaint adapter blocks execution when persisted strokes erase the final mask', () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const context = createContext({
    groups: [createResolvedGroup([imageNode])],
    maskStrokes: [
      {
        id: 'brush',
        tool: 'brush',
        brushSize: 4,
        points: [{ x: 1, y: 1 }],
      },
      {
        id: 'eraser',
        tool: 'eraser',
        brushSize: 4,
        points: [{ x: 1, y: 1 }],
      },
    ],
  });
  context.node.config.maskSourceWidth = 4;
  context.node.config.maskSourceHeight = 4;

  const result = aiImageInpaintExecutionRuntimeAdapter.validateExecution(context);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false ? result.code : null, 'INVALID_AI_IMAGE_INPAINT_MASK_STROKES');
});

test('aiImageInpaint adapter blocks execution when no source image exists', () => {
  const context = createContext({
    groups: [createResolvedGroup([])],
  });

  const result = aiImageInpaintExecutionRuntimeAdapter.validateExecution(context);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false ? result.code : null, 'INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID');
});

test('aiImageInpaint adapter blocks execution when prompt is empty', () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const context = createContext({
    prompt: '   ',
    groups: [createResolvedGroup([imageNode])],
  });

  const result = aiImageInpaintExecutionRuntimeAdapter.validateExecution(context);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false ? result.code : null, 'INVALID_AI_IMAGE_INPAINT_PROMPT');
});

test('aiImageInpaint adapter blocks execution when mask exporter is not ready', () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const context = createContext({
    groups: [createResolvedGroup([imageNode])],
  });

  const result = aiImageInpaintExecutionRuntimeAdapter.validateExecution(context);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false ? result.code : null, 'AI_IMAGE_INPAINT_MASK_EXPORT_FAILED');
});

test('aiImageInpaint adapter uploads source image and exported mask image', async () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const maskBlob = new Blob(['mask'], { type: 'image/png' });
  const exportedModes: string[] = [];
  const unregister = registerAIImageInpaintMaskExporter('100', async ({ mode }) => {
    exportedModes.push(mode);
    return maskBlob;
  });
  const ensuredFileIds: string[] = [];
  const registeredMasks: Array<{ nodeId: string; blob: Blob | File }> = [];
  const context = createContext({
    maskMode: 'strong-mask',
    groups: [createResolvedGroup([imageNode])],
    services: {
      ensureBackendFileId: async (node) => {
        ensuredFileIds.push(node.fileId);
        return 'backend-source-file';
      },
      registerInpaintMaskFile: async (nodeId, blob) => {
        registeredMasks.push({ nodeId, blob });
        return 'backend-mask-file';
      },
    },
  });

  try {
    const validation = aiImageInpaintExecutionRuntimeAdapter.validateExecution(context);
    assert.equal(validation.valid, true);

    const payload = await aiImageInpaintExecutionRuntimeAdapter.createExecutionPayload(context);

    assert.deepEqual(exportedModes, ['strong-mask']);
    assert.deepEqual(ensuredFileIds, ['source-file-1']);
    assert.equal(registeredMasks.length, 1);
    assert.equal(registeredMasks[0]?.nodeId, '100');
    assert.equal(registeredMasks[0]?.blob, maskBlob);
    assert.deepEqual(payload.request, {
      nodeType: 'aiImageInpaint',
      taskType: 'image-inpaint',
      executionMode: 'legacy-grouped-task',
      nodeId: '100',
      nodeTitle: '图片局部重绘',
      prompt: '把标记区域改成木质纹理',
      model: 'gemini-3-pro-image-preview',
      maskMode: 'strong-mask',
      imageSize: '2K',
      aspectRatio: '16:9',
      groups: [{
        groupId: AI_IMAGE_INPAINT_GROUP_ID,
        sourceFileId: 'backend-source-file',
        maskFileId: 'backend-mask-file',
      }],
    });
    assertInpaintRequestShape(payload.request);
    assert.equal(payload.request.groups.length, 1);
    assert.equal('sourceFileId' in payload.request.groups[0], true);
    assert.equal('maskFileId' in payload.request.groups[0], true);
    assert.equal('maskMode' in payload.request, true);
    assert.equal('maskFileId' in payload.request, false);
    assert.equal(payload.targets[0]?.outputHandle, 'main:result');
    assert.equal(payload.targets[0]?.kind, 'group');
    assert.equal(aiImageInpaintExecutionRuntimeAdapter.outputCommitMode, 'incremental');
  } finally {
    unregister();
  }
});

test('aiImageInpaint adapter commits editor mask snapshot before validation and payload creation', async () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const maskBlob = new Blob(['mask'], { type: 'image/png' });
  let commitCount = 0;
  const unregister = registerAIImageInpaintMaskExporter('100', {
    commitSnapshot: () => {
      commitCount += 1;
      return null;
    },
    exportMask: async () => maskBlob,
  });
  const context = createContext({
    groups: [createResolvedGroup([imageNode])],
    services: {
      ensureBackendFileId: async () => 'backend-source-file',
      registerInpaintMaskFile: async () => 'backend-mask-file',
    },
  });

  try {
    const validation = aiImageInpaintExecutionRuntimeAdapter.validateExecution(context);
    assert.equal(validation.valid, true);
    assert.equal(commitCount, 1);

    await aiImageInpaintExecutionRuntimeAdapter.createExecutionPayload(context);

    assert.equal(commitCount, 2);
  } finally {
    unregister();
  }
});

test('aiImageInpaint adapter validates against the snapshot returned from the live editor', async () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const liveStroke: AIImageInpaintMaskStroke = {
    id: 'live-stroke',
    tool: 'brush',
    brushSize: 4,
    points: [{ x: 1, y: 1 }],
  };
  const unregister = registerAIImageInpaintMaskExporter('100', {
    commitSnapshot: () => ({
      strokes: [liveStroke],
      sourceInfo: {
        fileId: 'source-file-1',
        width: 4,
        height: 4,
      },
      hasMarks: true,
      dirty: true,
    }),
    exportMask: async () => new Blob(['mask'], { type: 'image/png' }),
  });
  const context = createContext({
    hasMaskMarks: false,
    maskStrokes: [],
    groups: [createResolvedGroup([imageNode])],
    services: {
      ensureBackendFileId: async () => 'backend-source-file',
      registerInpaintMaskFile: async () => 'backend-mask-file',
    },
  });

  try {
    const validation = aiImageInpaintExecutionRuntimeAdapter.validateExecution(context);
    assert.equal(validation.valid, true);
    assert.deepEqual(context.node.config.maskStrokes, [liveStroke]);

    await aiImageInpaintExecutionRuntimeAdapter.createExecutionPayload(context);

    assert.deepEqual(context.node.config.maskStrokes, [liveStroke]);
    assert.equal(context.node.config.maskSourceFileId, 'source-file-1');
    assert.equal(context.node.config.maskSourceWidth, 4);
    assert.equal(context.node.config.maskSourceHeight, 4);
  } finally {
    unregister();
  }
});

test('aiImageInpaint adapter maps source registration failures to a file registration error code', async () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const unregister = registerAIImageInpaintMaskExporter('100', async () => (
    new Blob(['mask'], { type: 'image/png' })
  ));
  const context = createContext({
    groups: [createResolvedGroup([imageNode])],
    services: {
      ensureBackendFileId: async () => {
        throw new Error('source upload failed');
      },
      registerInpaintMaskFile: async () => 'backend-mask-file',
    },
  });

  try {
    await assert.rejects(
      () => Promise.resolve(aiImageInpaintExecutionRuntimeAdapter.createExecutionPayload(context)),
      (error: unknown) => (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'FILE_REGISTER_FAILED'
      ),
    );
  } finally {
    unregister();
  }
});

test('aiImageInpaint adapter maps mask export failures to a mask export error code', async () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const unregister = registerAIImageInpaintMaskExporter('100', async () => {
    throw new Error('mask canvas export failed');
  });
  const context = createContext({
    groups: [createResolvedGroup([imageNode])],
    services: {
      ensureBackendFileId: async () => 'backend-source-file',
      registerInpaintMaskFile: async () => 'backend-mask-file',
    },
  });

  try {
    await assert.rejects(
      () => Promise.resolve(aiImageInpaintExecutionRuntimeAdapter.createExecutionPayload(context)),
      (error: unknown) => (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'AI_IMAGE_INPAINT_MASK_EXPORT_FAILED'
      ),
    );
  } finally {
    unregister();
  }
});

test('aiImageInpaint adapter maps mask registration failures to a mask registration error code', async () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const unregister = registerAIImageInpaintMaskExporter('100', async () => (
    new Blob(['mask'], { type: 'image/png' })
  ));
  const context = createContext({
    groups: [createResolvedGroup([imageNode])],
    services: {
      ensureBackendFileId: async () => 'backend-source-file',
      registerInpaintMaskFile: async () => {
        throw new Error('mask upload failed');
      },
    },
  });

  try {
    await assert.rejects(
      () => Promise.resolve(aiImageInpaintExecutionRuntimeAdapter.createExecutionPayload(context)),
      (error: unknown) => (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'MASK_FILE_REGISTER_FAILED'
      ),
    );
  } finally {
    unregister();
  }
});

test('aiImageInpaint adapter rejects an empty registered mask file id', async () => {
  const imageNode = createImageNode(1, 'source-file-1', 'source.png');
  const unregister = registerAIImageInpaintMaskExporter('100', async () => (
    new Blob(['mask'], { type: 'image/png' })
  ));
  const context = createContext({
    groups: [createResolvedGroup([imageNode])],
    services: {
      ensureBackendFileId: async () => 'backend-source-file',
      registerInpaintMaskFile: async () => '  ',
    },
  });

  try {
    await assert.rejects(
      () => Promise.resolve(aiImageInpaintExecutionRuntimeAdapter.createExecutionPayload(context)),
      (error: unknown) => (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'INVALID_AI_IMAGE_INPAINT_MASK_FILE_ID'
      ),
    );
  } finally {
    unregister();
  }
});

test('aiImageInpaint adapter extracts completed output through grouped output adapter', () => {
  const snapshot = createRunSnapshot();
  const outputs = aiImageInpaintExecutionRuntimeAdapter.extractExecutionOutputs(snapshot, {
    workflowId: 'workflow-ai-image-inpaint',
    nodeId: '100',
    previousSnapshot: null,
    payload: {
      nodeId: '100',
      nodeType: 'aiImageInpaint',
      nodeTitle: 'Image Inpaint',
      taskType: 'image-inpaint',
      executionKind: 'grouped',
      request: {},
      targets: [
        {
          kind: 'group',
          nodeId: '100',
          nodeType: 'aiImageInpaint',
          groupId: AI_IMAGE_INPAINT_GROUP_ID,
          groupOrder: 0,
          groupLabel: 'Source',
          outputHandle: 'main:result',
        },
      ],
    },
  });

  assert.deepEqual(outputs, [
    {
      nodeId: '100',
      runId: 'run-ai-image-inpaint',
      taskId: 'task-inpaint-main',
      resultFileId: 'inpaint-result-file',
      groupId: AI_IMAGE_INPAINT_GROUP_ID,
      groupOrder: 0,
      sourceHandle: 'main:result',
      resultFile: snapshot.tasks[0]?.resultFileInfo,
    },
  ]);
});
