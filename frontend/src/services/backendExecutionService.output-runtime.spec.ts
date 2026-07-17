import test from 'node:test';
import assert from 'node:assert/strict';

import type { ExecutionRuntimeBackendRunDetail } from '@/execution-runtime/execution-runtime.types';
import {
  __testOnly,
  clearBackendExecutionCache,
  getLatestWorkflowNodeCompletedRun,
} from './backendExecutionService';
import {
  clearExecutionOutputRuntimeResources,
  getExecutionOutputRuntimeStatus,
} from './execution-output-runtime-sync';
import { clearProtectedResourceCache } from './protected-resource';

function createRunDetail(
  taskStatus: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled',
  fileId: string,
): ExecutionRuntimeBackendRunDetail {
  return {
    runId: `run-${fileId}`,
    runNo: `RUN-${fileId}`,
    userId: null,
    workflowId: 'workflow-runtime-output',
    projectId: null,
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: 'node-runtime-output',
    nodeTitle: 'runtime output',
    provider: null,
    status: taskStatus === 'completed' ? 'completed' : 'processing',
    totalTaskCount: 1,
    completedTaskCount: taskStatus === 'completed' ? 1 : 0,
    failedTaskCount: taskStatus === 'failed' ? 1 : 0,
    createdAt: new Date('2026-04-16T00:00:00.000Z').toISOString(),
    startedAt: new Date('2026-04-16T00:00:01.000Z').toISOString(),
    completedAt: taskStatus === 'completed'
      ? new Date('2026-04-16T00:00:05.000Z').toISOString()
      : null,
    tasks: [
      {
        taskId: `task-${fileId}`,
        taskNo: `TASK-${fileId}`,
        runId: `run-${fileId}`,
        projectId: null,
        groupId: 'group-1',
        groupOrder: 0,
        provider: null,
        model: null,
        status: taskStatus,
        currentStep: 'final',
        currentAttemptNo: 1,
        retryCount: 0,
        maxRetries: 2,
        maxAttempts: 3,
        lastErrorCode: null,
        lastErrorMessage: null,
        resultFileId: fileId,
        createdAt: new Date('2026-04-16T00:00:00.000Z').toISOString(),
        startedAt: new Date('2026-04-16T00:00:01.000Z').toISOString(),
        completedAt: taskStatus === 'completed'
          ? new Date('2026-04-16T00:00:05.000Z').toISOString()
          : null,
        inputFileId: null,
        sourceFileId: null,
        maskFileId: null,
        maskMode: null,
        workflowId: 'workflow-runtime-output',
        workflowTemplateKey: null,
        providerTaskId: null,
        providerClientId: null,
        prompt: 'generate',
        referenceFileIds: null,
        stylePreset: null,
        imageSize: null,
        aspectRatio: null,
        whiteModelFileId: null,
        styleReferenceFileId: null,
        inputFile: null,
        sourceFile: null,
        maskFile: null,
        whiteModelFile: null,
        styleReferenceFile: null,
        resultFile: {
          fileId,
          originalName: `${fileId}.png`,
          displayName: `${fileId}.png`,
          mimeType: 'image/png',
          fileType: 'image',
          sourceType: 'output',
          sha256: `hash-${fileId}`,
          size: 4,
          extension: 'png',
          width: 1024,
          height: 768,
          status: 'ready',
          createdAt: new Date('2026-04-16T00:00:05.000Z').toISOString(),
          downloadUrl: `/api/v1/files/${fileId}/download`,
        },
      },
    ],
  };
}

function resetState(): void {
  clearBackendExecutionCache();
  clearExecutionOutputRuntimeResources();
  clearProtectedResourceCache();
}

async function waitForExecutionOutputRuntimeStatus(
  fileId: string,
  expectedStatus: ReturnType<typeof getExecutionOutputRuntimeStatus>,
  attempts = 20,
): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (getExecutionOutputRuntimeStatus(fileId) === expectedStatus) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.equal(getExecutionOutputRuntimeStatus(fileId), expectedStatus);
}

test('backendExecutionService schedules runtime output sync when a completed task has resultFileInfo', async () => {
  resetState();
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const fetchCalls: string[] = [];

  URL.createObjectURL = () => 'blob:completed-output';
  URL.revokeObjectURL = () => undefined;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/tasks/task-completed-output/events') {
        return new Response(JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            items: [],
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/v1/files/completed-output/download') {
        return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const snapshot = await __testOnly.toRunSnapshot(
      createRunDetail('completed', 'completed-output') as unknown as Parameters<typeof __testOnly.toRunSnapshot>[0],
    );

    assert.equal(snapshot.tasks[0]?.resultFileInfo?.id, 'completed-output');
    assert.ok(
      getExecutionOutputRuntimeStatus('completed-output') === 'syncing'
      || getExecutionOutputRuntimeStatus('completed-output') === 'ready',
    );

    await waitForExecutionOutputRuntimeStatus('completed-output', 'ready');
    assert.deepEqual(fetchCalls, [
      '/api/v1/tasks/task-completed-output/events',
      '/api/v1/files/completed-output/download',
    ]);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    resetState();
  }
});

test('backendExecutionService does not schedule runtime output sync before task completion', async () => {
  resetState();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/tasks/task-processing-output/events') {
        return new Response(JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            items: [],
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const snapshot = await __testOnly.toRunSnapshot(
      createRunDetail('processing', 'processing-output') as unknown as Parameters<typeof __testOnly.toRunSnapshot>[0],
    );

    assert.equal(snapshot.tasks[0]?.status, 'processing');
    assert.equal(getExecutionOutputRuntimeStatus('processing-output'), 'idle');
    assert.deepEqual(fetchCalls, [
      '/api/v1/tasks/task-processing-output/events',
    ]);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    resetState();
  }
});

test('backendExecutionService treats missing reconcile run as null', async () => {
  resetState();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === '/api/v1/workflows/workflow-missing-run/executions/reconcile?nodeId=node-missing-run') {
        return new Response(JSON.stringify({
          code: 40441,
          error: 'RUN_NOT_FOUND',
          message: 'Execution run not found.',
          timestamp: Date.now(),
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    },
  });

  try {
    const snapshot = await getLatestWorkflowNodeCompletedRun(
      'workflow-missing-run',
      'node-missing-run',
    );

    assert.equal(snapshot, null);
    assert.deepEqual(fetchCalls, [
      '/api/v1/workflows/workflow-missing-run/executions/reconcile?nodeId=node-missing-run',
    ]);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    resetState();
  }
});
