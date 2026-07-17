import { httpClient } from '@/api/client/http-client';
import type { BackendExecutionRunSnapshot } from '@/services/backendExecutionService';
import { getExecutionRun } from '@/services/backendExecutionService';
import type {
  WorkflowTaskHistoryDetailResponse,
  WorkflowTaskHistoryEventsQuery,
  WorkflowTaskHistoryEventsResponse,
  WorkflowTaskHistoryListQuery,
  WorkflowTaskHistoryListResponse,
} from '@/components/canvas/task-history.types';

const DEFAULT_TASK_EVENT_PAGE_SIZE = 200;

function toQueryParams(
  query?: WorkflowTaskHistoryListQuery | WorkflowTaskHistoryEventsQuery,
): Record<string, unknown> | undefined {
  if (!query) {
    return undefined;
  }

  return { ...query };
}

export function buildWorkflowTaskHistoryListCacheKey(
  workflowId: string,
  query?: WorkflowTaskHistoryListQuery,
): string {
  return [
    'workflow-task-history',
    'list',
    workflowId,
    query?.runId ?? '',
    query?.status ?? '',
    query?.nodeId ?? '',
    query?.nodeType ?? '',
    query?.taskType ?? '',
    query?.page ?? '',
    query?.pageSize ?? '',
    query?.sortBy ?? '',
    query?.sortOrder ?? '',
  ].join(':');
}

export function buildWorkflowTaskHistoryDetailCacheKey(workflowId: string, taskId: string): string {
  return ['workflow-task-history', 'detail', workflowId, taskId].join(':');
}

export function buildWorkflowTaskHistoryEventsCacheKey(
  workflowId: string,
  taskId: string,
  query?: WorkflowTaskHistoryEventsQuery,
): string {
  return [
    'workflow-task-history',
    'events',
    workflowId,
    taskId,
    query?.page ?? '',
    query?.pageSize ?? '',
    query?.sortOrder ?? '',
  ].join(':');
}

export function buildExecutionRunCacheKey(runId: string): string {
  return ['workflow-task-history', 'run', runId].join(':');
}

async function listWorkflowTasks(
  workflowId: string,
  query?: WorkflowTaskHistoryListQuery,
  signal?: AbortSignal,
): Promise<WorkflowTaskHistoryListResponse> {
  const result = await httpClient.get<WorkflowTaskHistoryListResponse>(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/tasks`,
    toQueryParams(query),
    {
      signal,
      timeout: 30000,
    },
  );

  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

async function getWorkflowTaskDetail(
  workflowId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<WorkflowTaskHistoryDetailResponse> {
  const result = await httpClient.get<WorkflowTaskHistoryDetailResponse>(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/tasks/${encodeURIComponent(taskId)}`,
    undefined,
    {
      signal,
      timeout: 30000,
    },
  );

  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

async function getWorkflowTaskEvents(
  workflowId: string,
  taskId: string,
  query?: WorkflowTaskHistoryEventsQuery,
  signal?: AbortSignal,
): Promise<WorkflowTaskHistoryEventsResponse> {
  const result = await httpClient.get<WorkflowTaskHistoryEventsResponse>(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/tasks/${encodeURIComponent(taskId)}/events`,
    toQueryParams(query),
    {
      signal,
      timeout: 30000,
    },
  );

  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

async function getWorkflowTaskRunDetail(
  runId: string,
  signal?: AbortSignal,
): Promise<BackendExecutionRunSnapshot> {
  return getExecutionRun(runId, signal);
}

async function getWorkflowTaskEventTimeline(
  workflowId: string,
  taskId: string,
  query?: WorkflowTaskHistoryEventsQuery,
  signal?: AbortSignal,
): Promise<WorkflowTaskHistoryEventsResponse> {
  const pageSize = query?.pageSize ?? DEFAULT_TASK_EVENT_PAGE_SIZE;
  let page = query?.page ?? 1;
  let total = 0;
  const items = [];

  while (true) {
    const response = await getWorkflowTaskEvents(workflowId, taskId, {
      ...query,
      page,
      pageSize,
    }, signal);

    total = response.total;
    items.push(...response.items);

    if (response.items.length === 0 || items.length >= total) {
      break;
    }

    page += 1;
  }

  return {
    messageType: 'task_event',
    items,
    total: total || items.length,
  };
}

interface WorkflowTaskDetailBundleOptions {
  runId?: string;
  signal?: AbortSignal;
  eventsQuery?: WorkflowTaskHistoryEventsQuery;
}

interface WorkflowTaskDetailBundle {
  detail: WorkflowTaskHistoryDetailResponse;
  events: WorkflowTaskHistoryEventsResponse;
  runDetail?: BackendExecutionRunSnapshot;
}

async function getWorkflowTaskDetailBundle(
  workflowId: string,
  taskId: string,
  options: WorkflowTaskDetailBundleOptions = {},
): Promise<WorkflowTaskDetailBundle> {
  const detail = await getWorkflowTaskDetail(workflowId, taskId, options.signal);
  const runId = options.runId ?? detail.runId;

  const [events, runDetail] = await Promise.all([
    getWorkflowTaskEventTimeline(workflowId, taskId, {
      sortOrder: options.eventsQuery?.sortOrder ?? 'asc',
      pageSize: options.eventsQuery?.pageSize ?? DEFAULT_TASK_EVENT_PAGE_SIZE,
    }, options.signal).catch(() => ({
      messageType: 'task_event' as const,
      items: detail.recentEvents ?? [],
      total: detail.recentEvents?.length ?? 0,
    })),
    runId
      ? getWorkflowTaskRunDetail(runId, options.signal).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  return {
    detail,
    events,
    ...(runDetail ? { runDetail } : {}),
  };
}

export const workflowTaskHistoryService = {
  listWorkflowTasks,
  getWorkflowTaskDetail,
  getWorkflowTaskEvents,
  getWorkflowTaskEventTimeline,
  getWorkflowTaskDetailBundle,
  getExecutionRun: getWorkflowTaskRunDetail,
  buildWorkflowTaskHistoryListCacheKey,
  buildWorkflowTaskHistoryDetailCacheKey,
  buildWorkflowTaskHistoryEventsCacheKey,
  buildExecutionRunCacheKey,
};
