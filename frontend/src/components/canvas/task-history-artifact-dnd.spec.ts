import test from 'node:test';
import assert from 'node:assert/strict';

import type { TaskHistoryListItem, WorkflowTaskHistoryBackendTaskItem } from './task-history.types';
import {
  __testOnly,
  buildTaskHistoryArtifactDragPayload,
  createFileNodeFromTaskHistoryArtifact,
  parseTaskHistoryArtifactDragPayload,
  serializeTaskHistoryArtifactDragPayload,
} from './task-history-artifact-dnd';

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
    prompt: 'prompt',
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

function createItem(fileType: 'image' | 'video' | 'ply'): TaskHistoryListItem {
  const raw = createRawTask();
  const baseBackendFile = {
    fileId: 'result-1',
    originalName: fileType === 'video' ? 'result-1.mp4' : fileType === 'ply' ? 'result-1.ply' : 'result-1.png',
    displayName: fileType === 'video' ? 'result-1.mp4' : fileType === 'ply' ? 'result-1.ply' : 'result-1.png',
    mimeType: fileType === 'video' ? 'video/mp4' : fileType === 'ply' ? 'application/octet-stream' : 'image/png',
    fileType,
    sourceType: 'output' as const,
    sha256: 'sha-result-1',
    size: 1024,
    extension: fileType === 'video' ? 'mp4' : fileType === 'ply' ? 'ply' : 'png',
    width: fileType === 'ply' ? null : 1024,
    height: fileType === 'ply' ? null : 768,
    duration: fileType === 'video' ? 6.2 : null,
    status: 'ready' as const,
    createdAt: '2026-05-08T10:00:05.000Z',
    downloadUrl: '/api/v1/files/result-1/download',
    thumbnailUrl: fileType === 'video' ? '/api/v1/files/result-1/thumbnail' : '/api/v1/files/result-1/thumbnail',
    previewUrl: fileType === 'video' ? '/api/v1/files/result-1/preview' : '/api/v1/files/result-1/preview',
  };

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
    inputPreviewItems: [],
    artifactPreviewItems: [{
      fileId: 'result-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      backendFile: baseBackendFile,
    }],
    primaryArtifact: {
      fileId: 'result-1',
      role: 'result',
      label: 'Result',
      order: 0,
      isPrimary: true,
      backendFile: baseBackendFile,
    },
    recentEvents: [],
    raw,
    relatedTaskRef: {
      taskId: raw.taskId,
      taskNo: raw.taskNo,
      runId: raw.runId,
      runNo: raw.runNo ?? undefined,
      nodeId: raw.nodeId ?? 'node-1',
      nodeDisplayId: '#00001',
      nodeType: raw.nodeType,
      createdAt: Date.parse(raw.createdAt),
    },
  };
}

test('buildTaskHistoryArtifactDragPayload serializes and parses image artifact payload', () => {
  const item = createItem('image');
  const payload = buildTaskHistoryArtifactDragPayload(item, item.primaryArtifact);

  assert.ok(payload);
  assert.equal(payload?.fileType, 'image');
  assert.equal(payload?.thumbnailUrl, '/api/v1/files/result-1/thumbnail');
  assert.equal(payload?.downloadUrl, '/api/v1/files/result-1/download');

  const parsed = parseTaskHistoryArtifactDragPayload(
    serializeTaskHistoryArtifactDragPayload(payload!),
  );

  assert.deepEqual(parsed, payload);
});

test('buildTaskHistoryArtifactDragPayload prefers persistent backend urls over stale blob fileInfo urls', () => {
  const item = createItem('image');
  if (!item.primaryArtifact) {
    throw new Error('Expected primary artifact.');
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
      path: 'blob:http://localhost/stale-download',
      thumbnailPath: 'blob:http://localhost/stale-thumbnail',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:05.000Z'),
        updated: Date.parse('2026-05-08T10:00:05.000Z'),
      },
    },
  };

  const payload = buildTaskHistoryArtifactDragPayload(item, item.primaryArtifact);
  assert.ok(payload);
  assert.equal(payload?.thumbnailUrl, '/api/v1/files/result-1/thumbnail');
  assert.equal(payload?.downloadUrl, '/api/v1/files/result-1/download');
});

test('createFileNodeFromTaskHistoryArtifact creates remote image node with backend binding', () => {
  const item = createItem('image');
  const payload = buildTaskHistoryArtifactDragPayload(item, item.primaryArtifact);
  assert.ok(payload);

  const node = createFileNodeFromTaskHistoryArtifact(payload!, {
    value: '101',
    display: '#00101',
  }, {
    x: 120,
    y: 240,
  });

  assert.equal(node.type, 'image');
  assert.equal(node.fileId, 'result-1');
  assert.equal(node.backendFileId, 'result-1');
  assert.equal(node.source.type, 'node-output');
  assert.equal(node.source.taskId, 'task-1');
  assert.equal(node.thumbnailUrl, '/api/v1/files/result-1/thumbnail');
  assert.equal(node.imageAsset?.variants.original?.url, '/api/v1/files/result-1/download');
});

test('createFileNodeFromTaskHistoryArtifact creates remote video node with preview url', () => {
  const item = createItem('video');
  const payload = buildTaskHistoryArtifactDragPayload(item, item.primaryArtifact);
  assert.ok(payload);

  const node = createFileNodeFromTaskHistoryArtifact(payload!, {
    value: '102',
    display: '#00102',
  }, {
    x: 40,
    y: 60,
  });

  assert.equal(node.type, 'video');
  assert.equal(node.previewUrl, '/api/v1/files/result-1/preview');
  assert.equal(node.thumbnailUrl, '/api/v1/files/result-1/thumbnail');
});

test('resolveArtifactNodeType recognizes ply backend files', () => {
  const item = createItem('ply');
  assert.equal(__testOnly.resolveArtifactNodeType(item.primaryArtifact), 'ply');
});
