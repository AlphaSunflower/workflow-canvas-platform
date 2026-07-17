import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, FileNodeData, StoryboardShotData } from '@/types';
import { hydrateWorkflowFromApiDetail, normalizeWorkflowForPersistence } from './workflow-file-normalizer';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils';

function createFileNode(overrides: Partial<FileNodeData> = {}): FileNodeData {
  const now = Date.now();
  return {
    id: {
      value: 'node-1',
      display: '#00001',
    },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 180 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    fileId: 'file-backend-1',
    fileName: 'example.png',
    fileSize: 2048,
    mimeType: 'image/png',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 512,
      height: 512,
    },
    ...overrides,
  };
}

function createSourceNode(overrides: Partial<AINodeData> = {}): AINodeData {
  return {
    ...createDefaultAINodeData(createSequentialNodeId(100), { x: 120, y: 160 }, 'aiImageGen'),
    outputs: [],
    ...overrides,
  } as AINodeData;
}

function createSourceTaskRef(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-result-1',
    taskNo: 'TASK-result-1',
    batchId: 'batch-result-1',
    runId: 'run-result-1',
    runNo: 'RUN-result-1',
    node: {
      nodeId: '100',
      nodeDisplayId: '#00100',
      nodeType: 'aiImageGen',
    },
    scope: 'node' as const,
    status: 'completed' as const,
    createdAt: 111,
    ...overrides,
  };
}

function createStoryboardShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
  return {
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
    sourceNodeId: 'node-1',
    sourceFileId: 'source-file-1',
    sourceImageFileId: 'source-image-1',
    imageFileId: 'image-result-1',
    videoFileId: 'video-result-1',
    prompt: 'camera move',
    imageModel: 'gemini-3-pro-image-preview',
    imageAspectRatio: 'auto',
    imageSize: '1K',
    videoModel: 'veo-3.1-landscape-fast-fl',
    videoDuration: 8,
    videoAspectRatio: '16:9',
    videoResolution: '720P',
    imageGenStatus: 'generating',
    imageGenMessage: 'creating image',
    imageGenRunId: 'run-image-1',
    videoGenStatus: 'failed',
    videoProgress: 45,
    videoError: 'video failed',
    videoRunId: 'run-video-1',
    ...overrides,
  };
}

function createStoryboardNode(overrides: Partial<AINodeData> = {}): AINodeData {
  const node = createSourceNode({
    type: 'aiStoryboard',
    config: {
      shots: [createStoryboardShot()],
      viewMode: 'list',
      defaultImageModel: 'gemini-3-pro-image-preview',
      defaultImageAspectRatio: 'auto',
      defaultImageSize: '1K',
      batchVideoModel: 'veo-3.1-landscape-fast-fl',
      batchVideoDuration: 8,
      batchVideoAspectRatio: '16:9',
      batchVideoResolution: '720P',
      processedInputFileIds: ['source-file-1'],
    },
  });

  return {
    ...node,
    ...overrides,
  } as AINodeData;
}

test('hydrateWorkflowFromApiDetail rebuilds thumbnail and original only for image file nodes', () => {
  const workflow = hydrateWorkflowFromApiDetail({
    workflowId: 'workflow-1',
    ownerUserId: 'user-1',
    groupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    createdAt: new Date(1710000000000).toISOString(),
    updatedAt: new Date(1710000001234).toISOString(),
    workflow: {
      projectId: 'project-1',
      name: 'Canvas 1',
      nodes: {
        'node-1': createFileNode({
          previewUrl: '/api/v1/files/file-backend-1/preview',
          imageAsset: {
            assetId: 'file-backend-1',
            source: 'remote',
            version: 1,
            variants: {
              original: {
                url: '/api/v1/files/file-backend-1/download',
                width: 512,
                height: 512,
              },
            },
          },
        }),
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 1,
        canvasSize: { width: 1000, height: 1000 },
        relatedTasks: [],
      },
      timestamp: 1710000001234,
      version: 2,
    },
  });

  const fileNode = workflow.nodes['node-1'] as FileNodeData;
  assert.equal(fileNode.previewUrl, undefined);
  assert.equal(fileNode.thumbnailUrl, '/api/v1/files/file-backend-1/thumbnail');
  assert.deepEqual(Object.keys(fileNode.imageAsset?.variants ?? {}).sort(), ['original', 'thumbnail']);
  assert.equal(fileNode.imageAsset?.variants.original?.url, '/api/v1/files/file-backend-1/download');
});

