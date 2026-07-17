import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutionTaskNodeRef,
  collectExecutionInputFiles,
  toNodeTaskRef,
} from '../dist-tests/src/utils/workflow/task-batch.js';
import {
  createNodeOutputFileSource,
  normalizeTaskResultFileInfo,
  normalizeTaskResultFileInfos,
} from '../dist-tests/src/nodes/shared/task-result-normalizer.js';

function createAiNode(overrides = {}) {
  return {
    id: { value: '2', display: '#00002' },
    type: 'aiImageGen',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 260 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: { created: 1, updated: 1 },
    references: [],
    outputs: [],
    tasks: [],
    annotation: 'Image Gen',
    config: {
      model: 'sdxl',
      inputGroups: [
        { id: 'group-1', label: 'Group 1', order: 0 },
        { id: 'group-2', label: 'Group 2', order: 1 },
      ],
    },
    ...overrides,
  };
}

function createFileNode(id, fileId, overrides = {}) {
  return {
    id: { value: String(id), display: `#${String(id).padStart(5, '0')}` },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 120 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'ready',
    zIndex: 1,
    timestamp: { created: 1, updated: 1 },
    fileId,
    fileName: `${fileId}.png`,
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: 1,
    },
    metadata: {
      width: 1024,
      height: 768,
    },
    ...overrides,
  };
}

function createTaskRecord(overrides = {}) {
  return {
    taskId: 'task-1',
    taskNo: 'TASK-20260403-000001',
    batchId: 'batch-1',
    runId: 'run-1',
    runNo: 'RUN-20260403-000001',
    node: {
      nodeId: '2',
      nodeDisplayId: '#00002',
      nodeType: 'aiImageGen',
      nodeTitle: 'Image Gen',
    },
    scope: 'node',
    status: 'completed',
    createdAt: 10,
    startedAt: 20,
    completedAt: 30,
    ...overrides,
  };
}

test('buildExecutionTaskNodeRef extracts stable task node identity', () => {
  const nodeRef = buildExecutionTaskNodeRef(createAiNode());

  assert.deepEqual(nodeRef, {
    nodeId: '2',
    nodeDisplayId: '#00002',
    nodeType: 'aiImageGen',
    nodeTitle: 'Image Gen',
  });
});

test('buildExecutionTaskNodeRef accepts aiImageInpaint node identity', () => {
  const nodeRef = buildExecutionTaskNodeRef(createAiNode({
    type: 'aiImageInpaint',
    annotation: 'Image Inpaint',
    config: {
      prompt: 'replace marked area',
      model: 'gemini-3-pro-image-preview',
      imageSize: '1K',
      aspectRatio: 'auto',
      maskMode: 'original-markup',
      hasMaskMarks: true,
      inputGroups: [
        { id: 'main', label: 'main', order: 0 },
      ],
    },
  }));

  assert.deepEqual(nodeRef, {
    nodeId: '2',
    nodeDisplayId: '#00002',
    nodeType: 'aiImageInpaint',
    nodeTitle: 'Image Inpaint',
  });
});

test('buildExecutionTaskNodeRef accepts aiImageInpaint node with persisted mask strokes', () => {
  const nodeRef = buildExecutionTaskNodeRef(createAiNode({
    type: 'aiImageInpaint',
    annotation: '',
    config: {
      prompt: 'replace marked area',
      model: 'gemini-3-pro-image-preview',
      imageSize: '1K',
      aspectRatio: 'auto',
      maskMode: 'strong-mask',
      hasMaskMarks: true,
      editorHeight: 420,
      maskSourceFileId: 'source-file-1',
      maskSourceWidth: 1536,
      maskSourceHeight: 1024,
      maskStrokes: [
        {
          id: 'stroke-1',
          tool: 'brush',
          brushSize: 36,
          points: [{ x: 20, y: 30 }],
        },
      ],
      inputGroups: [
        { id: 'main', label: 'main', order: 0 },
      ],
    },
  }));

  assert.deepEqual(nodeRef, {
    nodeId: '2',
    nodeDisplayId: '#00002',
    nodeType: 'aiImageInpaint',
    nodeTitle: undefined,
  });
});

test('collectExecutionInputFiles summarizes file-node inputs only', () => {
  const inputFiles = collectExecutionInputFiles([
    createFileNode(1, 'file-1'),
    createFileNode(2, 'file-2'),
  ]);

  assert.deepEqual(inputFiles, [
    {
      fileId: 'file-1',
      fileName: 'file-1.png',
      mimeType: 'image/png',
    },
    {
      fileId: 'file-2',
      fileName: 'file-2.png',
      mimeType: 'image/png',
    },
  ]);
});

