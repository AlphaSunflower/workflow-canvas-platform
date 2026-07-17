import test from 'node:test';
import assert from 'node:assert/strict';

import type { WorkflowRelatedTaskRef } from '@/types';
import type {
  ExecutionRuntimeBackendFile,
  ExecutionRuntimeEvent,
} from '@/execution-runtime/execution-runtime.types';
import type {
  WorkflowTaskHistoryBackendTaskItem,
  WorkflowTaskHistoryDetailResponse,
} from '@/components/canvas/task-history.types';
import {
  __testOnly as taskHistoryNormalizerTestOnly,
  normalizeWorkflowTaskHistoryDetail,
  normalizeWorkflowTaskHistoryItem,
  normalizeWorkflowTaskHistoryList,
} from './task-history-normalizer';

function createBackendFile(
  fileId: string,
  overrides: Partial<ExecutionRuntimeBackendFile> = {},
): ExecutionRuntimeBackendFile {
  return {
    fileId,
    originalName: `${fileId}.png`,
    displayName: `${fileId}.png`,
    mimeType: 'image/png',
    fileType: 'image',
    sourceType: 'output',
    sha256: `sha-${fileId}`,
    size: 1024,
    extension: 'png',
    width: 1024,
    height: 768,
    duration: null,
    status: 'ready',
    createdAt: '2026-05-07T10:00:00.000Z',
    thumbnailUrl: `/api/v1/files/${fileId}/thumbnail`,
    downloadUrl: `/api/v1/files/${fileId}/download`,
    previewUrl: `/api/v1/files/${fileId}/preview`,
    ...overrides,
  };
}

function createEvent(
  eventId: string,
  overrides: Partial<ExecutionRuntimeEvent> = {},
): ExecutionRuntimeEvent {
  return {
    eventId,
    eventType: 'task_progress',
    runId: 'run-1',
    taskId: 'task-1',
    attemptNo: 1,
    status: 'processing',
    phase: 'processing',
    stepType: 'final',
    progress: 50,
    message: `event-${eventId}`,
    payload: null,
    timestamp: '2026-05-07T10:00:05.000Z',
    ...overrides,
  };
}

function createTask(
  overrides: Partial<WorkflowTaskHistoryBackendTaskItem> = {},
): WorkflowTaskHistoryBackendTaskItem {
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
    currentAttemptNo: 2,
    retryCount: 1,
    maxRetries: 2,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    resultFileId: 'result-1',
    createdAt: '2026-05-07T10:00:00.000Z',
    startedAt: '2026-05-07T10:00:02.000Z',
    completedAt: '2026-05-07T10:00:08.000Z',
    durationMs: 6000,
    input: {
      prompt: 'generate a room',
      referenceFileIds: ['reference-2', 'reference-1'],
      imageSize: '2K',
      aspectRatio: '4:5',
    },
    inputFileId: 'input-1',
    sourceFileId: 'source-1',
    maskFileId: null,
    maskMode: null,
    renderFileId: 'render-1',
    referenceFileId: 'reference-main',
    workflowTemplateKey: null,
    providerTaskId: 'provider-task-1',
    providerClientId: 'provider-client-1',
    prompt: 'generate a room',
    referenceFileIds: ['reference-2', 'reference-1'],
    stylePreset: null,
    imageSize: '2K',
    aspectRatio: '4:5',
    whiteModelFileId: 'white-1',
    styleReferenceFileId: 'style-1',
    inputFile: createBackendFile('input-1'),
    sourceFile: createBackendFile('source-1'),
    maskFile: null,
    renderFile: createBackendFile('render-1'),
    referenceFile: createBackendFile('reference-main'),
    whiteModelFile: createBackendFile('white-1'),
    styleReferenceFile: createBackendFile('style-1'),
    resultFile: createBackendFile('result-1'),
    ...overrides,
  };
}

function createRelatedTaskRef(overrides: Partial<WorkflowRelatedTaskRef> = {}): WorkflowRelatedTaskRef {
  return {
    taskId: 'task-1',
    taskNo: 'TASK-1',
    batchId: 'run-1',
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
    createdAt: Date.parse('2026-05-07T10:00:00.000Z'),
    ...overrides,
  };
}