test('normalizeWorkflowForPersistence strips runtime image urls from payload and rebuilds remote image asset in memory', async () => {
  const workflow = {
    id: 'workflow-persist-1',
    projectId: 'project-persist-1',
    name: 'Persisted Workflow',
    nodes: {
      'node-1': createFileNode({
        fileId: 'backend-file-persisted',
        backendFileId: 'backend-file-persisted',
        previewUrl: 'runtime:image-preview',
        thumbnailUrl: 'blob:thumbnail-local',
        imageAsset: {
          assetId: 'backend-file-persisted',
          source: 'local',
          version: 1,
          variants: {
            thumbnail: { url: 'runtime:image-thumbnail' },
            original: { url: 'blob:original' },
          },
        },
      }),
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: { width: 1000, height: 1000 },
      relatedTasks: [],
    },
    timestamp: {
      created: 1710000000000,
      updated: 1710000000000,
    },
    version: 1,
  };

  const normalized = await normalizeWorkflowForPersistence(workflow);
  const persistedNode = normalized.payload.nodes['node-1'] as Record<string, unknown>;
  const hydratedNode = normalized.workflow.nodes['node-1'] as FileNodeData;

  assert.equal('previewUrl' in persistedNode, false);
  assert.equal('thumbnailUrl' in persistedNode, false);
  assert.equal('imageAsset' in persistedNode, false);
  assert.equal(hydratedNode.previewUrl, undefined);
  assert.equal(hydratedNode.thumbnailUrl, '/api/v1/files/backend-file-persisted/thumbnail');
  assert.equal(hydratedNode.imageAsset?.variants.thumbnail?.url, '/api/v1/files/backend-file-persisted/thumbnail');
  assert.equal(hydratedNode.imageAsset?.variants.original?.url, '/api/v1/files/backend-file-persisted/download');
});

test('normalizeWorkflowForPersistence keeps linked local source metadata without rebuilding remote image asset in memory', async () => {
  const workflow = {
    id: 'workflow-persist-linked-local',
    projectId: 'project-persist-linked-local',
    name: 'Persisted Linked Local Workflow',
    nodes: {
      'node-1': createFileNode({
        fileId: 'backend-file-linked-local',
        backendFileId: 'backend-file-linked-local',
        source: {
          type: 'imported',
          importMethod: 'local',
          sourceDisplayName: 'linked-local.png',
          localSource: {
            status: 'linked',
            referenceId: 'fs-handle-1',
          },
          importedAt: 1710000000000,
        },
        thumbnailUrl: 'blob:thumbnail-local',
        imageAsset: {
          assetId: 'backend-file-linked-local',
          source: 'local',
          version: 1,
          variants: {
            thumbnail: { url: 'runtime:image-thumbnail' },
            original: { url: 'blob:original' },
          },
        },
      }),
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: { width: 1000, height: 1000 },
      relatedTasks: [],
    },
    timestamp: {
      created: 1710000000000,
      updated: 1710000000000,
    },
    version: 1,
  };

  const normalized = await normalizeWorkflowForPersistence(workflow);
  const persistedNode = normalized.payload.nodes['node-1'] as Record<string, unknown>;
  const hydratedNode = normalized.workflow.nodes['node-1'] as FileNodeData;

  assert.equal('thumbnailUrl' in persistedNode, false);
  assert.equal('imageAsset' in persistedNode, false);
  assert.equal((persistedNode.source as Record<string, unknown>).localSource instanceof Object, true);
  assert.equal(hydratedNode.source.localSource?.status, 'linked');
  assert.equal(hydratedNode.source.localSource?.referenceId, 'fs-handle-1');
  assert.equal(hydratedNode.thumbnailUrl, undefined);
  assert.equal(hydratedNode.imageAsset?.variants.thumbnail, undefined);
  assert.equal(hydratedNode.imageAsset?.variants.original, undefined);
});

