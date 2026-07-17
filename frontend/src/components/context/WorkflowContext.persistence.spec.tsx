import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, FileNodeData, Workflow } from '@/types';
import {
  __testOnly as workflowHookTestOnly,
  buildWorkflowWithRuntime,
  createEmptyWorkflow,
  normalizeWorkflowForUseWorkflow,
  type WorkflowRuntimeSnapshot,
} from '@/hooks/workflow/useWorkflow';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';

function createImageNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = 1_775_900_000_000;
  return {
    id: {
      value: 'node-image-1',
      display: '#00001',
    },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 265, height: 149 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId: 'file-image-1',
    fileName: 'demo.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 1600,
      height: 900,
    },
    ...overrides,
  };
}

function createRuntimeSnapshotWithImageNode(node: FileNodeData): WorkflowRuntimeSnapshot {
  return {
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    metadata: {
      relatedTasks: [],
      nodeCount: 1,
      connectionCount: 0,
    },
  };
}

function createSourceNode(): AINodeData {
  return {
    ...createDefaultAINodeData(createSequentialNodeId(100), { x: 120, y: 160 }, 'aiVideoGen'),
    outputs: [],
  } as AINodeData;
}

test('workflow runtime persistence strips image runtime urls and transient render state', () => {
  const workflow = createEmptyWorkflow('project-runtime-cleanup', 'Runtime Cleanup');
  const imageNode = createImageNode({
    thumbnailUrl: 'blob:thumbnail-runtime',
    previewUrl: 'runtime:image-preview',
    renderTier: 'minimal',
    activeState: 'active',
    activeReasons: ['selected', 'viewer'],
    imageResourceOwner: 'raster',
    imageAsset: {
      assetId: 'file-image-1',
      source: 'local',
      version: 1,
      variants: {
        thumbnail: {
          url: 'blob:thumbnail-runtime',
          width: 512,
          height: 288,
        },
        original: {
          url: 'blob:original-runtime',
          width: 1600,
          height: 900,
        },
      },
    },
  });

  const persisted = buildWorkflowWithRuntime(workflow, createRuntimeSnapshotWithImageNode(imageNode), 1_775_900_001_000);
  const persistedNode = persisted.nodes[imageNode.id.value] as FileNodeData;

  assert.equal(persistedNode.previewUrl, undefined);
  assert.equal(persistedNode.thumbnailUrl, undefined);
  assert.equal(persistedNode.renderTier, undefined);
  assert.equal(persistedNode.activeState, undefined);
  assert.equal(persistedNode.activeReasons, undefined);
  assert.equal(persistedNode.imageResourceOwner, undefined);
  assert.equal(persistedNode.imageAsset?.variants.thumbnail, undefined);
  assert.equal(persistedNode.imageAsset?.variants.original, undefined);
});

test('workflow runtime persistence preserves remote image thumbnail and original paths only', () => {
  const workflow = createEmptyWorkflow('project-remote-cleanup', 'Remote Cleanup');
  const imageNode = createImageNode({
    fileId: 'remote-image-1',
    backendFileId: 'remote-image-1',
    source: {
      type: 'node-output',
      producerNodeId: 'producer-1',
      producerNodeDisplayId: '#00100',
      producerNodeType: 'aiImageGen',
      taskId: 'task-1',
      taskNo: 'TASK-1',
      taskCreatedAt: 1_775_900_000_000,
    },
    thumbnailUrl: '/api/v1/files/remote-image-1/thumbnail',
    imageAsset: {
      assetId: 'remote-image-1',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/remote-image-1/thumbnail',
          width: 320,
          height: 180,
        },
        original: {
          url: '/api/v1/files/remote-image-1/download',
          width: 1600,
          height: 900,
        },
      },
    },
  });

  const persisted = buildWorkflowWithRuntime(workflow, createRuntimeSnapshotWithImageNode(imageNode), 1_775_900_002_000);
  const persistedNode = persisted.nodes[imageNode.id.value] as FileNodeData;

  assert.equal(persistedNode.previewUrl, undefined);
  assert.equal(persistedNode.thumbnailUrl, '/api/v1/files/remote-image-1/thumbnail');
  assert.equal(persistedNode.imageAsset?.variants.thumbnail?.url, '/api/v1/files/remote-image-1/thumbnail');
  assert.equal(persistedNode.imageAsset?.variants.original?.url, '/api/v1/files/remote-image-1/download');
  assert.deepEqual(Object.keys(persistedNode.imageAsset?.variants ?? {}).sort(), ['original', 'thumbnail']);
});

