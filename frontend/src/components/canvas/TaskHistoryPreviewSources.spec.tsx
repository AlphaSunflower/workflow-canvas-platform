import test from 'node:test';
import assert from 'node:assert/strict';

import type { TaskHistoryListItem, WorkflowTaskHistoryBackendTaskItem } from './task-history.types';
import { __testOnly as taskHistoryArtifactPreviewTestOnly } from './TaskHistoryArtifactPreview';
import { __testOnly as taskHistoryInputPreviewStripTestOnly } from './TaskHistoryInputPreviewStrip';

function createRawTask(overrides: Partial<WorkflowTaskHistoryBackendTaskItem> = {}): WorkflowTaskHistoryBackendTaskItem {
  return {
    sequence: 1,
    taskId: 'task-1',
    taskNo: 'TASK-1',
    runId: 'run-1',
    runNo: 'RUN-1',
    workflowId: 'workflow-1',
    projectId: 'project-1',
    nodeId: 'node-1',
    nodeTitle: 'Task One',
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    groupId: 'group-1',
    groupOrder: 0,
    provider: 'laozhang',
    model: 'gpt-image-2-vip',
    status: 'completed',
    currentStep: 'final',
    currentAttemptNo: 1,
    retryCount: 0,
    maxRetries: 2,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    resultFileId: 'result-1',
    createdAt: '2026-05-08T10:00:00.000Z',
    startedAt: '2026-05-08T10:00:01.000Z',
    completedAt: '2026-05-08T10:00:05.000Z',
    durationMs: 4000,
    input: null,
    inputFileId: null,
    sourceFileId: null,
    renderFileId: null,
    referenceFileId: null,
    workflowTemplateKey: null,
    providerTaskId: null,
    providerClientId: null,
    prompt: 'hello world',
    referenceFileIds: null,
    stylePreset: null,
    imageSize: '2K',
    aspectRatio: '16:9',
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

function createItem(): TaskHistoryListItem {
  const raw = createRawTask();
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
    startedAt: Date.parse(raw.startedAt ?? raw.createdAt),
    completedAt: Date.parse(raw.completedAt ?? raw.createdAt),
    durationMs: raw.durationMs ?? null,
    provider: raw.provider,
    model: raw.model,
    title: raw.nodeTitle ?? raw.taskNo,
    subtitle: 'subtitle',
    message: 'done',
    errorCode: null,
    errorMessage: null,
    latestEventAt: Date.parse(raw.completedAt ?? raw.createdAt),
    isTerminal: true,
    isFailed: false,
    isCancelled: false,
    isSuccessful: true,
    inputPreviewItems: [{
      fileId: 'input-1',
      role: 'input',
      label: 'Input',
      order: 0,
      backendFile: {
        fileId: 'input-1',
        originalName: 'input-1.png',
        displayName: 'input-1.png',
        mimeType: 'image/png',
        fileType: 'image',
        sourceType: 'input',
        sha256: 'sha-input-1',
        size: 1024,
        extension: 'png',
        width: 1024,
        height: 1024,
        duration: null,
        status: 'ready',
        createdAt: '2026-05-08T10:00:00.000Z',
        downloadUrl: '/api/v1/files/input-1/download',
        thumbnailUrl: '/api/v1/files/input-1/thumbnail',
        previewUrl: '/api/v1/files/input-1/preview',
      },
    }],
    artifactPreviewItems: [{
      fileId: 'result-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      backendFile: {
        fileId: 'result-1',
        originalName: 'result-1.png',
        displayName: 'result-1.png',
        mimeType: 'image/png',
        fileType: 'image',
        sourceType: 'output',
        sha256: 'sha-result-1',
        size: 1024,
        extension: 'png',
        width: 1024,
        height: 1024,
        duration: null,
        status: 'ready',
        createdAt: '2026-05-08T10:00:05.000Z',
        downloadUrl: '/api/v1/files/result-1/download',
        thumbnailUrl: '/api/v1/files/result-1/thumbnail',
        previewUrl: '/api/v1/files/result-1/preview',
      },
    }],
    primaryArtifact: {
      fileId: 'result-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      backendFile: {
        fileId: 'result-1',
        originalName: 'result-1.png',
        displayName: 'result-1.png',
        mimeType: 'image/png',
        fileType: 'image',
        sourceType: 'output',
        sha256: 'sha-result-1',
        size: 1024,
        extension: 'png',
        width: 1024,
        height: 1024,
        duration: null,
        status: 'ready',
        createdAt: '2026-05-08T10:00:05.000Z',
        downloadUrl: '/api/v1/files/result-1/download',
        thumbnailUrl: '/api/v1/files/result-1/thumbnail',
        previewUrl: '/api/v1/files/result-1/preview',
      },
    },
    recentEvents: [],
    raw,
  };
}