test('hydrateWorkflowFromApiDetail repairs legacy node-output source with missing task fields', () => {
  const workflow = hydrateWorkflowFromApiDetail({
    workflowId: 'workflow-legacy-output',
    ownerUserId: 'user-1',
    groupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    createdAt: new Date(1710000000000).toISOString(),
    updatedAt: new Date(1710000001234).toISOString(),
    workflow: {
      projectId: 'project-legacy-output',
      name: 'Legacy Output Canvas',
      nodes: {
        '100': {
          id: { value: '100', display: '#00100' },
          type: 'aiImageGen',
          position: { x: 0, y: 0 },
          dimensions: { width: 320, height: 296 },
          rotation: 0,
          scale: 1,
          locked: false,
          status: 'idle',
          zIndex: 0,
          timestamp: { created: 10, updated: 20 },
          references: [],
          outputs: ['file-result-1'],
          config: {},
          tasks: [{
            taskId: 'task-result-1',
            taskNo: 'TASK-result-1',
            nodeId: '100',
            nodeType: 'aiImageGen',
            status: 'completed',
            scope: 'node',
            createdAt: 111,
          }],
        },
        'node-1': createFileNode({
          fileId: 'file-result-1',
          backendFileId: 'file-result-1',
          source: {
            type: 'node-output',
          } as FileNodeData['source'],
        }),
      },
      connections: [{
        id: 'edge-output-1',
        type: 'output-link',
        sourceId: '100',
        targetId: 'node-1',
        sourceHandle: 'result',
        order: 0,
      }],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 2,
        connectionCount: 1,
        lastNodeId: 100,
        canvasSize: { width: 1000, height: 1000 },
        relatedTasks: [],
      },
      timestamp: 1710000001234,
      version: 2,
    },
  });

  const fileNode = workflow.nodes['node-1'] as FileNodeData;
  assert.equal(fileNode.source.type, 'node-output');
  assert.equal(fileNode.source.producerNodeId, '100');
  assert.equal(fileNode.source.producerNodeDisplayId, '#00100');
  assert.equal(fileNode.source.producerNodeType, 'aiImageGen');
  assert.equal(fileNode.source.taskId, 'task-result-1');
  assert.equal(fileNode.source.taskNo, 'TASK-result-1');
  assert.equal(fileNode.source.taskCreatedAt, 111);
  assert.equal(typeof fileNode.source.taskCompletedAt, 'number');
});

test('hydrateWorkflowFromApiDetail backfills legacy storyboard task ref identity fields', () => {
  const workflow = hydrateWorkflowFromApiDetail({
    workflowId: 'workflow-storyboard-legacy-task-ref',
    ownerUserId: 'user-1',
    groupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    createdAt: new Date(1710000000000).toISOString(),
    updatedAt: new Date(1710000001234).toISOString(),
    workflow: {
      projectId: 'project-storyboard-legacy-task-ref',
      name: 'Storyboard Legacy Task Ref',
      nodes: {
        '100': createStoryboardNode({
          tasks: [{
            taskId: 'task-storyboard-image-1',
            taskNo: 'TASK-STORYBOARD-IMAGE-1',
            runId: 'run-storyboard-image-1',
            runNo: 'RUN-STORYBOARD-IMAGE-1',
            scope: 'group',
            groupId: 'shot-1',
            groupLabel: 'Shot 1',
            groupOrder: 1,
            status: 'completed',
            createdAt: 1,
          }],
        }),
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 100,
        canvasSize: { width: 1000, height: 1000 },
        relatedTasks: [{
          taskId: 'task-storyboard-image-1',
          taskNo: 'TASK-STORYBOARD-IMAGE-1',
          runId: 'run-storyboard-image-1',
          runNo: 'RUN-STORYBOARD-IMAGE-1',
          nodeId: '100',
          nodeDisplayId: '#00100',
          nodeType: 'aiStoryboard',
          groupId: 'shot-1',
          groupLabel: 'Shot 1',
          groupOrder: 1,
        }],
      },
      timestamp: 1710000001234,
      version: 2,
    },
  });

  const storyboardNode = workflow.nodes['100'] as AINodeData;
  assert.equal(storyboardNode.tasks[0]?.outputHandle, 'shot-1:result');
  assert.equal(workflow.metadata.relatedTasks?.[0]?.outputHandle, 'shot-1:result');
});