test('normalizeWorkflowTaskHistoryItem hydrates ordered input previews and primary artifact', async () => {
  const task = createTask();
  const item = await normalizeWorkflowTaskHistoryItem(task, {
    events: [
      createEvent('event-1', {
        timestamp: '2026-05-07T10:00:07.000Z',
        message: 'task completed',
        status: 'completed',
        progress: 100,
      }),
    ],
    relatedTasks: [createRelatedTaskRef()],
  });

  assert.equal(item.taskId, 'task-1');
  assert.equal(item.title, 'AI Image Gen');
  assert.equal(item.subtitle?.includes('gpt-image-2-vip'), true);
  assert.equal(item.isSuccessful, true);
  assert.equal(item.primaryArtifact?.fileId, 'result-1');
  assert.equal(item.primaryArtifact?.fileInfo?.thumbnailPath, '/api/v1/files/result-1/thumbnail');
  assert.equal(item.primaryArtifact?.backendFile?.previewUrl, '/api/v1/files/result-1/preview');
  const inputPreviewItems = item.inputPreviewItems ?? [];
  assert.deepEqual(
    inputPreviewItems.map((preview) => preview.fileId),
    ['input-1', 'source-1', 'render-1', 'reference-main', 'white-1', 'style-1', 'reference-2', 'reference-1'],
  );
  assert.equal(inputPreviewItems[0]?.fileInfo?.thumbnailPath, '/api/v1/files/input-1/thumbnail');
  assert.equal(item.relatedTaskRef?.outputHandle, 'group-1:result');
  assert.equal(item.latestEventAt, Date.parse('2026-05-07T10:00:07.000Z'));
  assert.equal(item.message, 'task completed');
});

test('normalizeWorkflowTaskHistoryItem exposes image inpaint original, mask, and result previews', async () => {
  const task = createTask({
    nodeTitle: '图片局部重绘',
    nodeType: 'aiImageInpaint',
    taskType: 'image-inpaint',
    input: {
      prompt: 'replace the marked area',
      sourceFileId: 'source-inpaint',
      maskFileId: 'mask-inpaint',
      maskMode: 'strong-mask',
      imageSize: '2K',
      aspectRatio: '16:9',
    },
    inputFileId: 'source-inpaint',
    sourceFileId: 'source-inpaint',
    maskFileId: 'mask-inpaint',
    maskMode: 'strong-mask',
    renderFileId: null,
    referenceFileId: null,
    referenceFileIds: null,
    whiteModelFileId: null,
    styleReferenceFileId: null,
    inputFile: createBackendFile('source-inpaint'),
    sourceFile: createBackendFile('source-inpaint'),
    maskFile: createBackendFile('mask-inpaint'),
    renderFile: null,
    referenceFile: null,
    whiteModelFile: null,
    styleReferenceFile: null,
    resultFileId: 'result-inpaint',
    resultFile: createBackendFile('result-inpaint'),
  });

  const item = await normalizeWorkflowTaskHistoryItem(task);

  assert.deepEqual(
    item.inputPreviewItems?.map((preview) => [preview.label, preview.role, preview.fileId]),
    [
      ['原图', 'input', 'source-inpaint'],
      ['标记图', 'mask', 'mask-inpaint'],
    ],
  );
  assert.equal(item.primaryArtifact?.label, '重绘结果');
  assert.equal(item.primaryArtifact?.fileId, 'result-inpaint');
});

test('normalizeWorkflowTaskHistoryItem maps image inpaint validation failures to readable messages', async () => {
  const item = await normalizeWorkflowTaskHistoryItem(createTask({
    nodeType: 'aiImageInpaint',
    taskType: 'image-inpaint',
    status: 'failed',
    lastErrorCode: 'INVALID_AI_IMAGE_INPAINT_TASK_INPUT',
    lastErrorMessage: '任务输入与已注册节点执行器不匹配。',
    resultFileId: null,
    resultFile: null,
  }));

  assert.equal(item.isFailed, true);
  assert.equal(
    item.message,
    '图片局部重绘任务输入无效，请确认原图、标记图、遮罩模式和提示词都已正确提交',
  );
});

