import test from 'node:test';
import assert from 'node:assert/strict';

import type { TaskHistoryListItem, WorkflowTaskHistoryBackendTaskItem } from './task-history.types';
import { __testOnly as taskHistoryArtifactPreviewTestOnly } from './TaskHistoryArtifactPreview';
import { normalizeWorkflowTaskHistoryItem } from '@/services/task-history-normalizer';

function createTask(overrides: Partial<WorkflowTaskHistoryBackendTaskItem> = {}): WorkflowTaskHistoryBackendTaskItem {
  return {
    sequence: 1,
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
    aspectRatio: '4:5',
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

function toReloadedItem(task: WorkflowTaskHistoryBackendTaskItem): TaskHistoryListItem {
  return {
    taskId: task.taskId,
    taskNo: task.taskNo,
    runId: task.runId,
    runNo: task.runNo,
    workflowId: task.workflowId,
    projectId: task.projectId,
    nodeId: task.nodeId ?? null,
    nodeTitle: task.nodeTitle ?? null,
    nodeType: task.nodeType,
    taskType: task.taskType,
    groupId: task.groupId,
    groupOrder: task.groupOrder,
    status: task.status,
    currentStep: task.currentStep,
    createdAt: Date.parse(task.createdAt),
    startedAt: task.startedAt ? Date.parse(task.startedAt) : null,
    completedAt: task.completedAt ? Date.parse(task.completedAt) : null,
    durationMs: task.durationMs ?? null,
    provider: task.provider,
    model: task.model,
    title: task.nodeTitle ?? task.taskNo,
    subtitle: 'subtitle',
    message: 'done',
    errorCode: null,
    errorMessage: null,
    latestEventAt: Date.parse(task.completedAt ?? task.createdAt),
    isTerminal: true,
    isFailed: false,
    isCancelled: false,
    isSuccessful: true,
    inputPreviewItems: [],
    artifactPreviewItems: [],
    primaryArtifact: null,
    recentEvents: [],
    raw: task,
  };
}

test('TaskHistoryArtifactPreview reload path recovers a persistent preview source when only resultFileId is stored', async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.equal(url, '/api/v1/files/result-1');

      return new Response(JSON.stringify({
        code: 200,
        message: 'ok',
        data: {
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
          height: 768,
          duration: null,
          status: 'ready',
          createdAt: '2026-05-08T10:00:05.000Z',
          downloadUrl: '/api/v1/files/result-1/download',
          thumbnailUrl: '/api/v1/files/result-1/thumbnail',
          previewUrl: '/api/v1/files/result-1/preview',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  try {
    const normalized = await normalizeWorkflowTaskHistoryItem(createTask({
      resultFile: null,
      resultFileId: 'result-1',
    }));

    const previewSources = taskHistoryArtifactPreviewTestOnly.getArtifactPreviewSources(normalized.primaryArtifact);
    assert.equal(previewSources.primary, '/api/v1/files/result-1/thumbnail');
    assert.equal(previewSources.fallback, '/api/v1/files/result-1/preview');
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('TaskHistoryArtifactPreview reload path still prefers backend preview sources over stale blob fileInfo', () => {
  const item = toReloadedItem(createTask());
  item.primaryArtifact = {
    fileId: 'result-1',
    role: 'result',
    label: 'Result',
    order: 0,
    isPrimary: true,
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
      path: 'blob:http://localhost/stale-result-path',
      thumbnailPath: 'blob:http://localhost/stale-result-thumbnail',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:05.000Z'),
        updated: Date.parse('2026-05-08T10:00:05.000Z'),
      },
    },
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
      height: 768,
      duration: null,
      status: 'ready',
      createdAt: '2026-05-08T10:00:05.000Z',
      thumbnailUrl: '/api/v1/files/result-1/thumbnail',
      previewUrl: '/api/v1/files/result-1/preview',
      downloadUrl: '/api/v1/files/result-1/download',
    },
  };

  const previewSources = taskHistoryArtifactPreviewTestOnly.getArtifactPreviewSources(item.primaryArtifact);
  assert.equal(previewSources.primary, '/api/v1/files/result-1/thumbnail');
  assert.equal(previewSources.fallback, '/api/v1/files/result-1/preview');
});

test('TaskHistoryArtifactPreview uses ephemeral runtime preview instead of persistent download when no thumbnail preview exists', () => {
  const item = toReloadedItem(createTask());
  item.primaryArtifact = {
    fileId: 'result-1',
    role: 'result',
    label: 'Result',
    order: 0,
    isPrimary: true,
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
      path: 'blob:http://localhost/runtime-only-result-path',
      thumbnailPath: 'blob:http://localhost/runtime-only-result-thumbnail',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: {
        created: Date.parse('2026-05-08T10:00:05.000Z'),
        updated: Date.parse('2026-05-08T10:00:05.000Z'),
      },
    },
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
      height: 768,
      duration: null,
      status: 'ready',
      createdAt: '2026-05-08T10:00:05.000Z',
      thumbnailUrl: undefined,
      previewUrl: undefined,
      downloadUrl: '/api/v1/files/result-1/download',
    },
  };

  const previewSources = taskHistoryArtifactPreviewTestOnly.getArtifactPreviewSources(item.primaryArtifact);
  assert.equal(previewSources.primary, 'blob:http://localhost/runtime-only-result-thumbnail');
  assert.equal(previewSources.fallback, undefined);
});