test('hydrateWorkflowFromApiDetail backfills imported source display fields for legacy workflows', () => {
  const workflow = hydrateWorkflowFromApiDetail({
    workflowId: 'workflow-legacy-imported-source',
    ownerUserId: 'user-1',
    groupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    createdAt: new Date(1710000000000).toISOString(),
    updatedAt: new Date(1710000001234).toISOString(),
    workflow: {
      projectId: 'project-legacy-imported-source',
      name: 'Legacy Imported Source',
      nodes: {
        'node-1': createFileNode({
          source: {
            type: 'imported',
            importMethod: 'local',
            originalPath: 'legacy-name.png',
            importedAt: 123,
          },
        }),
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 1,
        canvasSize: { width: 1000, height: 1000 },
        relatedTasks: [],
      },
      timestamp: 1710000001234,
      version: 1,
    },
  });

  const fileNode = workflow.nodes['node-1'] as FileNodeData;
  assert.equal(fileNode.source.type, 'imported');
  assert.equal(fileNode.source.sourceDisplayName, 'legacy-name.png');
  assert.equal(fileNode.source.localSource?.status, 'unknown');
  assert.equal(fileNode.source.originalPath, undefined);
});

test('hydrateWorkflowFromApiDetail preserves path-like legacy originalPath only as compatibility metadata', () => {
  const workflow = hydrateWorkflowFromApiDetail({
    workflowId: 'workflow-legacy-imported-path',
    ownerUserId: 'user-1',
    groupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    createdAt: new Date(1710000000000).toISOString(),
    updatedAt: new Date(1710000001234).toISOString(),
    workflow: {
      projectId: 'project-legacy-imported-path',
      name: 'Legacy Imported Path',
      nodes: {
        'node-1': createFileNode({
          source: {
            type: 'imported',
            importMethod: 'local',
            originalPath: 'C:\\Users\\tester\\Pictures\\legacy-name.png',
            importedAt: 123,
          },
        }),
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 1,
        canvasSize: { width: 1000, height: 1000 },
        relatedTasks: [],
      },
      timestamp: 1710000001234,
      version: 1,
    },
  });

  const fileNode = workflow.nodes['node-1'] as FileNodeData;
  assert.equal(fileNode.source.type, 'imported');
  assert.equal(fileNode.source.sourceDisplayName, 'legacy-name.png');
  assert.equal(fileNode.source.originalPath, 'C:\\Users\\tester\\Pictures\\legacy-name.png');
  assert.equal(fileNode.source.localSource?.status, 'unknown');
});

test('normalizeWorkflowForPersistence migrates file-name-only originalPath into sourceDisplayName', async () => {
  const workflow = {
    id: 'workflow-persist-legacy-original-path',
    projectId: 'project-persist-legacy-original-path',
    name: 'Persist Legacy Original Path',
    nodes: {
      'node-1': createFileNode({
        fileId: 'backend-file-legacy-original-path',
        backendFileId: 'backend-file-legacy-original-path',
        source: {
          type: 'imported',
          importMethod: 'local',
          originalPath: 'legacy-name.png',
          localSource: {
            status: 'available',
            referenceId: 'fs-handle-legacy',
            kind: 'file-system-access',
          },
          importedAt: 1710000000000,
        },
      }),
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: { width: 1000, height: 1000 },
      relatedTasks: [],
    },
    timestamp: {
      created: 1710000000000,
      updated: 1710000000000,
    },
    version: 1,
  };

  const normalized = await normalizeWorkflowForPersistence(workflow);
  const persistedNode = normalized.payload.nodes['node-1'] as Record<string, unknown>;
  const persistedSource = persistedNode.source as Record<string, unknown>;
  const hydratedNode = normalized.workflow.nodes['node-1'] as FileNodeData;

  assert.equal(persistedSource.sourceDisplayName, 'legacy-name.png');
  assert.equal('originalPath' in persistedSource, false);
  assert.equal((persistedSource.localSource as Record<string, unknown>).status, 'linked');
  assert.equal(hydratedNode.source.sourceDisplayName, 'legacy-name.png');
  assert.equal(hydratedNode.source.originalPath, undefined);
  assert.equal(hydratedNode.source.localSource?.status, 'linked');
});

