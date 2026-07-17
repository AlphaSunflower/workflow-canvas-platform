import test from 'node:test';
import assert from 'node:assert/strict';

import { httpClient } from '@/api/client/http-client';
import type {
  WorkflowTaskHistoryDetailResponse,
  WorkflowTaskHistoryEventsResponse,
  WorkflowTaskHistoryListResponse,
} from '@/components/canvas/task-history.types';
import { workflowTaskHistoryService } from './workflow-task-history.service';

function createListResponse(): WorkflowTaskHistoryListResponse {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  };
}

function createDetailResponse(): WorkflowTaskHistoryDetailResponse {
  return {
    sequence: 1,
    taskId: 'task-1',
    taskNo: 'TASK-1',
    runId: 'run-1',
    runNo: 'RUN-1',
    workflowId: 'workflow-1',
    projectId: 'project-1',
    nodeId: 'node-1',
    nodeTitle: 'Task 1',
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
    resultFileId: null,
    createdAt: '2026-05-07T10:00:00.000Z',
    startedAt: '2026-05-07T10:00:01.000Z',
    completedAt: '2026-05-07T10:00:05.000Z',
    durationMs: 4000,
    input: { prompt: 'hello' },
    inputFileId: null,
    sourceFileId: null,
    maskFileId: null,
    maskMode: null,
    renderFileId: null,
    referenceFileId: null,
    workflowTemplateKey: null,
    providerTaskId: null,
    providerClientId: null,
    prompt: 'hello',
    referenceFileIds: null,
    stylePreset: null,
    imageSize: '1K',
    aspectRatio: '1:1',
    whiteModelFileId: null,
    styleReferenceFileId: null,
    inputFile: null,
    sourceFile: null,
    maskFile: null,
    renderFile: null,
    referenceFile: null,
    whiteModelFile: null,
    styleReferenceFile: null,
    resultFile: null,
    recentEvents: [],
  };
}

function createEventsResponse(
  items: WorkflowTaskHistoryEventsResponse['items'],
  total = items.length,
): WorkflowTaskHistoryEventsResponse {
  return {
    messageType: 'task_event',
    items,
    total,
  };
}

test('workflowTaskHistoryService builds stable cache keys', () => {
  assert.equal(
    workflowTaskHistoryService.buildWorkflowTaskHistoryListCacheKey('workflow-1', {
      runId: 'run-1',
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }),
    'workflow-task-history:list:workflow-1:run-1:::::1:20:createdAt:desc',
  );
  assert.equal(
    workflowTaskHistoryService.buildWorkflowTaskHistoryDetailCacheKey('workflow-1', 'task-1'),
    'workflow-task-history:detail:workflow-1:task-1',
  );
  assert.equal(
    workflowTaskHistoryService.buildWorkflowTaskHistoryEventsCacheKey('workflow-1', 'task-1', {
      page: 2,
      pageSize: 50,
      sortOrder: 'asc',
    }),
    'workflow-task-history:events:workflow-1:task-1:2:50:asc',
  );
  assert.equal(
    workflowTaskHistoryService.buildExecutionRunCacheKey('run-1'),
    'workflow-task-history:run:run-1',
  );
});