test('TaskHistoryInputPreviewStrip prefers backend thumbnailUrl over previewUrl', () => {
  const item = createItem();
  const inputPreviewItems = item.inputPreviewItems ?? [];
  const selected = taskHistoryInputPreviewStripTestOnly.getPreviewSrc(inputPreviewItems[0]!);
  assert.equal(selected, '/api/v1/files/input-1/thumbnail');
  assert.equal(
    taskHistoryInputPreviewStripTestOnly.getFallbackPreviewSrc(inputPreviewItems[0]!),
    '/api/v1/files/input-1/preview',
  );
});

test('TaskHistoryInputPreviewStrip ignores stale blob input preview when persistent backend thumbnail exists', () => {
  const item = createItem();
  const inputPreviewItems = item.inputPreviewItems ?? [];
  inputPreviewItems[0] = {
    ...inputPreviewItems[0]!,
    fileInfo: {
      id: 'input-1',
      name: 'input-1.png',
      originalName: 'input-1.png',
      size: 1024,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image',
      status: 'ready',
      hash: 'sha-input-1',
      path: 'blob:http://localhost/stale-input-path',
      thumbnailPath: 'blob:http://localhost/stale-input-thumbnail',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:00.000Z'),
        updated: Date.parse('2026-05-08T10:00:00.000Z'),
      },
    },
  };

  const sources = taskHistoryInputPreviewStripTestOnly.getPreviewSources(inputPreviewItems[0]!);
  assert.equal(sources.primary, '/api/v1/files/input-1/thumbnail');
  assert.equal(sources.fallback, '/api/v1/files/input-1/preview');
});

test('TaskHistoryArtifactPreview prefers backend thumbnailUrl for image artifacts', () => {
  const item = createItem();
  const selected = taskHistoryArtifactPreviewTestOnly.getArtifactPreviewUrl(item.primaryArtifact);
  assert.equal(selected, '/api/v1/files/result-1/thumbnail');
  assert.equal(
    taskHistoryArtifactPreviewTestOnly.getArtifactFallbackUrl(item.primaryArtifact),
    '/api/v1/files/result-1/preview',
  );
});

test('TaskHistoryArtifactPreview prefers backend previewUrl over stale blob thumbnailPath after reload', () => {
  const item = createItem();
  if (!item.primaryArtifact?.backendFile) {
    throw new Error('Expected primary artifact backend file.');
  }

  item.primaryArtifact = {
    ...item.primaryArtifact,
    fileInfo: {
      id: 'result-1',
      name: 'result-1.png',
      originalName: 'result-1.png',
      size: 1024,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image',
      status: 'ready',
      hash: 'sha-result-1',
      path: 'blob:http://localhost/stale-runtime-path',
      thumbnailPath: 'blob:http://localhost/stale-runtime-thumbnail',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:05.000Z'),
        updated: Date.parse('2026-05-08T10:00:05.000Z'),
      },
    },
    backendFile: {
      ...item.primaryArtifact.backendFile,
      thumbnailUrl: undefined,
      previewUrl: '/api/v1/files/result-1/preview',
    },
  };

  const selected = taskHistoryArtifactPreviewTestOnly.getArtifactPreviewUrl(item.primaryArtifact);
  assert.equal(selected, '/api/v1/files/result-1/preview');
});