test('hydrateWorkflowFromApiDetail keeps linked local imported sources free of remote fallback urls', () => {
  const workflow = hydrateWorkflowFromApiDetail({
    workflowId: 'workflow-linked-local-source',
    ownerUserId: 'user-1',
    groupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    createdAt: new Date(1710000000000).toISOString(),
    updatedAt: new Date(1710000001234).toISOString(),
    workflow: {
      projectId: 'project-linked-local-source',
      name: 'Linked Local Source',
      nodes: {
        'node-1': createFileNode({
          source: {
            type: 'imported',
            importMethod: 'local',
            sourceDisplayName: 'linked-local.png',
            localSource: {
              status: 'linked',
              referenceId: 'fs-handle-1',
            },
            importedAt: 123,
          },
        }),
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 1,
        canvasSize: { width: 1000, height: 1000 },
        relatedTasks: [],
      },
      timestamp: 1710000001234,
      version: 1,
    },
  });

  const fileNode = workflow.nodes['node-1'] as FileNodeData;
  assert.equal(fileNode.thumbnailUrl, undefined);
  assert.equal(fileNode.imageAsset?.variants.thumbnail, undefined);
  assert.equal(fileNode.imageAsset?.variants.original, undefined);
  assert.equal(fileNode.source.localSource?.status, 'linked');
  assert.equal(fileNode.source.localSource?.referenceId, 'fs-handle-1');
});