test('workflowTaskHistoryService forwards list/detail/events requests to correct endpoints', async () => {
  const originalGet = httpClient.get.bind(httpClient);
  const calls: Array<{ path: string; params?: Record<string, unknown>; timeout?: number; }> = [];

  httpClient.get = (async (path, params, config) => {
    calls.push({ path, params, timeout: config?.timeout });

    if (path === '/api/v1/workflows/workflow-1/tasks') {
      return {
        success: true,
        data: createListResponse(),
      };
    }

    if (path === '/api/v1/workflows/workflow-1/tasks/task-1') {
      return {
        success: true,
        data: createDetailResponse(),
      };
    }

    if (path === '/api/v1/workflows/workflow-1/tasks/task-1/events') {
      return {
        success: true,
        data: createEventsResponse([]),
      };
    }

    throw new Error(`unexpected path: ${path}`);
  }) as typeof httpClient.get;

  try {
    await workflowTaskHistoryService.listWorkflowTasks('workflow-1', {
      page: 2,
      pageSize: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    await workflowTaskHistoryService.getWorkflowTaskDetail('workflow-1', 'task-1');
    await workflowTaskHistoryService.getWorkflowTaskEvents('workflow-1', 'task-1', {
      page: 3,
      pageSize: 5,
      sortOrder: 'asc',
    });

    assert.deepEqual(calls, [
      {
        path: '/api/v1/workflows/workflow-1/tasks',
        params: { page: 2, pageSize: 10, sortBy: 'createdAt', sortOrder: 'desc' },
        timeout: 30000,
      },
      {
        path: '/api/v1/workflows/workflow-1/tasks/task-1',
        params: undefined,
        timeout: 30000,
      },
      {
        path: '/api/v1/workflows/workflow-1/tasks/task-1/events',
        params: { page: 3, pageSize: 5, sortOrder: 'asc' },
        timeout: 30000,
      },
    ]);
  } finally {
    httpClient.get = originalGet;
  }
});

test('workflowTaskHistoryService paginates full event timeline until total is exhausted', async () => {
  const originalGet = httpClient.get.bind(httpClient);
  const seenPages: number[] = [];

  httpClient.get = (async (path, params) => {
    assert.equal(path, '/api/v1/workflows/workflow-1/tasks/task-1/events');
    const page = Number(params?.page ?? 1);
    seenPages.push(page);

    if (page === 1) {
      return {
        success: true,
        data: createEventsResponse([
          {
            eventId: 'event-1',
            eventType: 'task_progress',
            runId: 'run-1',
            taskId: 'task-1',
            attemptNo: 1,
            status: 'processing',
            phase: 'processing',
            stepType: 'final',
            progress: 10,
            message: 'page-1',
            payload: null,
            timestamp: '2026-05-07T10:00:01.000Z',
          },
        ], 2),
      };
    }

    return {
      success: true,
      data: createEventsResponse([
        {
          eventId: 'event-2',
          eventType: 'task_completed',
          runId: 'run-1',
          taskId: 'task-1',
          attemptNo: 1,
          status: 'completed',
          phase: 'completed',
          stepType: 'final',
          progress: 100,
          message: 'page-2',
          payload: null,
          timestamp: '2026-05-07T10:00:02.000Z',
        },
      ], 2),
    };
  }) as typeof httpClient.get;

  try {
    const response = await workflowTaskHistoryService.getWorkflowTaskEventTimeline('workflow-1', 'task-1', {
      pageSize: 1,
      sortOrder: 'asc',
    });

    assert.deepEqual(seenPages, [1, 2]);
    assert.equal(response.total, 2);
    assert.deepEqual(response.items.map((event) => event.eventId), ['event-1', 'event-2']);
  } finally {
    httpClient.get = originalGet;
  }
});

test('workflowTaskHistoryService detail bundle falls back to recentEvents when timeline query fails and run detail fails softly', async () => {
  const originalGet = httpClient.get.bind(httpClient);

  httpClient.get = (async (path) => {
    if (path === '/api/v1/workflows/workflow-1/tasks/task-1') {
      return {
        success: true,
        data: {
          ...createDetailResponse(),
          recentEvents: [{
            eventId: 'event-fallback',
            eventType: 'task_progress',
            runId: 'run-1',
            taskId: 'task-1',
            attemptNo: 1,
            status: 'processing',
            phase: 'processing',
            stepType: 'final',
            progress: 20,
            message: 'fallback-event',
            payload: null,
            timestamp: '2026-05-07T10:00:03.000Z',
          }],
        },
      };
    }

    if (path === '/api/v1/workflows/workflow-1/tasks/task-1/events') {
      throw new Error('events failed');
    }

    if (path === '/api/v1/executions/run-1') {
      throw new Error('run detail failed');
    }

    throw new Error(`unexpected path: ${path}`);
  }) as typeof httpClient.get;

  try {
    const bundle = await workflowTaskHistoryService.getWorkflowTaskDetailBundle('workflow-1', 'task-1', {
      runId: 'run-1',
    });

    assert.equal(bundle.detail.taskId, 'task-1');
    assert.equal(bundle.events.total, 1);
    assert.equal(bundle.events.items[0]?.eventId, 'event-fallback');
    assert.equal('runDetail' in bundle, false);
  } finally {
    httpClient.get = originalGet;
  }
});

test('workflowTaskHistoryService detail bundle can use detail.runId when options.runId is omitted', async () => {
  const originalGet = httpClient.get.bind(httpClient);
  const calledPaths: string[] = [];

  httpClient.get = (async (path) => {
    calledPaths.push(path);

    if (path === '/api/v1/workflows/workflow-1/tasks/task-1') {
      return {
        success: true,
        data: createDetailResponse(),
      };
    }

    if (path === '/api/v1/workflows/workflow-1/tasks/task-1/events') {
      return {
        success: true,
        data: createEventsResponse([]),
      };
    }

    if (path === '/api/v1/executions/run-1') {
      return {
        success: true,
        data: {
          runId: 'run-1',
          runNo: 'RUN-1',
          workflowId: 'workflow-1',
          nodeId: 'node-1',
          nodeType: 'aiImageGen',
          status: 'completed',
          totalTaskCount: 1,
          completedTaskCount: 1,
          failedTaskCount: 0,
          progress: 100,
          message: 'done',
          createdAt: Date.parse('2026-05-07T10:00:00.000Z'),
          startedAt: Date.parse('2026-05-07T10:00:01.000Z'),
          completedAt: Date.parse('2026-05-07T10:00:05.000Z'),
          isTerminal: true,
          hasCommittableOutput: true,
          allOutputsCommitted: true,
          tasks: [],
        },
      };
    }

    throw new Error(`unexpected path: ${path}`);
  }) as typeof httpClient.get;

  try {
    const bundle = await workflowTaskHistoryService.getWorkflowTaskDetailBundle('workflow-1', 'task-1');

    assert.equal(bundle.runDetail?.runId, 'run-1');
    assert.equal(calledPaths.includes('/api/v1/executions/run-1'), true);
  } finally {
    httpClient.get = originalGet;
  }
});
