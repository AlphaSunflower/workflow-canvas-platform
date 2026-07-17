import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAIFloorplanColorizeBackendGroupPayload } from '@/nodes/ai-floorplan-colorize/runtime';
import { __testOnly } from '@/services/backendExecutionService';
import { clearExecutionOutputRuntimeResources } from '@/services/execution-output-runtime-sync';
import { clearProtectedResourceCache } from '@/services/protected-resource';
import type { ExecutionRuntimeBackendRunDetail } from '@/execution-runtime/execution-runtime.types';

test('WorkflowContext 会为平面图转彩平 group 透传规范化后的 stylePreset', () => {
  const payload = buildAIFloorplanColorizeBackendGroupPayload({
    groupId: 'group-1',
    sourceFileId: 'file-source-1',
    config: {
      stylePreset: 'warm',
      imageSize: '2K',
      aspectRatio: '4:3',
    },
  });

  assert.deepEqual(payload, {
    groupId: 'group-1',
    sourceFileId: 'file-source-1',
    model: 'gpt-image-2',
    stylePreset: 'three-d-render',
  });
});

test('backendExecutionService 在 resultFile 未 hydrate 时会根据 resultFileId 补查视频文件信息', async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/tasks/task-video-1/events') {
        return new Response(JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            items: [],
          },
          timestamp: Date.now(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/v1/files/video-file-1') {
        return new Response(JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            fileId: 'video-file-1',
            userId: null,
            blobId: 'blob-video-1',
            originalName: 'video-output.mp4',
            displayName: 'video-output.mp4',
            mimeType: 'video/mp4',
            fileType: 'video',
            sourceType: 'output',
            sha256: 'hash-video-1',
            size: 2048,
            extension: 'mp4',
            width: null,
            height: null,
            duration: 8,
            status: 'ready',
            createdAt: new Date('2026-04-14T00:48:22.546Z').toISOString(),
            downloadUrl: '/api/v1/files/video-file-1/download',
          },
          timestamp: Date.now(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/v1/files/video-file-1/download') {
        return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const snapshot = await __testOnly.toRunSnapshot({
      runId: 'run-video-1',
      runNo: 'RUN-video-1',
      workflowId: 'workflow-video-1',
      nodeId: 'node-video-1',
      nodeType: 'aiVideoGen',
      status: 'completed',
      totalTaskCount: 1,
      completedTaskCount: 1,
      failedTaskCount: 0,
      createdAt: new Date('2026-04-14T00:46:12.204Z').toISOString(),
      startedAt: new Date('2026-04-14T00:46:16.449Z').toISOString(),
      completedAt: new Date('2026-04-14T00:48:22.546Z').toISOString(),
      tasks: [
        {
          taskId: 'task-video-1',
          taskNo: 'TASK-video-1',
          groupId: 'group-1',
          groupOrder: 1,
          status: 'completed',
          currentStep: 'final',
          currentAttemptNo: 1,
          retryCount: 0,
          maxRetries: 2,
          maxAttempts: 3,
          lastErrorCode: null,
          lastErrorMessage: null,
          resultFileId: 'video-file-1',
          resultFile: null,
          inputFileId: null,
          sourceFileId: null,
          workflowId: 'workflow-video-1',
          workflowTemplateKey: null,
          providerTaskId: 'provider-video-1',
          providerClientId: 'provider-client-1',
          prompt: 'generate video',
          referenceFileIds: ['image-a', 'image-b'],
          stylePreset: null,
          imageSize: null,
          aspectRatio: null,
          inputFile: null,
        },
      ],
    } as unknown as ExecutionRuntimeBackendRunDetail);

    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.tasks[0]?.resultFileId, 'video-file-1');
    assert.equal(snapshot.tasks[0]?.resultFileInfo?.fileType, 'video');
    assert.equal(snapshot.tasks[0]?.resultFileInfo?.format, 'mp4');
    assert.equal(snapshot.tasks[0]?.resultFileInfo?.path, '/api/v1/files/video-file-1/download');
    assert.deepEqual(fetchCalls, [
      '/api/v1/tasks/task-video-1/events',
      '/api/v1/files/video-file-1',
      '/api/v1/files/video-file-1/download',
    ]);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    clearExecutionOutputRuntimeResources();
    clearProtectedResourceCache();
  }
});