test('workflow runtime persistence keeps linked local source metadata without remote resource urls', () => {
  const workflow = createEmptyWorkflow('project-linked-local-cleanup', 'Linked Local Cleanup');
  const imageNode = createImageNode({
    source: {
      type: 'imported',
      importMethod: 'local',
      sourceDisplayName: 'linked-local.png',
      localSource: {
        status: 'linked',
        referenceId: 'fs-handle-1',
      },
      importedAt: 1_775_900_000_000,
    },
    thumbnailUrl: '/api/v1/files/file-image-1/thumbnail',
    imageAsset: {
      assetId: 'file-image-1',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-image-1/thumbnail',
          width: 320,
          height: 180,
        },
        original: {
          url: '/api/v1/files/file-image-1/download',
          width: 1600,
          height: 900,
        },
      },
    },
  });

  const persisted = buildWorkflowWithRuntime(workflow, createRuntimeSnapshotWithImageNode(imageNode), 1_775_900_002_500);
  const persistedNode = persisted.nodes[imageNode.id.value] as FileNodeData;

  assert.equal(persistedNode.source.localSource?.status, 'linked');
  assert.equal(persistedNode.source.localSource?.referenceId, 'fs-handle-1');
  assert.equal(persistedNode.previewUrl, undefined);
  assert.equal(persistedNode.thumbnailUrl, undefined);
  assert.equal(persistedNode.imageAsset?.variants.thumbnail, undefined);
  assert.equal(persistedNode.imageAsset?.variants.original, undefined);
});

test('workflow normalization strips persisted image runtime urls before canvas hydration', () => {
  const workflow: Workflow = {
    ...createEmptyWorkflow('project-normalize-cleanup', 'Normalize Cleanup'),
    nodes: {
      'node-image-1': createImageNode({
        thumbnailUrl: 'runtime:image-thumbnail',
        previewUrl: 'runtime:image-preview',
        imageAsset: {
          assetId: 'file-image-1',
          source: 'local',
          version: 1,
          variants: {
            thumbnail: {
              url: 'runtime:image-thumbnail',
            },
            original: {
              url: 'file:///tmp/original.png',
            },
          },
        },
      }),
    },
  };

  const normalized = normalizeWorkflowForUseWorkflow(workflow);
  const normalizedNode = normalized.nodes['node-image-1'] as FileNodeData;

  assert.equal(normalizedNode.previewUrl, undefined);
  assert.equal(normalizedNode.thumbnailUrl, undefined);
  assert.equal(normalizedNode.imageAsset?.variants.thumbnail, undefined);
  assert.equal(normalizedNode.imageAsset?.variants.original, undefined);
});

test('incremental runtime snapshots with stale base timestamps are rejected before they can overwrite the current workflow', () => {
  const workflow = createEmptyWorkflow('project-stale-runtime-base', 'Stale Runtime Base');
  const sourceNode = createSourceNode();
  const outputNode = createImageNode({
    id: {
      value: 'node-image-output',
      display: '#00101',
    },
  });
  const currentWorkflow: Workflow = {
    ...workflow,
    nodes: {
      [sourceNode.id.value]: sourceNode,
      [outputNode.id.value]: outputNode,
    },
    connections: [{
      id: 'connection-1',
      type: 'output-link',
      sourceId: sourceNode.id.value,
      targetId: outputNode.id.value,
      sourceHandle: 'group-1:result',
      order: 0,
    }],
    metadata: {
      ...workflow.metadata,
      nodeCount: 2,
      connectionCount: 1,
    },
    timestamp: {
      ...workflow.timestamp,
      updated: 1_775_900_100_000,
    },
  };

  const staleRuntime: WorkflowRuntimeSnapshot = {
    nodes: {
      [sourceNode.id.value]: sourceNode,
    },
    connections: [],
    viewport: currentWorkflow.viewport,
    metadata: {
      ...currentWorkflow.metadata,
      nodeCount: 1,
      connectionCount: 0,
    },
    snapshotMeta: {
      source: 'execution-reconcile',
      scope: 'output-reconcile',
      baseUpdatedAt: 1_775_900_000_000,
      baseNodeCount: 2,
      baseConnectionCount: 1,
      sourceNodeId: sourceNode.id.value,
      affectedNodeIds: [sourceNode.id.value],
      allowNodeShrink: false,
    },
  };

  assert.equal(workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, staleRuntime), false);
});