test('TaskHistoryArtifactPreview retains next persistent preview source as fallback when persistent preview exists', () => {
  const item = createItem();
  if (!item.primaryArtifact?.backendFile) {
    throw new Error('Expected primary artifact backend file.');
  }

  item.primaryArtifact = {
    ...item.primaryArtifact,
    fileInfo: {
      id: 'result-1',
      name: 'result-1.png',
      originalName: 'result-1.png',
      size: 1024,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image',
      status: 'ready',
      hash: 'sha-result-1',
      path: 'blob:http://localhost/stale-runtime-path',
      thumbnailPath: 'blob:http://localhost/stale-runtime-thumbnail',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:05.000Z'),
        updated: Date.parse('2026-05-08T10:00:05.000Z'),
      },
    },
  };

  const sources = taskHistoryArtifactPreviewTestOnly.getArtifactPreviewSources(item.primaryArtifact);
  assert.equal(sources.primary, '/api/v1/files/result-1/thumbnail');
  assert.equal(sources.fallback, '/api/v1/files/result-1/preview');
});

test('TaskHistoryArtifactPreview falls back to ephemeral blob only when no persistent preview exists', () => {
  const item = createItem();
  item.primaryArtifact = {
    ...item.primaryArtifact!,
    fileInfo: {
      id: 'result-1',
      name: 'result-1.png',
      originalName: 'result-1.png',
      size: 1024,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image',
      status: 'ready',
      hash: 'sha-result-1',
      path: 'blob:http://localhost/runtime-only-path',
      thumbnailPath: 'blob:http://localhost/runtime-only-thumbnail',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:05.000Z'),
        updated: Date.parse('2026-05-08T10:00:05.000Z'),
      },
    },
    backendFile: {
      ...item.primaryArtifact!.backendFile!,
      thumbnailUrl: undefined,
      previewUrl: undefined,
      downloadUrl: undefined,
    },
  };

  const sources = taskHistoryArtifactPreviewTestOnly.getArtifactPreviewSources(item.primaryArtifact);
  assert.equal(sources.primary, 'blob:http://localhost/runtime-only-thumbnail');
  assert.equal(sources.fallback, undefined);
});

test('TaskHistoryInputPreviewStrip does not use image download url or stale blob path as input preview fallback', () => {
  const item = createItem();
  const inputPreviewItems = item.inputPreviewItems ?? [];
  inputPreviewItems[0] = {
    ...inputPreviewItems[0]!,
    backendFile: {
      ...inputPreviewItems[0]!.backendFile!,
      thumbnailUrl: undefined,
      previewUrl: undefined,
      downloadUrl: '/api/v1/files/input-1/download',
    },
    fileInfo: {
      id: 'input-1',
      name: 'input-1.png',
      originalName: 'input-1.png',
      size: 1024,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image',
      status: 'ready',
      hash: 'sha-input-1',
      path: 'blob:http://localhost/stale-input-path',
      thumbnailPath: 'blob:http://localhost/stale-input-thumbnail',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:00.000Z'),
        updated: Date.parse('2026-05-08T10:00:00.000Z'),
      },
    },
  };

  const sources = taskHistoryInputPreviewStripTestOnly.getPreviewSources(inputPreviewItems[0]!);
  assert.equal(sources.primary, undefined);
  assert.equal(sources.fallback, undefined);
});

test('TaskHistoryArtifactPreview uses previewUrl as fallback when thumbnailUrl is present', () => {
  const item = createItem();
  const persistentSources = taskHistoryArtifactPreviewTestOnly.getArtifactPersistentPreviewUrls(item.primaryArtifact);

  assert.deepEqual(persistentSources, [
    '/api/v1/files/result-1/thumbnail',
    '/api/v1/files/result-1/preview',
  ]);
});

test('TaskHistoryArtifactPreview does not use image download urls as preview fallback', () => {
  const item = createItem();
  item.primaryArtifact = {
    ...item.primaryArtifact!,
    backendFile: {
      ...item.primaryArtifact!.backendFile!,
      thumbnailUrl: undefined,
      previewUrl: undefined,
      downloadUrl: '/api/v1/files/result-1/download',
    },
    fileInfo: {
      id: 'result-1',
      name: 'result-1.png',
      originalName: 'result-1.png',
      size: 1024,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image',
      status: 'ready',
      hash: 'sha-result-1',
      path: '/api/v1/files/result-1/download',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:05.000Z'),
        updated: Date.parse('2026-05-08T10:00:05.000Z'),
      },
    },
  };

  const sources = taskHistoryArtifactPreviewTestOnly.getArtifactPreviewSources(item.primaryArtifact);
  assert.equal(sources.primary, undefined);
  assert.equal(sources.fallback, undefined);
});

