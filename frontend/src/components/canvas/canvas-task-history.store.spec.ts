import test from 'node:test';
import assert from 'node:assert/strict';

import type { WorkflowRelatedTaskRef } from '@/types';
import type {
  TaskHistoryDetail,
  TaskHistoryListItem,
  WorkflowTaskHistoryBackendTaskItem,
} from './task-history.types';
import { canvasTaskHistoryStore, createTaskHistorySummaryItem } from './canvas-task-history.store';

function createRelatedTaskRef(overrides: Partial<WorkflowRelatedTaskRef> = {}): WorkflowRelatedTaskRef {
  return {
    taskId: 'task-1',
    taskNo: 'TASK-1',
    batchId: 'RUN-1',
    runId: 'run-1',
    runNo: 'RUN-1',
    taskType: 'image-gen',
    nodeId: 'node-1',
    nodeDisplayId: '#00001',
    nodeType: 'aiImageGen',
    groupId: 'group-1',
    groupLabel: 'Group 1',
    groupOrder: 0,
    outputHandle: 'group-1:result',
    createdAt: 1710000000000,
    ...overrides,
  };
}

function createBackendTaskItem(overrides: Partial<WorkflowTaskHistoryBackendTaskItem> = {}): WorkflowTaskHistoryBackendTaskItem {
  return {
    taskId: 'task-1',
    taskNo: 'TASK-1',
    runId: 'run-1',
    runNo: 'RUN-1',
    workflowId: 'workflow-1',
    projectId: 'project-1',
    nodeId: 'node-1',
    nodeTitle: 'AI Image Gen',
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    groupId: 'group-1',
    groupOrder: 0,
    provider: 'laozhang',
    model: 'gemini-3-pro-image-preview',
    status: 'completed',
    currentStep: 'final',
    currentAttemptNo: 1,
    retryCount: 0,
    maxRetries: 0,
    maxAttempts: 1,
    lastErrorCode: null,
    lastErrorMessage: null,
    resultFileId: 'result-file-1',
    createdAt: '2024-03-09T16:00:00.000Z',
    startedAt: '2024-03-09T16:00:01.000Z',
    completedAt: '2024-03-09T16:00:05.000Z',
    durationMs: 4000,
    input: null,
    inputFileId: 'input-file-1',
    sourceFileId: null,
    renderFileId: null,
    referenceFileId: null,
    workflowTemplateKey: null,
    providerTaskId: null,
    providerClientId: null,
    prompt: 'prompt',
    referenceFileIds: ['input-file-1'],
    stylePreset: null,
    imageSize: '1K',
    aspectRatio: '1:1',
    whiteModelFileId: null,
    styleReferenceFileId: null,
    inputFile: null,
    sourceFile: null,
    renderFile: null,
    referenceFile: null,
    whiteModelFile: null,
    styleReferenceFile: null,
    resultFile: null,
    ...overrides,
  };
}

function createTaskHistoryItem(overrides: Partial<TaskHistoryListItem> = {}): TaskHistoryListItem {
  const raw = createBackendTaskItem();
  return {
    taskId: raw.taskId,
    taskNo: raw.taskNo,
    runId: raw.runId,
    runNo: raw.runNo,
    workflowId: raw.workflowId,
    projectId: raw.projectId,
    nodeId: raw.nodeId ?? null,
    nodeTitle: raw.nodeTitle ?? null,
    nodeType: raw.nodeType,
    taskType: raw.taskType,
    groupId: raw.groupId,
    groupOrder: raw.groupOrder,
    status: raw.status,
    currentStep: raw.currentStep,
    createdAt: Date.parse(raw.createdAt),
    startedAt: raw.startedAt ? Date.parse(raw.startedAt) : null,
    completedAt: raw.completedAt ? Date.parse(raw.completedAt) : null,
    durationMs: raw.durationMs ?? null,
    provider: raw.provider,
    model: raw.model,
    title: raw.nodeTitle ?? raw.nodeType,
    subtitle: 'Group 1',
    message: 'done',
    errorCode: null,
    errorMessage: null,
    latestEventAt: Date.parse(raw.completedAt ?? raw.createdAt),
    isTerminal: true,
    isFailed: false,
    isCancelled: false,
    isSuccessful: true,
    inputPreviewItems: [],
    artifactPreviewItems: [],
    primaryArtifact: null,
    recentEvents: [],
    raw,
    ...overrides,
  };
}