test('normalizeWorkflowForPersistence strips remote image resources from linked local sources while preserving video preview urls', async () => {
  const imageWorkflow = {
    id: 'workflow-persist-linked-local-remote-image',
    projectId: 'project-persist-linked-local-remote-image',
    name: 'Linked Local Remote Image Cleanup',
    nodes: {
      'node-1': createFileNode({
        fileId: 'backend-file-linked-local-remote-image',
        backendFileId: 'backend-file-linked-local-remote-image',
        source: {
          type: 'imported',
          importMethod: 'local',
          sourceDisplayName: 'linked-local.png',
          localSource: {
            status: 'linked',
            referenceId: 'fs-handle-1',
            kind: 'file-system-access',
          },
          importedAt: 1710000000000,
        },
        thumbnailUrl: '/api/v1/files/backend-file-linked-local-remote-image/thumbnail',
        imageAsset: {
          assetId: 'backend-file-linked-local-remote-image',
          source: 'remote',
          version: 1,
          variants: {
            thumbnail: {
              url: '/api/v1/files/backend-file-linked-local-remote-image/thumbnail',
              width: 320,
              height: 180,
            },
            original: {
              url: '/api/v1/files/backend-file-linked-local-remote-image/download',
              width: 512,
              height: 512,
            },
          },
        },
      }),
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: { width: 1000, height: 1000 },
      relatedTasks: [],
    },
    timestamp: {
      created: 1710000000000,
      updated: 1710000000000,
    },
    version: 1,
  };

  const normalizedImage = await normalizeWorkflowForPersistence(imageWorkflow);
  const hydratedImageNode = normalizedImage.workflow.nodes['node-1'] as FileNodeData;

  assert.equal(hydratedImageNode.thumbnailUrl, undefined);
  assert.equal(hydratedImageNode.previewUrl, undefined);
  assert.equal(hydratedImageNode.imageAsset?.variants.thumbnail, undefined);
  assert.equal(hydratedImageNode.imageAsset?.variants.original, undefined);
  assert.equal(hydratedImageNode.source.localSource?.status, 'linked');
  assert.equal(hydratedImageNode.source.localSource?.referenceId, 'fs-handle-1');

  const videoWorkflow = {
    id: 'workflow-persist-linked-local-video-preview',
    projectId: 'project-persist-linked-local-video-preview',
    name: 'Linked Local Video Preview',
    nodes: {
      'node-1': createFileNode({
        type: 'video',
        fileId: 'backend-video-linked-local',
        backendFileId: 'backend-video-linked-local',
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        source: {
          type: 'imported',
          importMethod: 'local',
          sourceDisplayName: 'clip.mp4',
          localSource: {
            status: 'linked',
            referenceId: 'fs-video-1',
            kind: 'file-system-access',
          },
          importedAt: 1710000000000,
        },
        metadata: {
          width: 1280,
          height: 720,
          duration: 8,
        },
        previewUrl: '/api/v1/files/backend-video-linked-local/preview',
        thumbnailUrl: '/api/v1/files/backend-video-linked-local/thumbnail',
      }),
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: { width: 1000, height: 1000 },
      relatedTasks: [],
    },
    timestamp: {
      created: 1710000000000,
      updated: 1710000000000,
    },
    version: 1,
  };

  const normalizedVideo = await normalizeWorkflowForPersistence(videoWorkflow);
  const hydratedVideoNode = normalizedVideo.workflow.nodes['node-1'] as FileNodeData;

  assert.equal(hydratedVideoNode.type, 'video');
  assert.equal(hydratedVideoNode.previewUrl, '/api/v1/files/backend-video-linked-local/preview');
  assert.equal(hydratedVideoNode.thumbnailUrl, '/api/v1/files/backend-video-linked-local/thumbnail');
  assert.equal(hydratedVideoNode.source.localSource?.status, 'linked');
  assert.equal(hydratedVideoNode.source.localSource?.referenceId, 'fs-video-1');
});

test('normalizeWorkflowForPersistence strips runtime-only image object urls from payload and hydrated workflow', async () => {
  const workflow = {
    id: 'workflow-runtime-only-image-cleanup',
    projectId: 'project-runtime-only-image-cleanup',
    name: 'Runtime Only Image Cleanup',
    nodes: {
      'node-1': createFileNode({
        fileId: 'runtime-only-image-file',
        backendFileId: 'runtime-only-image-file',
        source: {
          type: 'imported',
          importMethod: 'local',
          sourceDisplayName: 'runtime-only.png',
          localSource: {
            status: 'runtime-only',
          },
          importedAt: 1710000000000,
        },
        thumbnailUrl: 'blob:runtime-only-thumbnail',
        previewUrl: 'runtime:image-preview',
        imageAsset: {
          assetId: 'runtime-only-image-file',
          source: 'local',
          version: 1,
          variants: {
            thumbnail: {
              url: 'blob:runtime-only-thumbnail',
            },
            original: {
              url: 'file:///tmp/runtime-only.png',
            },
          },
        },
      }),
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
      canvasSize: { width: 1000, height: 1000 },
      relatedTasks: [],
    },
    timestamp: {
      created: 1710000000000,
      updated: 1710000000000,
    },
    version: 1,
  };

  const normalized = await normalizeWorkflowForPersistence(workflow);
  const persistedNode = normalized.payload.nodes['node-1'] as Record<string, unknown>;
  const hydratedNode = normalized.workflow.nodes['node-1'] as FileNodeData;

  assert.equal('previewUrl' in persistedNode, false);
  assert.equal('thumbnailUrl' in persistedNode, false);
  assert.equal('imageAsset' in persistedNode, false);
  assert.equal(hydratedNode.previewUrl, undefined);
  assert.equal(hydratedNode.thumbnailUrl, '/api/v1/files/runtime-only-image-file/thumbnail');
  assert.equal(hydratedNode.imageAsset?.variants.thumbnail?.url, '/api/v1/files/runtime-only-image-file/thumbnail');
  assert.equal(hydratedNode.imageAsset?.variants.original?.url, '/api/v1/files/runtime-only-image-file/download');
});