test('TaskHistoryInputPreviewStrip uses previewUrl as fallback when thumbnailUrl is present', () => {
  const item = createItem();
  const inputPreviewItems = item.inputPreviewItems ?? [];
  const persistentSources = taskHistoryInputPreviewStripTestOnly.getPersistentPreviewSources(inputPreviewItems[0]!);

  assert.deepEqual(persistentSources, [
    '/api/v1/files/input-1/thumbnail',
    '/api/v1/files/input-1/preview',
  ]);
});

test('TaskHistoryInputPreviewStrip keeps video download fallback when preview is unavailable', () => {
  const item = createItem();
  const inputPreviewItems = item.inputPreviewItems ?? [];
  inputPreviewItems[0] = {
    ...inputPreviewItems[0]!,
    backendFile: {
      ...inputPreviewItems[0]!.backendFile!,
      fileType: 'video',
      mimeType: 'video/mp4',
      thumbnailUrl: '/api/v1/files/input-video/thumbnail',
      previewUrl: undefined,
      downloadUrl: '/api/v1/files/input-video/download',
    },
    fileInfo: {
      id: 'input-video',
      name: 'input-video.mp4',
      originalName: 'input-video.mp4',
      size: 2048,
      mimeType: 'video/mp4',
      format: 'mp4',
      fileType: 'video',
      status: 'ready',
      hash: 'sha-input-video',
      path: '/api/v1/files/input-video/download',
      previewPath: '/api/v1/files/input-video/preview',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:00.000Z'),
        updated: Date.parse('2026-05-08T10:00:00.000Z'),
      },
    },
  };

  const sources = taskHistoryInputPreviewStripTestOnly.getPreviewSources(inputPreviewItems[0]!);
  assert.equal(sources.primary, '/api/v1/files/input-video/download');
  assert.equal(sources.fallback, '/api/v1/files/input-video/preview');
});

test('TaskHistoryInputPreviewStrip keeps model3d download fallback for input preview', () => {
  const item = createItem();
  const inputPreviewItems = item.inputPreviewItems ?? [];
  inputPreviewItems[0] = {
    ...inputPreviewItems[0]!,
    backendFile: {
      ...inputPreviewItems[0]!.backendFile!,
      fileType: 'ply',
      mimeType: 'model/ply',
      thumbnailUrl: undefined,
      previewUrl: undefined,
      downloadUrl: '/api/v1/files/input-model/download',
    },
    fileInfo: {
      id: 'input-model',
      name: 'input-model.ply',
      originalName: 'input-model.ply',
      size: 4096,
      mimeType: 'model/ply',
      format: 'ply',
      fileType: 'model3d',
      status: 'ready',
      hash: 'sha-input-model',
      path: '/api/v1/files/input-model/download',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:00.000Z'),
        updated: Date.parse('2026-05-08T10:00:00.000Z'),
      },
    },
  };

  const sources = taskHistoryInputPreviewStripTestOnly.getPreviewSources(inputPreviewItems[0]!);
  assert.equal(sources.primary, '/api/v1/files/input-model/download');
  assert.equal(sources.fallback, undefined);
});

test('TaskHistoryArtifactPreview builds drag payload for primary artifact', () => {
  const item = createItem();
  const payload = taskHistoryArtifactPreviewTestOnly.buildTaskHistoryArtifactDragPayload(item, item.primaryArtifact);

  assert.ok(payload);
  assert.equal(payload?.taskId, 'task-1');
  assert.equal(payload?.fileId, 'result-1');
  assert.equal(payload?.fileType, 'image');
  assert.equal(payload?.thumbnailUrl, '/api/v1/files/result-1/thumbnail');
});