test('toNodeTaskRef preserves task identifiers and timing fields', () => {
  const taskRef = toNodeTaskRef(createTaskRecord({
    startedAt: 200,
    completedAt: 300,
  }));

  assert.deepEqual(taskRef, {
    taskId: 'task-1',
    taskNo: 'TASK-20260403-000001',
    batchId: 'batch-1',
    runId: 'run-1',
    runNo: 'RUN-20260403-000001',
    scope: 'node',
    groupId: undefined,
    groupLabel: undefined,
    groupOrder: undefined,
    status: 'completed',
    createdAt: 10,
    startedAt: 200,
    completedAt: 300,
  });
});

test('toNodeTaskRef preserves aiImageInpaint grouped output routing metadata', () => {
  const taskRef = toNodeTaskRef(createTaskRecord({
    taskType: 'image-inpaint',
    scope: 'group',
    groupId: 'main',
    groupLabel: 'main',
    groupOrder: 0,
    outputHandle: 'main:result',
    node: {
      nodeId: '2',
      nodeDisplayId: '#00002',
      nodeType: 'aiImageInpaint',
      nodeTitle: 'Image Inpaint',
    },
  }));

  assert.deepEqual(taskRef, {
    taskId: 'task-1',
    taskNo: 'TASK-20260403-000001',
    batchId: 'batch-1',
    runId: 'run-1',
    runNo: 'RUN-20260403-000001',
    scope: 'group',
    groupId: 'main',
    groupLabel: 'main',
    groupOrder: 0,
    taskType: 'image-inpaint',
    outputHandle: 'main:result',
    status: 'completed',
    createdAt: 10,
    startedAt: 20,
    completedAt: 30,
  });
});

test('node output file source writes producer and task metadata', () => {
  const source = createNodeOutputFileSource(createTaskRecord());

  assert.deepEqual(source, {
    type: 'node-output',
    producerNodeId: '2',
    producerNodeDisplayId: '#00002',
    producerNodeType: 'aiImageGen',
    taskId: 'task-1',
    taskNo: 'TASK-20260403-000001',
    taskCreatedAt: 10,
    taskStartedAt: 20,
    taskCompletedAt: 30,
  });
});

test('node output file source preserves aiImageInpaint producer metadata for new image nodes', () => {
  const source = createNodeOutputFileSource(createTaskRecord({
    node: {
      nodeId: '2',
      nodeDisplayId: '#00002',
      nodeType: 'aiImageInpaint',
      nodeTitle: 'Image Inpaint',
    },
  }));

  assert.deepEqual(source, {
    type: 'node-output',
    producerNodeId: '2',
    producerNodeDisplayId: '#00002',
    producerNodeType: 'aiImageInpaint',
    taskId: 'task-1',
    taskNo: 'TASK-20260403-000001',
    taskCreatedAt: 10,
    taskStartedAt: 20,
    taskCompletedAt: 30,
  });
});

test('node output file source keeps existing image node producer metadata stable', () => {
  for (const nodeType of ['aiImageGen', 'aiImageHd', 'aiFloorplanColorize']) {
    const source = createNodeOutputFileSource(createTaskRecord({
      node: {
        nodeId: '2',
        nodeDisplayId: '#00002',
        nodeType,
        nodeTitle: nodeType,
      },
    }));

    assert.equal(source.type, 'node-output');
    assert.equal(source.producerNodeType, nodeType);
    assert.equal(source.producerNodeId, '2');
    assert.equal(source.taskId, 'task-1');
  }
});

test('normalizeTaskResultFileInfo and normalizeTaskResultFileInfos stamp all output files with unified source metadata', () => {
  const fileInfo = {
    id: 'file-1',
    name: 'result.png',
    originalName: 'result.png',
    size: 1024,
    mimeType: 'image/png',
    format: 'png',
    fileType: 'image',
    status: 'ready',
    hash: 'hash',
    path: '/files/result.png',
    metadata: {
      width: 1024,
      height: 768,
    },
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: 1,
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };

  const taskRecord = createTaskRecord();
  const single = normalizeTaskResultFileInfo(fileInfo, taskRecord);
  const list = normalizeTaskResultFileInfos([fileInfo, fileInfo], taskRecord);

  assert.equal(single.source.type, 'node-output');
  assert.equal(single.source.taskNo, 'TASK-20260403-000001');
  assert.equal(list.length, 2);
  assert.equal(list[0].source.producerNodeDisplayId, '#00002');
  assert.equal(list[1].source.taskId, 'task-1');
});