test('normalizeWorkflowTaskHistoryItem falls back to backend previewUrl when image thumbnailUrl is missing', async () => {
  const task = createTask({
    resultFile: createBackendFile('result-preview-only', {
      thumbnailUrl: undefined,
      previewUrl: '/api/v1/files/result-preview-only/preview',
    }),
    resultFileId: 'result-preview-only',
  });

  const item = await normalizeWorkflowTaskHistoryItem(task);

  assert.equal(item.primaryArtifact?.backendFile?.previewUrl, '/api/v1/files/result-preview-only/preview');
  assert.equal(item.primaryArtifact?.fileInfo?.thumbnailPath, '/api/v1/files/result-preview-only/preview');
});

test('normalizeWorkflowTaskHistoryItem does not persist blob preview urls into backend artifact summary', async () => {
  const task = createTask({
    resultFile: null,
    resultFileId: 'result-runtime-only',
  });

  const item = await normalizeWorkflowTaskHistoryItem(task, {
    events: [],
  });

  assert.equal(item.primaryArtifact?.backendFile, null);
});

test('taskHistoryNormalizer only treats non-ephemeral file info urls as persistent preview sources', () => {
  assert.equal(taskHistoryNormalizerTestOnly.hasPersistentFileInfoPreview(undefined), false);
  assert.equal(taskHistoryNormalizerTestOnly.hasPersistentFileInfoPreview({
    id: 'file-1',
    name: 'file-1.png',
    originalName: 'file-1.png',
    size: 100,
    mimeType: 'image/png',
    format: 'png',
    fileType: 'image',
    status: 'ready',
    hash: 'hash-1',
    path: 'blob:http://localhost/stale',
    thumbnailPath: 'blob:http://localhost/stale-thumb',
    metadata: {},
    source: { type: 'node-output' },
    timestamp: {
      created: Date.now(),
      updated: Date.now(),
    },
  }), false);
  assert.equal(taskHistoryNormalizerTestOnly.hasPersistentFileInfoPreview({
    id: 'file-2',
    name: 'file-2.png',
    originalName: 'file-2.png',
    size: 100,
    mimeType: 'image/png',
    format: 'png',
    fileType: 'image',
    status: 'ready',
    hash: 'hash-2',
    path: '/api/v1/files/file-2/download',
    thumbnailPath: undefined,
    metadata: {},
    source: { type: 'node-output' },
    timestamp: {
      created: Date.now(),
      updated: Date.now(),
    },
  }), true);
});

