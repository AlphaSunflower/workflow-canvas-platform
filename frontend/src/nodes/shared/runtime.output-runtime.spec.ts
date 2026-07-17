import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, FileInfo, Workflow } from '@/types';
import {
  createDefaultAINodeData,
  createSequentialNodeId,
} from '@/utils/node/create';
import { clearExecutionOutputRuntimeResources } from '@/services/execution-output-runtime-sync';
import { imageThumbnailRuntimeStore } from '@/services/image/image-thumbnail-runtime-store';
import {
  appendResolvedTaskOutputs,
  createRuntimeOutputSnapshot,
  type RuntimeOutputAppenderContext,
} from './runtime';

function createWorkflow(): Workflow {
  const sourceNode = {
    ...createDefaultAINodeData(createSequentialNodeId(100), { x: 120, y: 160 }, 'aiImageGen'),
    outputs: [],
  } as AINodeData;

  return {
    id: 'workflow-runtime-output',
    projectId: 'project-runtime-output',
    name: 'runtime output',
    nodes: {
      [sourceNode.id.value]: sourceNode,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 100,
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: ['100'],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createFileInfo(fileId: string): FileInfo {
  return {
    id: fileId,
    name: `${fileId}.png`,
    originalName: `${fileId}.png`,
    size: 4096,
    mimeType: 'image/png',
    format: 'png',
    fileType: 'image',
    status: 'ready',
    hash: `hash-${fileId}`,
    path: `/api/v1/files/${fileId}/download`,
    thumbnailPath: `/api/v1/files/${fileId}/thumbnail`,
    metadata: {
      width: 1280,
      height: 720,
    },
    source: {
      type: 'node-output',
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createVideoOutput(
  fileId: string,
  taskId: string,
  sourceHandle: string,
  order = 0,
) {
  return {
    order,
    taskId,
    resultFileId: fileId,
    sourceHandle,
    fileInfo: {
      ...createFileInfo(fileId),
      name: `${fileId}.mp4`,
      originalName: `${fileId}.mp4`,
      mimeType: 'video/mp4',
      format: 'mp4' as const,
      fileType: 'video' as const,
      path: `/api/v1/files/${fileId}/download`,
      metadata: {
        width: 1920,
        height: 1080,
        duration: 8,
      },
    },
  };
}

function createAppenderContext(workflow: Workflow): RuntimeOutputAppenderContext {
  return {
    workflow,
    sourceNode: workflow.nodes['100'] as AINodeData,
    resolveFileUrl: (fileId, type = 'download') => `/api/v1/files/${fileId}/${type}`,
  };
}

function resetState(): void {
  clearExecutionOutputRuntimeResources();
  imageThumbnailRuntimeStore.clearAll();
}

test('appendResolvedTaskOutputs prefers synchronized local runtime resource for image preview', () => {
  resetState();
  const workflow = createWorkflow();
  const writeResult = appendResolvedTaskOutputs(
    createAppenderContext(workflow),
    [{
      order: 0,
      taskId: 'task-local-preview',
      resultFileId: 'file-local-preview',
      fileInfo: createFileInfo('file-local-preview'),
      runtimeResource: {
        fileId: 'file-local-preview',
        backendFileId: 'file-local-preview',
        file: new File([new Uint8Array([1, 2, 3])], 'file-local-preview.png', { type: 'image/png' }),
        fileType: 'image',
        mimeType: 'image/png',
        objectUrl: 'blob:runtime-local-preview',
        fileInfo: createFileInfo('file-local-preview'),
        syncedAt: 123,
      },
    }],
  );

  assert.ok(writeResult);
  const outputNode = Object.values(writeResult?.nodes ?? {}).find((node) => (
    node.id.value !== '100' && 'fileId' in node
  ));

  assert.ok(outputNode);
  if (!outputNode || !('imageAsset' in outputNode)) {
    throw new Error('Expected an image output node.');
  }

  assert.equal(outputNode.source.type, 'node-output');
  assert.equal(outputNode.source.producerNodeId, '100');
  assert.equal(outputNode.source.producerNodeDisplayId, '#00100');
  assert.equal(outputNode.source.producerNodeType, 'aiImageGen');
  assert.equal(outputNode.source.taskId, 'task-local-preview');
  assert.equal(outputNode.source.taskNo, 'TASK-file-local-preview');
  assert.equal(typeof outputNode.source.taskCreatedAt, 'number');
  assert.equal(outputNode.imageAsset?.source, 'local');
  assert.equal(outputNode.imageAsset?.variants.thumbnail?.url, 'blob:runtime-local-preview');
  assert.equal(outputNode.imageAsset?.variants.original?.url, '/api/v1/files/file-local-preview/download');
  assert.equal(outputNode.thumbnailUrl, 'blob:runtime-local-preview');
  assert.equal(outputNode.previewUrl, undefined);
});

test('appendResolvedTaskOutputs falls back to remote urls when local runtime resource is unavailable', () => {
  resetState();
  const workflow = createWorkflow();
  const writeResult = appendResolvedTaskOutputs(
    createAppenderContext(workflow),
    [{
      order: 0,
      taskId: 'task-remote-preview',
      resultFileId: 'file-remote-preview',
      fileInfo: createFileInfo('file-remote-preview'),
    }],
  );

  assert.ok(writeResult);
  const outputNode = Object.values(writeResult?.nodes ?? {}).find((node) => (
    node.id.value !== '100' && 'fileId' in node
  ));

  assert.ok(outputNode);
  if (!outputNode || !('imageAsset' in outputNode)) {
    throw new Error('Expected an image output node.');
  }

  assert.equal(outputNode.source.type, 'node-output');
  assert.equal(outputNode.source.producerNodeId, '100');
  assert.equal(outputNode.source.producerNodeDisplayId, '#00100');
  assert.equal(outputNode.source.producerNodeType, 'aiImageGen');
  assert.equal(outputNode.source.taskId, 'task-remote-preview');
  assert.equal(outputNode.source.taskNo, 'TASK-file-remote-preview');
  assert.equal(typeof outputNode.source.taskCreatedAt, 'number');
  assert.equal(outputNode.imageAsset?.source, 'remote');
  assert.equal(outputNode.imageAsset?.variants.thumbnail?.url, '/api/v1/files/file-remote-preview/thumbnail');
  assert.equal(outputNode.imageAsset?.variants.original?.url, '/api/v1/files/file-remote-preview/download');
  assert.equal(outputNode.thumbnailUrl, '/api/v1/files/file-remote-preview/thumbnail');
});

test('appendResolvedTaskOutputs uses the latest workflow source node instead of a stale source node snapshot', () => {
  resetState();
  const workflow = createWorkflow();
  const staleSourceNode = workflow.nodes['100'] as AINodeData;
  const latestWorkflow: Workflow = {
    ...workflow,
    nodes: {
      ...workflow.nodes,
      '100': {
        ...staleSourceNode,
        outputs: ['existing-output'],
        timestamp: {
          ...staleSourceNode.timestamp,
          updated: 99,
        },
      },
    },
    timestamp: {
      ...workflow.timestamp,
      updated: 99,
    },
  };

  const writeResult = appendResolvedTaskOutputs({
    workflow: latestWorkflow,
    sourceNode: staleSourceNode,
    resolveFileUrl: (fileId, type = 'download') => `/api/v1/files/${fileId}/${type}`,
  }, [{
    order: 0,
    taskId: 'task-latest-source-node',
    resultFileId: 'new-output',
    fileInfo: createFileInfo('new-output'),
  }]);

  assert.ok(writeResult);
  const nextSourceNode = writeResult?.nodes['100'] as AINodeData | undefined;
  assert.ok(nextSourceNode);
  assert.deepEqual(nextSourceNode?.outputs, ['existing-output', 'new-output']);
});

test('appendResolvedTaskOutputs appends a new node when the same source handle produces a different file', () => {
  resetState();
  const workflow = createWorkflow();
  const firstWriteResult = appendResolvedTaskOutputs(
    createAppenderContext(workflow),
    [createVideoOutput('video-first', 'task-video-first', 'group-1:result')],
  );

  assert.ok(firstWriteResult);
  const firstWorkflow = createRuntimeOutputSnapshot(workflow, firstWriteResult!);
  const firstOutputNode = Object.values(firstWorkflow.nodes).find((node) => (
    node.id.value !== '100' && 'fileId' in node && node.fileId === 'video-first'
  ));
  assert.ok(firstOutputNode);
  if (!firstOutputNode || !('fileId' in firstOutputNode)) {
    throw new Error('Expected first output node.');
  }

  const secondWriteResult = appendResolvedTaskOutputs(
    createAppenderContext(firstWorkflow as Workflow),
    [createVideoOutput('video-second', 'task-video-second', 'group-1:result')],
  );

  assert.ok(secondWriteResult);
  const secondWorkflow = createRuntimeOutputSnapshot(firstWorkflow as Workflow, secondWriteResult!);
  const sourceNode = secondWorkflow.nodes['100'] as AINodeData;
  const outputNodes = Object.values(secondWorkflow.nodes).filter((node) => (
    node.id.value !== '100' && 'fileId' in node && (node.fileId === 'video-first' || node.fileId === 'video-second')
  ));
  const outputLinks = secondWorkflow.connections.filter((connection) => (
    connection.type === 'output-link'
    && connection.sourceId === '100'
    && connection.sourceHandle === 'group-1:result'
  ));

  assert.equal(outputNodes.length, 2);
  assert.equal(new Set(outputNodes.map((node) => node.id.value)).size, 2);
  assert.deepEqual(sourceNode.outputs, ['video-first', 'video-second']);
  assert.equal(outputLinks.length, 2);
  assert.deepEqual(
    outputLinks.map((connection) => connection.targetId).sort(),
    outputNodes.map((node) => node.id.value).sort(),
  );
  assert.deepEqual(
    outputNodes
      .map((node) => ('fileId' in node ? [node.fileId, node.position] : null))
      .filter(Boolean),
    [
      ['video-first', { x: 940, y: 160 }],
      ['video-second', { x: 1620, y: 160 }],
    ],
  );
});

test('appendResolvedTaskOutputs can append multiple nodes from the same source handle', () => {
  resetState();
  const workflow = createWorkflow();
  const firstWriteResult = appendResolvedTaskOutputs(
    createAppenderContext(workflow),
    [createVideoOutput('video-first', 'task-video-first', 'group-1:result')],
    {
      x: 940,
      y: 160,
      startIndex: 0,
      replaceExistingHandleSlot: false,
    },
  );

  assert.ok(firstWriteResult);
  const firstWorkflow = createRuntimeOutputSnapshot(workflow, firstWriteResult!);
  const secondWriteResult = appendResolvedTaskOutputs(
    createAppenderContext(firstWorkflow as Workflow),
    [createVideoOutput('video-second', 'task-video-second', 'group-1:result')],
    {
      x: 940,
      y: 160,
      startIndex: firstWorkflow.connections.filter((connection) => (
        connection.type === 'output-link' && connection.sourceId === '100'
      )).length,
      replaceExistingHandleSlot: false,
    },
  );

  assert.ok(secondWriteResult);
  const secondWorkflow = createRuntimeOutputSnapshot(firstWorkflow as Workflow, secondWriteResult!);
  const sourceNode = secondWorkflow.nodes['100'] as AINodeData;
  const outputNodes = Object.values(secondWorkflow.nodes).filter((node) => (
    node.id.value !== '100' && 'fileId' in node && (node.fileId === 'video-first' || node.fileId === 'video-second')
  ));
  const outputLinks = secondWorkflow.connections.filter((connection) => (
    connection.type === 'output-link'
    && connection.sourceId === '100'
    && connection.sourceHandle === 'group-1:result'
  ));

  assert.deepEqual(sourceNode.outputs, ['video-first', 'video-second']);
  assert.equal(outputNodes.length, 2);
  assert.equal(new Set(outputNodes.map((node) => node.id.value)).size, 2);
  assert.equal(outputLinks.length, 2);
  assert.deepEqual(
    outputNodes
      .map((node) => ('fileId' in node ? [node.fileId, node.position] : null))
      .filter(Boolean),
    [
      ['video-first', { x: 940, y: 160 }],
      ['video-second', { x: 1620, y: 160 }],
    ],
  );
});

test('appendResolvedTaskOutputs append layout stays gap-free when only a later handle produces a new file', () => {
  resetState();
  const workflow = createWorkflow();
  const firstWriteResult = appendResolvedTaskOutputs(
    createAppenderContext(workflow),
    [
      createVideoOutput('video-group-1', 'task-video-group-1', 'group-1:result', 0),
      createVideoOutput('video-group-2', 'task-video-group-2', 'group-2:result', 1),
    ],
  );

  assert.ok(firstWriteResult);
  const firstWorkflow = createRuntimeOutputSnapshot(workflow, firstWriteResult!);
  const secondWriteResult = appendResolvedTaskOutputs(
    createAppenderContext(firstWorkflow as Workflow),
    [createVideoOutput('video-group-2-next', 'task-video-group-2-next', 'group-2:result', 1)],
  );

  assert.ok(secondWriteResult);
  const secondWorkflow = createRuntimeOutputSnapshot(firstWorkflow as Workflow, secondWriteResult!);
  const outputNodes = Object.values(secondWorkflow.nodes).filter((node) => (
    node.id.value !== '100'
    && 'fileId' in node
    && (
      node.fileId === 'video-group-1'
      || node.fileId === 'video-group-2'
      || node.fileId === 'video-group-2-next'
    )
  ));

  assert.deepEqual(
    outputNodes
      .map((node) => ('fileId' in node ? [node.fileId, node.position] : null))
      .filter(Boolean),
    [
      ['video-group-1', { x: 940, y: 160 }],
      ['video-group-2', { x: 940, y: 621 }],
      ['video-group-2-next', { x: 1620, y: 621 }],
    ],
  );
});

test('appendResolvedTaskOutputs reuses the same file node without consuming append placement', () => {
  resetState();
  const workflow = createWorkflow();
  const firstWriteResult = appendResolvedTaskOutputs(
    createAppenderContext(workflow),
    [createVideoOutput('video-first', 'task-video-first', 'group-1:result')],
  );

  assert.ok(firstWriteResult);
  const firstWorkflow = createRuntimeOutputSnapshot(workflow, firstWriteResult!);
  const secondWriteResult = appendResolvedTaskOutputs(
    createAppenderContext(firstWorkflow as Workflow),
    [
      createVideoOutput('video-first', 'task-video-first-replay', 'group-1:result', 0),
      createVideoOutput('video-second', 'task-video-second', 'group-1:result', 1),
    ],
  );

  assert.ok(secondWriteResult);
  const secondWorkflow = createRuntimeOutputSnapshot(firstWorkflow as Workflow, secondWriteResult!);
  const outputNodes = Object.values(secondWorkflow.nodes).filter((node) => (
    node.id.value !== '100' && 'fileId' in node && (node.fileId === 'video-first' || node.fileId === 'video-second')
  ));

  assert.equal(outputNodes.length, 2);
  assert.deepEqual(
    outputNodes
      .map((node) => ('fileId' in node ? [node.fileId, node.position] : null))
      .filter(Boolean),
    [
      ['video-first', { x: 940, y: 160 }],
      ['video-second', { x: 1620, y: 160 }],
    ],
  );
});