test('normalizeWorkflowForPersistence strips storyboard execution runtime fields from persisted payload only', async () => {
  const storyboardNode = createStoryboardNode();
  const workflow = {
    id: 'workflow-storyboard-runtime-cleanup',
    projectId: 'project-storyboard-runtime-cleanup',
    name: 'Storyboard Runtime Cleanup',
    nodes: {
      [storyboardNode.id.value]: storyboardNode,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 100,
      canvasSize: { width: 1000, height: 1000 },
      relatedTasks: [],
    },
    timestamp: {
      created: 1710000000000,
      updated: 1710000000000,
    },
    version: 1,
  };

  const normalized = await normalizeWorkflowForPersistence(workflow);
  const persistedNode = normalized.payload.nodes[storyboardNode.id.value] as Record<string, unknown>;
  const persistedConfig = persistedNode.config as Record<string, unknown>;
  const persistedShot = (persistedConfig.shots as Array<Record<string, unknown>>)[0];
  const runtimeShot = ((normalized.workflow.nodes[storyboardNode.id.value] as AINodeData).config.shots as StoryboardShotData[])[0];

  assert.ok(persistedShot);
  assert.equal('imageGenStatus' in persistedShot, false);
  assert.equal('imageGenMessage' in persistedShot, false);
  assert.equal('imageGenRunId' in persistedShot, false);
  assert.equal('videoGenStatus' in persistedShot, false);
  assert.equal('videoProgress' in persistedShot, false);
  assert.equal('videoError' in persistedShot, false);
  assert.equal('videoRunId' in persistedShot, false);
  assert.equal(persistedShot.imageFileId, 'image-result-1');
  assert.equal(persistedShot.videoFileId, 'video-result-1');
  assert.equal(runtimeShot?.imageGenStatus, 'generating');
  assert.equal(runtimeShot?.videoGenStatus, 'failed');
});

test('hydrateWorkflowFromApiDetail preserves output-link graph while rebuilding node-output file source metadata', () => {
  const sourceNode = createSourceNode({
    outputs: ['file-result-1'],
    tasks: [createSourceTaskRef()],
  });
  const workflow = hydrateWorkflowFromApiDetail({
    workflowId: 'workflow-output-link-restore',
    ownerUserId: 'user-1',
    groupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    createdAt: new Date(1710000000000).toISOString(),
    updatedAt: new Date(1710000001234).toISOString(),
    workflow: {
      projectId: 'project-output-link-restore',
      name: 'Output Link Restore',
      nodes: {
        [sourceNode.id.value]: sourceNode,
        'node-1': createFileNode({
          fileId: 'file-result-1',
          backendFileId: 'file-result-1',
          source: {
            type: 'node-output',
          } as FileNodeData['source'],
        }),
      },
      connections: [{
        id: 'output-link-1',
        type: 'output-link',
        sourceId: sourceNode.id.value,
        targetId: 'node-1',
        sourceHandle: 'group-1:result',
        order: 3,
      }],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 2,
        connectionCount: 1,
        lastNodeId: 100,
        canvasSize: { width: 1000, height: 1000 },
        relatedTasks: [],
      },
      timestamp: 1710000001234,
      version: 2,
    },
  });

  const fileNode = workflow.nodes['node-1'] as FileNodeData;

  assert.equal(workflow.connections.length, 1);
  assert.equal(workflow.connections[0]?.type, 'output-link');
  assert.equal(workflow.connections[0]?.sourceId, sourceNode.id.value);
  assert.equal(workflow.connections[0]?.targetId, 'node-1');
  assert.equal(workflow.connections[0]?.sourceHandle, 'group-1:result');
  assert.equal(workflow.connections[0]?.order, 3);
  assert.equal(fileNode.source.type, 'node-output');
  assert.equal(fileNode.source.producerNodeId, sourceNode.id.value);
  assert.equal(fileNode.source.taskId, 'task-result-1');
});