test('canvasTaskHistoryStore upsertSkeleton is idempotent for identical related tasks', () => {
  const workflowId = 'workflow-idempotent';
  canvasTaskHistoryStore.clear(workflowId);

  const task = createRelatedTaskRef();
  let notifyCount = 0;
  const unsubscribe = canvasTaskHistoryStore.subscribe(() => {
    notifyCount += 1;
  });

  canvasTaskHistoryStore.upsertSkeleton({
    workflowId,
    relatedTasks: [task],
  });

  const firstSnapshot = canvasTaskHistoryStore.getSnapshot(workflowId);
  const firstItem = firstSnapshot.items[0];

  canvasTaskHistoryStore.upsertSkeleton({
    workflowId,
    relatedTasks: [task],
  });

  const secondSnapshot = canvasTaskHistoryStore.getSnapshot(workflowId);
  unsubscribe();

  assert.equal(notifyCount, 1);
  assert.equal(secondSnapshot.items.length, 1);
  assert.equal(secondSnapshot.items[0], firstItem);

  canvasTaskHistoryStore.clear(workflowId);
});

test('canvasTaskHistoryStore keeps hydrated task state when syncing related task skeletons', () => {
  const workflowId = 'workflow-hydrated';
  canvasTaskHistoryStore.clear(workflowId);

  const relatedTask = createRelatedTaskRef();
  const hydratedItem = createTaskHistoryItem();

  canvasTaskHistoryStore.replaceItems({
    workflowId,
    items: [hydratedItem],
  });

  canvasTaskHistoryStore.upsertSkeleton({
    workflowId,
    relatedTasks: [relatedTask],
  });

  const snapshot = canvasTaskHistoryStore.getSnapshot(workflowId);
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0]?.status, 'completed');
  assert.equal(snapshot.items[0]?.message, 'done');
  assert.equal(snapshot.items[0]?.runId, 'run-1');
  assert.equal(snapshot.items[0]?.relatedTaskRef?.outputHandle, 'group-1:result');
  assert.equal(snapshot.items[0]?.artifactPreviewItems.length, 0);

  canvasTaskHistoryStore.clear(workflowId);
});

test('canvasTaskHistoryStore patchItem updates a single task without replacing untouched items', () => {
  const workflowId = 'workflow-patch-item';
  canvasTaskHistoryStore.clear(workflowId);

  const first = createTaskHistoryItem({ taskId: 'task-1', taskNo: 'TASK-1' });
  const second = createTaskHistoryItem({ taskId: 'task-2', taskNo: 'TASK-2' });

  canvasTaskHistoryStore.replaceItems({
    workflowId,
    items: [first, second],
  });

  const beforePatch = canvasTaskHistoryStore.getSnapshot(workflowId);
  const untouched = beforePatch.items.find((item) => item.taskId === 'task-2');

  canvasTaskHistoryStore.patchItem({
    workflowId,
    taskId: 'task-1',
    updater: (item) => ({
      ...item,
      status: 'processing',
      message: 'running',
    }),
  });

  const afterPatch = canvasTaskHistoryStore.getSnapshot(workflowId);
  assert.equal(afterPatch.items.find((item) => item.taskId === 'task-1')?.status, 'processing');
  assert.equal(afterPatch.items.find((item) => item.taskId === 'task-1')?.message, 'running');
  assert.equal(afterPatch.items.find((item) => item.taskId === 'task-2'), untouched);

  canvasTaskHistoryStore.clear(workflowId);
});

test('createTaskHistorySummaryItem strips detail-only fields from list state', () => {
  const detail = {
    ...createTaskHistoryItem({
      inputPreviewItems: [{
        fileId: 'input-1',
        role: 'input',
        label: 'Input',
        order: 0,
      }],
      recentEvents: [],
      raw: createBackendTaskItem(),
    }),
    provider: 'laozhang',
    model: 'gemini-3-pro-image-preview',
    title: 'AI Image Gen',
    subtitle: 'Group 1',
    latestEventAt: Date.now(),
    inputPreviewItems: [{
      fileId: 'input-1',
      role: 'input',
      label: 'Input',
      order: 0,
    }],
    recentEvents: [],
    raw: createBackendTaskItem(),
    events: [],
    eventCount: 0,
  } satisfies TaskHistoryDetail;

  const summary = createTaskHistorySummaryItem(detail);

  assert.equal(Array.isArray(summary.inputPreviewItems), true);
  assert.equal('raw' in summary, false);
  assert.equal(summary.taskId, detail.taskId);
  assert.equal(summary.primaryArtifact, detail.primaryArtifact);
});