test('normalizeWorkflowTaskHistoryItem restores persistent preview metadata when only resultFileId is available', async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.toString()
          : String(input);
      assert.equal(url, '/api/v1/files/result-reloaded-only');

      return new Response(JSON.stringify({
        code: 200,
        message: 'ok',
        data: {
          fileId: 'result-reloaded-only',
          originalName: 'result-reloaded-only.png',
          displayName: 'result-reloaded-only.png',
          mimeType: 'image/png',
          fileType: 'image',
          sourceType: 'output',
          sha256: 'sha-result-reloaded-only',
          size: 2048,
          extension: 'png',
          width: 1536,
          height: 1024,
          duration: null,
          status: 'ready',
          createdAt: '2026-05-07T10:00:00.000Z',
          downloadUrl: '/api/v1/files/result-reloaded-only/download',
          thumbnailUrl: '/api/v1/files/result-reloaded-only/thumbnail',
          previewUrl: '/api/v1/files/result-reloaded-only/preview',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  try {
    const task = createTask({
      resultFile: null,
      resultFileId: 'result-reloaded-only',
      referenceFileIds: [],
      input: {
        prompt: 'generate a room',
        referenceFileIds: [],
        imageSize: '2K',
        aspectRatio: '4:5',
      },
    });

    const item = await normalizeWorkflowTaskHistoryItem(task);

    assert.equal(item.primaryArtifact?.fileId, 'result-reloaded-only');
    assert.equal(item.primaryArtifact?.backendFile?.thumbnailUrl, '/api/v1/files/result-reloaded-only/thumbnail');
    assert.equal(item.primaryArtifact?.fileInfo?.thumbnailPath, '/api/v1/files/result-reloaded-only/thumbnail');
    assert.equal(item.primaryArtifact?.fileInfo?.path, '/api/v1/files/result-reloaded-only/download');
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('normalizeWorkflowTaskHistoryList sorts tasks by createdAt descending', async () => {
  const olderTask = createTask({
    taskId: 'task-older',
    taskNo: 'TASK-OLDER',
    createdAt: '2026-05-07T09:00:00.000Z',
    resultFileId: 'result-older',
    resultFile: createBackendFile('result-older'),
  });
  const newerTask = createTask({
    taskId: 'task-newer',
    taskNo: 'TASK-NEWER',
    createdAt: '2026-05-07T11:00:00.000Z',
    resultFileId: 'result-newer',
    resultFile: createBackendFile('result-newer'),
  });

  const items = await normalizeWorkflowTaskHistoryList([olderTask, newerTask]);

  assert.deepEqual(items.map((item) => item.taskId), ['task-newer', 'task-older']);
});

test('normalizeWorkflowTaskHistoryDetail merges explicit events and run detail bundle', async () => {
  const detailTask: WorkflowTaskHistoryDetailResponse = {
    ...createTask(),
    recentEvents: [createEvent('recent-1')],
  };
  const events = [
    createEvent('timeline-1', {
      timestamp: '2026-05-07T10:00:03.000Z',
      message: 'started',
    }),
    createEvent('timeline-2', {
      timestamp: '2026-05-07T10:00:09.000Z',
      eventType: 'task_completed',
      status: 'completed',
      progress: 100,
      message: 'completed',
    }),
  ];

  const runDetail = {
    runId: 'run-1',
    runNo: 'RUN-1',
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    nodeType: 'aiImageGen',
    status: 'completed' as const,
    totalTaskCount: 1,
    completedTaskCount: 1,
    failedTaskCount: 0,
    progress: 100,
    message: 'done',
    createdAt: Date.parse('2026-05-07T10:00:00.000Z'),
    startedAt: Date.parse('2026-05-07T10:00:02.000Z'),
    completedAt: Date.parse('2026-05-07T10:00:08.000Z'),
    isTerminal: true,
    hasCommittableOutput: true,
    allOutputsCommitted: true,
    tasks: [],
  };

  const detail = await normalizeWorkflowTaskHistoryDetail(detailTask, {
    events,
    runDetail,
    relatedTasks: [createRelatedTaskRef()],
  });

  assert.equal(detail.events.length, 2);
  assert.equal(detail.eventCount, 2);
  assert.equal(detail.runDetail?.runId, 'run-1');
  assert.equal(detail.message, 'completed');
  assert.equal(detail.primaryArtifact?.fileId, 'result-1');
  assert.equal(detail.inputFileSummaries?.length, 8);
  assert.equal(detail.inputFileSummaries?.[0]?.label, '输入图');
  assert.equal(detail.inputFileSummaries?.[0]?.fileName, 'input-1.png');
  assert.equal(detail.inputFileSummaries?.[0]?.fileType, 'image');
});

test('normalizeWorkflowTaskHistoryItem uses failed and cancelled fallback messages correctly', async () => {
  const failed = await normalizeWorkflowTaskHistoryItem(createTask({
    taskId: 'task-failed',
    status: 'failed',
    lastErrorCode: 'PROVIDER_ERROR',
    lastErrorMessage: 'provider failed',
    resultFileId: null,
    resultFile: null,
  }), {
    events: [createEvent('failed-1', {
      status: 'failed',
      message: 'event failure',
      timestamp: '2026-05-07T10:00:10.000Z',
    })],
  });

  const cancelled = await normalizeWorkflowTaskHistoryItem(createTask({
    taskId: 'task-cancelled',
    status: 'cancelled',
    resultFileId: null,
    resultFile: null,
  }), {
    events: [createEvent('cancelled-1', {
      status: 'cancelled',
      phase: 'cancelled',
      message: 'cancelled by user',
      timestamp: '2026-05-07T10:00:11.000Z',
    })],
  });

  assert.equal(failed.isFailed, true);
  assert.equal(failed.message, 'provider failed');
  assert.equal(cancelled.isCancelled, true);
  assert.equal(cancelled.message, 'cancelled by user');
});