test('workflow persistence keeps video previewUrl separate from image preview removal', () => {
  const workflow = createEmptyWorkflow('project-video-preview', 'Video Preview');
  const videoNode = createDefaultFileNodeData(
    createSequentialNodeId(2),
    { x: 100, y: 120 },
    'video',
    'video-file-1',
    'clip.mp4',
    4096,
    'video/mp4',
    { width: 1280, height: 720, duration: 6 },
    {
      type: 'node-output',
      producerNodeId: 'producer-1',
      producerNodeDisplayId: '#00100',
      producerNodeType: 'aiVideoGen',
    },
  );
  videoNode.previewUrl = '/api/v1/files/video-file-1/preview';
  videoNode.thumbnailUrl = '/api/v1/files/video-file-1/thumbnail';

  const persisted = buildWorkflowWithRuntime(workflow, {
    nodes: {
      [videoNode.id.value]: videoNode,
    },
    connections: [],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    metadata: {
      relatedTasks: [],
      nodeCount: 1,
      connectionCount: 0,
    },
  }, 1_775_900_003_000);
  const persistedVideoNode = persisted.nodes[videoNode.id.value] as FileNodeData;

  assert.equal(persistedVideoNode.type, 'video');
  assert.equal(persistedVideoNode.previewUrl, '/api/v1/files/video-file-1/preview');
  assert.equal(persistedVideoNode.thumbnailUrl, '/api/v1/files/video-file-1/thumbnail');
});

test('workflow runtime persistence strips ephemeral runtime video preview urls instead of persisting blob object urls', () => {
  const workflow = createEmptyWorkflow('project-video-runtime-preview', 'Video Runtime Preview');
  const videoNode = createDefaultFileNodeData(
    createSequentialNodeId(3),
    { x: 100, y: 120 },
    'video',
    'video-file-runtime',
    'clip-runtime.mp4',
    4096,
    'video/mp4',
    { width: 1280, height: 720, duration: 6 },
    {
      type: 'node-output',
      producerNodeId: 'producer-2',
      producerNodeDisplayId: '#00101',
      producerNodeType: 'aiVideoGen',
    },
  );
  videoNode.previewUrl = 'blob:http://localhost/runtime-video-preview';
  videoNode.thumbnailUrl = 'blob:http://localhost/runtime-video-thumbnail';

  const persisted = buildWorkflowWithRuntime(workflow, {
    nodes: {
      [videoNode.id.value]: videoNode,
    },
    connections: [],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    metadata: {
      relatedTasks: [],
      nodeCount: 1,
      connectionCount: 0,
    },
  }, 1_775_900_003_500);
  const persistedVideoNode = persisted.nodes[videoNode.id.value] as FileNodeData;

  assert.equal(persistedVideoNode.previewUrl, undefined);
  assert.equal(persistedVideoNode.thumbnailUrl, undefined);
});