test('canvasTaskHistoryStore replaces task item when artifact preview urls are hydrated for the same file id', () => {
  const workflowId = 'workflow-artifact-preview-refresh';
  canvasTaskHistoryStore.clear(workflowId);

  const initialItem = createTaskHistoryItem({
    artifactPreviewItems: [{
      fileId: 'result-file-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      fileInfo: {
        id: 'result-file-1',
        name: 'result.png',
        originalName: 'result.png',
        size: 1024,
        mimeType: 'image/png',
        format: 'png',
        fileType: 'image',
        status: 'ready',
        hash: 'hash-1',
        path: '/api/v1/files/result-file-1/download',
        metadata: {},
        source: { type: 'node-output' },
        timestamp: {
          created: 1710000000000,
          updated: 1710000000000,
        },
      },
    }],
    primaryArtifact: {
      fileId: 'result-file-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      fileInfo: {
        id: 'result-file-1',
        name: 'result.png',
        originalName: 'result.png',
        size: 1024,
        mimeType: 'image/png',
        format: 'png',
        fileType: 'image',
        status: 'ready',
        hash: 'hash-1',
        path: '/api/v1/files/result-file-1/download',
        metadata: {},
        source: { type: 'node-output' },
        timestamp: {
          created: 1710000000000,
          updated: 1710000000000,
        },
      },
    },
  });

  canvasTaskHistoryStore.replaceItems({
    workflowId,
    items: [initialItem],
  });

  const hydratedItem = createTaskHistoryItem({
    artifactPreviewItems: [{
      fileId: 'result-file-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      fileInfo: {
        id: 'result-file-1',
        name: 'result.png',
        originalName: 'result.png',
        size: 1024,
        mimeType: 'image/png',
        format: 'png',
        fileType: 'image',
        status: 'ready',
        hash: 'hash-1',
        path: '/api/v1/files/result-file-1/download',
        thumbnailPath: '/api/v1/files/result-file-1/thumbnail',
        metadata: {},
        source: { type: 'node-output' },
        timestamp: {
          created: 1710000000000,
          updated: 1710000000000,
        },
      },
    }],
    primaryArtifact: {
      fileId: 'result-file-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      fileInfo: {
        id: 'result-file-1',
        name: 'result.png',
        originalName: 'result.png',
        size: 1024,
        mimeType: 'image/png',
        format: 'png',
        fileType: 'image',
        status: 'ready',
        hash: 'hash-1',
        path: '/api/v1/files/result-file-1/download',
        thumbnailPath: '/api/v1/files/result-file-1/thumbnail',
        metadata: {},
        source: { type: 'node-output' },
        timestamp: {
          created: 1710000000000,
          updated: 1710000000000,
        },
      },
    },
  });

  canvasTaskHistoryStore.replaceItems({
    workflowId,
    items: [hydratedItem],
  });

  const snapshot = canvasTaskHistoryStore.getSnapshot(workflowId);
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0] === initialItem, false);
  assert.equal(snapshot.items[0]?.primaryArtifact?.fileInfo?.thumbnailPath, '/api/v1/files/result-file-1/thumbnail');

  canvasTaskHistoryStore.clear(workflowId);
});