test('backendExecutionService 创建请求会保留每个 group 的 stylePreset', () => {
  const requestBody = __testOnly.toExecutionRequestBody({
    workflowId: 'workflow-floorplan-colorize',
    nodeType: 'aiFloorplanColorize',
    taskType: 'floorplan-colorize',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-floorplan-colorize',
    model: ' gemini-3-pro-image-preview ',
    nodeTitle: '平面图转彩平',
    groups: [
      {
        groupId: 'group-1',
        sourceFileId: 'file-source-1',
        stylePreset: 'photoreal-render',
        imageSize: ' 2K ',
        aspectRatio: ' auto ',
      },
      {
        groupId: 'group-2',
        sourceFileId: 'file-source-2',
      },
    ],
  });

  assert.equal(
    requestBody.nodeType === 'aiFloorplanColorize' ? requestBody.model : null,
    'gemini-3-pro-image-preview',
  );
  const requestBodyWithoutModel = requestBody.nodeType === 'aiFloorplanColorize'
    ? {
      workflowId: requestBody.workflowId,
      nodeType: requestBody.nodeType,
      taskType: requestBody.taskType,
      executionMode: requestBody.executionMode,
      nodeId: requestBody.nodeId,
      nodeTitle: requestBody.nodeTitle,
      groups: requestBody.groups,
    }
    : requestBody;
  assert.deepEqual(requestBodyWithoutModel, {
    workflowId: 'workflow-floorplan-colorize',
    nodeType: 'aiFloorplanColorize',
    taskType: 'floorplan-colorize',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-floorplan-colorize',
    nodeTitle: '平面图转彩平',
    groups: [
      {
        groupId: 'group-1',
        sourceFileId: 'file-source-1',
        stylePreset: 'photoreal-render',
        imageSize: '2K',
        aspectRatio: 'auto',
      },
      {
        groupId: 'group-2',
        sourceFileId: 'file-source-2',
      },
    ],
  });
});

test('backendExecutionService 运行态快照会回显 stylePreset', async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/tasks/task-1/events') {
        return new Response(JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            items: [],
          },
          timestamp: Date.now(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const snapshot = await __testOnly.toRunSnapshot({
      runId: 'run-1',
      runNo: 'RUN-1',
      workflowId: null,
      nodeId: 'node-1',
      nodeType: 'aiFloorplanColorize',
      status: 'processing',
      totalTaskCount: 1,
      completedTaskCount: 0,
      failedTaskCount: 0,
      createdAt: new Date('2026-04-07T00:00:00.000Z').toISOString(),
      startedAt: null,
      completedAt: null,
      tasks: [
        {
          taskId: 'task-1',
          taskNo: 'TASK-1',
          groupId: 'group-1',
          groupOrder: 1,
          status: 'processing',
          currentStep: 'final',
          currentAttemptNo: 1,
          retryCount: 0,
          maxRetries: 2,
          maxAttempts: 3,
          lastErrorCode: null,
          lastErrorMessage: null,
          resultFileId: null,
          resultFile: null,
          resultStorageKey: null,
          inputFileId: 'file-source-1',
          sourceFileId: 'file-source-1',
          workflowId: null,
          workflowTemplateKey: null,
          providerTaskId: null,
          providerClientId: null,
          prompt: null,
          referenceFileIds: null,
          stylePreset: 'photoreal-render',
          imageSize: '2K',
          aspectRatio: '4:3',
          inputFile: null,
        },
      ],
    } as unknown as ExecutionRuntimeBackendRunDetail);

    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.tasks[0]?.stylePreset, 'photoreal-render');
    assert.equal(snapshot.tasks[0]?.imageSize, '2K');
    assert.equal(snapshot.tasks[0]?.aspectRatio, '4:3');
    assert.deepEqual(fetchCalls, ['/api/v1/tasks/task-1/events']);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});