test('workflow runtime persistence applies image and video resource boundary matrix', () => {
  const workflow = createEmptyWorkflow('project-runtime-resource-matrix', 'Runtime Resource Matrix');
  const remoteImageNode = createImageNode({
    id: {
      value: 'node-remote-image',
      display: '#00010',
    },
    fileId: 'remote-image-matrix',
    backendFileId: 'remote-image-matrix',
    source: {
      type: 'node-output',
      producerNodeId: 'producer-remote',
      producerNodeDisplayId: '#00100',
      producerNodeType: 'aiImageGen',
      taskId: 'task-remote',
      taskNo: 'TASK-REMOTE',
      taskCreatedAt: 1_775_900_010_000,
    },
    previewUrl: '/api/v1/files/remote-image-matrix/preview',
    thumbnailUrl: '/api/v1/files/remote-image-matrix/thumbnail',
    imageAsset: {
      assetId: 'remote-image-matrix',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/remote-image-matrix/thumbnail',
          width: 320,
          height: 180,
        },
        original: {
          url: '/api/v1/files/remote-image-matrix/download',
          width: 1600,
          height: 900,
        },
      },
    },
  });
  const linkedLocalImageNode = createImageNode({
    id: {
      value: 'node-linked-local-image',
      display: '#00011',
    },
    source: {
      type: 'imported',
      importMethod: 'local',
      sourceDisplayName: 'linked-local.png',
      localSource: {
        status: 'linked',
        referenceId: 'fs-linked-image',
      },
      importedAt: 1_775_900_010_000,
    },
    thumbnailUrl: '/api/v1/files/linked-local-image/thumbnail',
    imageAsset: {
      assetId: 'linked-local-image',
      source: 'remote',
      version: 1,
      variants: {
        thumbnail: {
          url: '/api/v1/files/linked-local-image/thumbnail',
        },
        original: {
          url: '/api/v1/files/linked-local-image/download',
        },
      },
    },
  });
  const runtimeOnlyImageNode = createImageNode({
    id: {
      value: 'node-runtime-only-image',
      display: '#00012',
    },
    source: {
      type: 'imported',
      importMethod: 'local',
      sourceDisplayName: 'runtime-only.png',
      localSource: {
        status: 'runtime-only',
      },
      importedAt: 1_775_900_010_000,
    },
    previewUrl: 'runtime:image-preview',
    thumbnailUrl: 'blob:runtime-thumbnail',
    imageAsset: {
      assetId: 'runtime-only-image',
      source: 'local',
      version: 1,
      variants: {
        thumbnail: {
          url: 'blob:runtime-thumbnail',
        },
        original: {
          url: 'file:///tmp/runtime-original.png',
        },
      },
    },
  });
  const videoNode = createDefaultFileNodeData(
    createSequentialNodeId(13),
    { x: 300, y: 120 },
    'video',
    'video-matrix',
    'video-matrix.mp4',
    4096,
    'video/mp4',
    { width: 1280, height: 720, duration: 6 },
    {
      type: 'node-output',
      producerNodeId: 'producer-video',
      producerNodeDisplayId: '#00101',
      producerNodeType: 'aiVideoGen',
    },
  );
  videoNode.previewUrl = '/api/v1/files/video-matrix/preview';
  videoNode.thumbnailUrl = '/api/v1/files/video-matrix/thumbnail';

  const persisted = buildWorkflowWithRuntime(workflow, {
    nodes: {
      [remoteImageNode.id.value]: remoteImageNode,
      [linkedLocalImageNode.id.value]: linkedLocalImageNode,
      [runtimeOnlyImageNode.id.value]: runtimeOnlyImageNode,
      [videoNode.id.value]: videoNode,
    },
    connections: [],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    metadata: {
      relatedTasks: [],
      nodeCount: 4,
      connectionCount: 0,
    },
  }, 1_775_900_011_000);

  const persistedRemoteImage = persisted.nodes[remoteImageNode.id.value] as FileNodeData;
  const persistedLinkedLocalImage = persisted.nodes[linkedLocalImageNode.id.value] as FileNodeData;
  const persistedRuntimeOnlyImage = persisted.nodes[runtimeOnlyImageNode.id.value] as FileNodeData;
  const persistedVideo = persisted.nodes[videoNode.id.value] as FileNodeData;

  assert.equal(persistedRemoteImage.previewUrl, undefined);
  assert.equal(persistedRemoteImage.thumbnailUrl, '/api/v1/files/remote-image-matrix/thumbnail');
  assert.equal(persistedRemoteImage.imageAsset?.variants.thumbnail?.url, '/api/v1/files/remote-image-matrix/thumbnail');
  assert.equal(persistedRemoteImage.imageAsset?.variants.original?.url, '/api/v1/files/remote-image-matrix/download');
  assert.equal(persistedLinkedLocalImage.thumbnailUrl, undefined);
  assert.equal(persistedLinkedLocalImage.imageAsset?.variants.thumbnail, undefined);
  assert.equal(persistedLinkedLocalImage.imageAsset?.variants.original, undefined);
  assert.equal(persistedRuntimeOnlyImage.previewUrl, undefined);
  assert.equal(persistedRuntimeOnlyImage.thumbnailUrl, undefined);
  assert.equal(persistedRuntimeOnlyImage.imageAsset?.variants.thumbnail, undefined);
  assert.equal(persistedRuntimeOnlyImage.imageAsset?.variants.original, undefined);
  assert.equal(persistedVideo.previewUrl, '/api/v1/files/video-matrix/preview');
  assert.equal(persistedVideo.thumbnailUrl, '/api/v1/files/video-matrix/thumbnail');
});