test('canvasTaskHistoryStore keeps persisted backend preview summary when runtime merge only provides blob fileInfo', () => {
  const workflowId = 'workflow-artifact-preview-persisted-summary';
  canvasTaskHistoryStore.clear(workflowId);

  const persistedItem = createTaskHistoryItem({
    artifactPreviewItems: [{
      fileId: 'result-file-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      backendFile: {
        fileId: 'result-file-1',
        originalName: 'result.png',
        displayName: 'result.png',
        mimeType: 'image/png',
        fileType: 'image',
        sourceType: 'output',
        sha256: 'hash-1',
        size: 1024,
        extension: 'png',
        width: 1024,
        height: 768,
        duration: null,
        status: 'ready',
        createdAt: '2024-03-09T16:00:05.000Z',
        downloadUrl: '/api/v1/files/result-file-1/download',
        thumbnailUrl: '/api/v1/files/result-file-1/thumbnail',
        previewUrl: '/api/v1/files/result-file-1/preview',
      },
    }],
    primaryArtifact: {
      fileId: 'result-file-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      backendFile: {
        fileId: 'result-file-1',
        originalName: 'result.png',
        displayName: 'result.png',
        mimeType: 'image/png',
        fileType: 'image',
        sourceType: 'output',
        sha256: 'hash-1',
        size: 1024,
        extension: 'png',
        width: 1024,
        height: 768,
        duration: null,
        status: 'ready',
        createdAt: '2024-03-09T16:00:05.000Z',
        downloadUrl: '/api/v1/files/result-file-1/download',
        thumbnailUrl: '/api/v1/files/result-file-1/thumbnail',
        previewUrl: '/api/v1/files/result-file-1/preview',
      },
    },
  });

  canvasTaskHistoryStore.replaceItems({
    workflowId,
    items: [persistedItem],
  });

  const runtimeMergedItem = createTaskHistoryItem({
    artifactPreviewItems: [{
      fileId: 'result-file-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      fileInfo: {
        id: 'result-file-1',
        name: 'result.png',
        originalName: 'result.png',
        size: 1024,
        mimeType: 'image/png',
        format: 'png',
        fileType: 'image',
        status: 'ready',
        hash: 'hash-1',
        path: 'blob:http://localhost/runtime-result-path',
        thumbnailPath: 'blob:http://localhost/runtime-result-thumb',
        metadata: {},
        source: { type: 'node-output' },
        timestamp: {
          created: 1710000000000,
          updated: 1710000000000,
        },
      },
    }],
    primaryArtifact: {
      fileId: 'result-file-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      fileInfo: {
        id: 'result-file-1',
        name: 'result.png',
        originalName: 'result.png',
        size: 1024,
        mimeType: 'image/png',
        format: 'png',
        fileType: 'image',
        status: 'ready',
        hash: 'hash-1',
        path: 'blob:http://localhost/runtime-result-path',
        thumbnailPath: 'blob:http://localhost/runtime-result-thumb',
        metadata: {},
        source: { type: 'node-output' },
        timestamp: {
          created: 1710000000000,
          updated: 1710000000000,
        },
      },
    },
  });

  canvasTaskHistoryStore.replaceItems({
    workflowId,
    items: [runtimeMergedItem],
  });

  const snapshot = canvasTaskHistoryStore.getSnapshot(workflowId);
  assert.equal(snapshot.items[0]?.primaryArtifact?.backendFile?.thumbnailUrl, '/api/v1/files/result-file-1/thumbnail');
  assert.equal(snapshot.items[0]?.primaryArtifact?.backendFile?.previewUrl, '/api/v1/files/result-file-1/preview');

  canvasTaskHistoryStore.clear(workflowId);
});

test('canvasTaskHistoryStore keeps persisted backend input preview summary when runtime merge only provides blob fileInfo', () => {
  const workflowId = 'workflow-input-preview-persisted-summary';
  canvasTaskHistoryStore.clear(workflowId);

  const persistedItem = createTaskHistoryItem({
    inputPreviewItems: [{
      fileId: 'input-file-1',
      role: 'input',
      label: 'Input',
      order: 0,
      backendFile: {
        fileId: 'input-file-1',
        originalName: 'input.png',
        displayName: 'input.png',
        mimeType: 'image/png',
        fileType: 'image',
        sourceType: 'input',
        sha256: 'hash-input-1',
        size: 1024,
        extension: 'png',
        width: 1024,
        height: 768,
        duration: null,
        status: 'ready',
        createdAt: '2024-03-09T16:00:00.000Z',
        downloadUrl: '/api/v1/files/input-file-1/download',
        thumbnailUrl: '/api/v1/files/input-file-1/thumbnail',
        previewUrl: '/api/v1/files/input-file-1/preview',
      },
    }],
  });

  canvasTaskHistoryStore.replaceItems({
    workflowId,
    items: [persistedItem],
  });

  const runtimeMergedItem = createTaskHistoryItem({
    inputPreviewItems: [{
      fileId: 'input-file-1',
      role: 'input',
      label: 'Input',
      order: 0,
      fileInfo: {
        id: 'input-file-1',
        name: 'input.png',
        originalName: 'input.png',
        size: 1024,
        mimeType: 'image/png',
        format: 'png',
        fileType: 'image',
        status: 'ready',
        hash: 'hash-input-1',
        path: 'blob:http://localhost/runtime-input-path',
        thumbnailPath: 'blob:http://localhost/runtime-input-thumb',
        metadata: {},
        source: { type: 'node-output' },
        timestamp: {
          created: 1710000000000,
          updated: 1710000000000,
        },
      },
    }],
  });

  canvasTaskHistoryStore.replaceItems({
    workflowId,
    items: [runtimeMergedItem],
  });

  const snapshot = canvasTaskHistoryStore.getSnapshot(workflowId);
  assert.equal(snapshot.items[0]?.inputPreviewItems?.[0]?.backendFile?.thumbnailUrl, '/api/v1/files/input-file-1/thumbnail');
  assert.equal(snapshot.items[0]?.inputPreviewItems?.[0]?.backendFile?.previewUrl, '/api/v1/files/input-file-1/preview');

  canvasTaskHistoryStore.clear(workflowId);
});