test('workflow save baseline preserves external output graph while applying image resource boundaries', () => {
  const workflow = createEmptyWorkflow('project-external-output-save', 'External Output Save Guard');
  const sourceNode = createSourceNode();
  const resultNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 540, y: 160 },
    'video',
    'file-result-1',
    'video.mp4',
    2048,
    'video/mp4',
    { width: 1280, height: 720, duration: 8 },
    {
      type: 'node-output',
      producerNodeId: sourceNode.id.value,
      producerNodeDisplayId: sourceNode.id.display,
      producerNodeType: sourceNode.type,
    },
  );
  resultNode.previewUrl = '/files/file-result-1/download';

  const runtimeSnapshot: WorkflowRuntimeSnapshot = {
    nodes: {
      [sourceNode.id.value]: {
        ...sourceNode,
        outputs: ['file-result-1'],
      },
      [resultNode.id.value]: resultNode,
    },
    connections: [{
      id: 'output-link-1',
      type: 'output-link',
      sourceId: sourceNode.id.value,
      targetId: resultNode.id.value,
      sourceHandle: 'group-1:result',
      order: 0,
    }],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    metadata: {
      nodeCount: 2,
      connectionCount: 1,
      lastNodeId: 101,
    },
  };

  const persisted = buildWorkflowWithRuntime(workflow, runtimeSnapshot, 1_775_900_004_000);
  const savedSourceNode = persisted.nodes[sourceNode.id.value] as AINodeData;
  const savedResultNode = persisted.nodes[resultNode.id.value] as FileNodeData;

  assert.deepEqual(savedSourceNode.outputs, ['file-result-1']);
  assert.equal(savedResultNode.type, 'video');
  assert.equal(savedResultNode.previewUrl, '/files/file-result-1/download');
  assert.equal(persisted.connections.length, 1);
  assert.equal(persisted.connections[0]?.type, 'output-link');
  assert.equal(persisted.connections[0]?.sourceId, sourceNode.id.value);
  assert.equal(persisted.connections[0]?.targetId, resultNode.id.value);
  assert.equal(persisted.connections[0]?.sourceHandle, 'group-1:result');
  assert.equal(persisted.connections[0]?.order, 0);
  assert.equal(persisted.metadata.lastNodeId, 101);
});

test('workflow save baseline allows empty runtime snapshot to clear a previously populated workflow graph', () => {
  const workflow = createEmptyWorkflow('project-empty-runtime-overwrite', 'Empty Runtime Overwrite');
  const sourceNode = createSourceNode();
  const existingResultNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 540, y: 160 },
    'video',
    'file-existing-1',
    'existing.mp4',
    2048,
    'video/mp4',
    { width: 1280, height: 720, duration: 8 },
    {
      type: 'node-output',
      producerNodeId: sourceNode.id.value,
      producerNodeDisplayId: sourceNode.id.display,
      producerNodeType: sourceNode.type,
    },
  );
  const populatedWorkflow: Workflow = {
    ...workflow,
    nodes: {
      [sourceNode.id.value]: sourceNode,
      [existingResultNode.id.value]: existingResultNode,
    },
    connections: [{
      id: 'output-link-existing',
      type: 'output-link',
      sourceId: sourceNode.id.value,
      targetId: existingResultNode.id.value,
      sourceHandle: 'group-1:result',
      order: 0,
    }],
    metadata: {
      ...workflow.metadata,
      nodeCount: 2,
      connectionCount: 1,
      lastNodeId: 101,
      usedNodeIds: ['100', '101'],
    },
  };

  const overwritten = buildWorkflowWithRuntime(populatedWorkflow, {
    nodes: {},
    connections: [],
    viewport: {
      x: 48,
      y: 32,
      zoom: 0.75,
    },
    metadata: {
      nodeCount: 0,
      connectionCount: 0,
      lastNodeId: 101,
    },
  }, 1_775_900_005_000);

  assert.deepEqual(overwritten.nodes, {});
  assert.deepEqual(overwritten.connections, []);
  assert.equal(overwritten.metadata.nodeCount, 0);
  assert.equal(overwritten.metadata.connectionCount, 0);
  assert.deepEqual(overwritten.viewport, { x: 48, y: 32, zoom: 0.75 });
});

test('toolbar delegates save, switch-save and export preflight to unified context-level entrypoints after SVR-3', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const toolbarSource = readFileSync(
    `${cwd}/src/components/workflow/Toolbar.tsx`,
    'utf8',
  );
  const savePreflightSource = readFileSync(
    `${cwd}/src/components/context/workflow-save-preflight.ts`,
    'utf8',
  );
  const persistenceCoordinatorSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-persistence-coordinator.ts`,
    'utf8',
  );
  const fileActionsSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-file-actions.ts`,
    'utf8',
  );

  assert.equal(
    toolbarSource.includes('createWorkflowRuntimeSnapshot(getNodes(), getEdges(), getViewport())'),
    false,
  );
  assert.equal(
    toolbarSource.includes("await actions.saveRuntimeSnapshot(createRuntimeSnapshot(), { force: true, silent: false, reason: 'manual' });"),
    false,
  );
  assert.equal(
    toolbarSource.includes('runtimeSnapshot: createRuntimeSnapshot(),'),
    false,
  );
  assert.equal(
    toolbarSource.includes('await actions.exportLocalArchive(createRuntimeSnapshot());'),
    false,
  );
  assert.equal(
    toolbarSource.includes('await runToolbarSave(actions, {'),
    true,
  );
  assert.equal(
    toolbarSource.includes("await actions.saveRuntimeSnapshot(undefined, { force: true, silent: false, reason: 'manual' });"),
    false,
  );
  assert.equal(
    toolbarSource.includes('runWorkflowSavePreflight('),
    false,
  );
  assert.equal(
    toolbarSource.includes('return actions.confirmBeforeWorkflowSwitch({'),
    true,
  );
  assert.equal(
    toolbarSource.includes('runtimeSnapshot:'),
    false,
  );
  assert.equal(
    toolbarSource.includes('await actions.exportLocalArchive();'),
    true,
  );
  assert.equal(
    savePreflightSource.includes('export function runWorkflowSavePreflight('),
    true,
  );
  assert.equal(
    savePreflightSource.includes('flushMediaLayoutRuntimeSync({'),
    true,
  );
  assert.equal(
    savePreflightSource.includes('flushCanvasRuntimeSync({'),
    true,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('runWorkflowSavePreflight({'),
    true,
  );
  assert.equal(
    fileActionsSource.includes('runWorkflowSavePreflight({'),
    true,
  );
});

test('workflow provider derives runtime snapshots from a separate authoritative workflow supplier after SVR-4', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const workflowContextSource = readFileSync(
    `${cwd}/src/components/context/WorkflowContext.tsx`,
    'utf8',
  );
  const toolbarSource = readFileSync(
    `${cwd}/src/components/workflow/Toolbar.tsx`,
    'utf8',
  );

  assert.equal(
    workflowContextSource.includes('const getAuthoritativeWorkflow = useMemo('),
    true,
  );
  assert.equal(
    workflowContextSource.includes('() => createAuthoritativeWorkflowSupplier(workflowRef),'),
    true,
  );
  assert.equal(
    workflowContextSource.includes('getAuthoritativeWorkflow,'),
    true,
  );
  assert.equal(
    workflowContextSource.includes('saveRuntimeSnapshot: persistence.saveRuntimeSnapshot'),
    false,
  );
  assert.equal(
    toolbarSource.includes('const { zoomIn, zoomOut, fitView } = useReactFlow<AnyNodeData>();'),
    true,
  );
  assert.equal(
    toolbarSource.includes('getNodes('),
    false,
  );
  assert.equal(
    toolbarSource.includes('getEdges('),
    false,
  );
  assert.equal(
    toolbarSource.includes('getViewport('),
    false,
  );
});

test('SVR-2 removes hook-level pseudo persistence from useWorkflow and lifts save orchestration into the persistence coordinator', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const workflowContextSource = readFileSync(
    `${cwd}/src/components/context/WorkflowContext.tsx`,
    'utf8',
  );
  const useWorkflowSource = readFileSync(
    `${cwd}/src/hooks/workflow/useWorkflow.ts`,
    'utf8',
  );
  const persistenceCoordinatorSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-persistence-coordinator.ts`,
    'utf8',
  );

  assert.equal(
    workflowContextSource.includes('const workflow = useWorkflow();'),
    true,
  );
  assert.equal(
    workflowContextSource.includes('useWorkflow({'),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('onSave?: (workflow: Workflow) => Workflow | void | Promise<Workflow | void>;'),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('createWorkflowPersistence'),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('const save = useCallback('),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('const saveRuntimeSnapshot = useCallback('),
    false,
  );
  assert.equal(
    useWorkflowSource.includes('commitPersistedWorkflow: (workflow: Workflow) => Workflow | null;'),
    true,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('createWorkflowPersistence<Workflow, Workflow>'),
    true,
  );
});

test('SVR-5 routes toolbar manual saves into the unified authoritative save orchestrator path', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const toolbarSource = readFileSync(
    `${cwd}/src/components/workflow/Toolbar.tsx`,
    'utf8',
  );
  const persistenceCoordinatorSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-persistence-coordinator.ts`,
    'utf8',
  );

  assert.equal(
    toolbarSource.includes('await runToolbarSave(actions, {'),
    true,
  );
  assert.equal(
    toolbarSource.includes("await actions.saveRuntimeSnapshot(undefined, { force: true, silent: false, reason: 'manual' });"),
    false,
  );
  assert.equal(
    toolbarSource.includes("await actions.saveWorkflow({ force: true, silent: false, reason: 'manual' });"),
    false,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('createWorkflowSaveOrchestrator({'),
    true,
  );
  assert.equal(
    persistenceCoordinatorSource.includes('saveWorkflowFromRuntimeSnapshot'),
    false,
  );
});

test('SVR-9 routes toolbar save button and Ctrl+S/Cmd+S through the same manual save helper', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const toolbarSource = readFileSync(
    `${cwd}/src/components/workflow/Toolbar.tsx`,
    'utf8',
  );
  const toolbarSaveSource = readFileSync(
    `${cwd}/src/components/workflow/toolbar-save.ts`,
    'utf8',
  );
  const canvasSource = readFileSync(
    `${cwd}/src/components/canvas/Canvas.tsx`,
    'utf8',
  );

  assert.equal(
    toolbarSource.includes('await runToolbarSave(actions, {'),
    true,
  );
  assert.equal(
    toolbarSource.includes('if (!shouldTriggerToolbarSaveShortcut(event)) {'),
    true,
  );
  assert.equal(
    toolbarSource.includes("document.addEventListener('keydown', handleGlobalSaveShortcut);"),
    true,
  );
  assert.equal(
    toolbarSource.includes('event.preventDefault();'),
    true,
  );
  assert.equal(
    toolbarSaveSource.includes("await actions.saveWorkflow({ force: true, silent: false, reason: 'manual' });"),
    true,
  );
  assert.equal(
    toolbarSaveSource.includes("notification.showSuccess('保存成功', '当前画布已保存到后端。');"),
    true,
  );
  assert.equal(
    canvasSource.includes("if (event.key !== 'Delete' && event.key !== 'Backspace') {"),
    true,
  );
  const deleteSelectedElementsBlock = canvasSource.slice(
    canvasSource.indexOf('const deleteSelectedElements = useCallback((): void => {'),
    canvasSource.indexOf('  useEffect(() => {', canvasSource.indexOf('const deleteSelectedElements = useCallback((): void => {')),
  );
  assert.equal(
    deleteSelectedElementsBlock.includes("reason: 'canvas-node-remove',"),
    true,
  );
  assert.equal(
    deleteSelectedElementsBlock.includes('allowNodeShrink: true,'),
    true,
  );
});

test('local export baseline still rebuilds archive content from authoritative workflow state rather than toolbar-local ReactFlow snapshots', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const cwd = processLike.process?.cwd() ?? '.';
  const fileActionsSource = readFileSync(
    `${cwd}/src/components/context/coordinators/workflow-file-actions.ts`,
    'utf8',
  );
  const toolbarSource = readFileSync(
    `${cwd}/src/components/workflow/Toolbar.tsx`,
    'utf8',
  );

  assert.equal(
    fileActionsSource.includes('const activeWorkflow = getAuthoritativeWorkflow();'),
    true,
  );
  assert.equal(
    fileActionsSource.includes('const resolvedRuntimeSnapshot = resolveWorkflowRuntimeSnapshot('),
    false,
  );
  assert.equal(
    fileActionsSource.includes('const exportWorkflow = createAuthoritativeWorkflowExportProjection(activeWorkflow, savedAt);'),
    true,
  );
  assert.equal(
    fileActionsSource.includes('workflowRef.current = exportWorkflow;'),
    true,
  );
  assert.equal(
    fileActionsSource.includes('workflowRef.current = nextWorkflow;'),
    false,
  );
  assert.equal(
    fileActionsSource.includes('commitRuntimeSnapshot('),
    false,
  );
  assert.equal(
    toolbarSource.includes('createWorkflowRuntimeSnapshot(getNodes(), getEdges(), getViewport())'),
    false,
  );
});
