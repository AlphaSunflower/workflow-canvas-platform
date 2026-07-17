import type {
  AITask,
  AIStreamChunk,
  CreateAITaskRequest,
  Result,
  Workflow,
  WorkflowManagerGroupSummary,
  WorkflowManagerList,
} from '../../types';
import { httpClient } from '../client/http-client';
import { websocketClient } from '../websocket';
import { createModuleLogger, tryCatchAsync } from '../../utils';
import {
  createBlankWorkflowPayload,
  hydrateWorkflowFromApiDetail,
  normalizeWorkflowForPersistence,
  type CreateBlankWorkflowApiPayload,
  type WorkflowApiDetail,
  type WorkflowApiGroupSummary,
  type WorkflowApiManagedListResponse,
  type WorkflowApiSummary,
} from '@/services/workflow-file-normalizer';

const log = createModuleLogger('workflow-api');

interface DeleteWorkflowResponseData {
  workflowId: string;
  deleted: true;
}

interface DeleteWorkflowGroupResponseData {
  groupId: string;
  movedWorkflowCount: number;
  deleted: true;
}

function parseApiTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toWorkflowManagerItem(item: WorkflowApiSummary): WorkflowManagerList['items'][number] {
  return {
    ...item,
    createdAt: parseApiTimestamp(item.createdAt),
    updatedAt: parseApiTimestamp(item.updatedAt),
    persistenceState: 'persisted',
  };
}

function toWorkflowManagerGroup(
  group: WorkflowApiGroupSummary,
): WorkflowManagerGroupSummary {
  return {
    ...group,
    createdAt: parseApiTimestamp(group.createdAt),
    updatedAt: parseApiTimestamp(group.updatedAt),
  };
}

function hydrateManagedList(data: WorkflowApiManagedListResponse): WorkflowManagerList {
  return {
    items: data.items.map(toWorkflowManagerItem),
    groups: data.groups.map(toWorkflowManagerGroup),
    total: data.total,
  };
}

function hasPersistedWorkflowIdentity(workflow: Workflow): boolean {
  return Boolean(
    workflow.id
    && typeof workflow.version === 'number'
    && workflow.persistenceState === 'persisted',
  );
}

export async function listManagedWorkflows(): Promise<Result<WorkflowManagerList>> {
  log.debug('listManagedWorkflows', 'Getting current account workflow management list');

  const result = await httpClient.get<WorkflowApiManagedListResponse>('/api/v1/workflows/manage');
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: hydrateManagedList(result.data),
  };
}

export async function getWorkflowById(workflowId: string): Promise<Result<Workflow>> {
  log.debug('getWorkflowById', `Getting workflow by id: ${workflowId}`);

  const result = await httpClient.get<WorkflowApiDetail>(`/api/v1/workflows/${workflowId}`);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: hydrateWorkflowFromApiDetail(result.data),
  };
}

export async function createBlankWorkflow(
  request: CreateBlankWorkflowApiPayload,
): Promise<Result<Workflow>> {
  log.info('createBlankWorkflow', 'Creating blank persisted workflow record');
  const result = await httpClient.post<WorkflowApiDetail>(
    '/api/v1/workflows/blank',
    createBlankWorkflowPayload(request),
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: hydrateWorkflowFromApiDetail(result.data),
  };
}

export async function createWorkflow(workflow: Workflow): Promise<Result<Workflow>> {
  log.info('createWorkflow', `Creating workflow: ${workflow.id}`);
  const normalized = await normalizeWorkflowForPersistence(workflow);
  const result = await httpClient.post<WorkflowApiDetail>(
    '/api/v1/workflows',
    normalized.payload,
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: hydrateWorkflowFromApiDetail(result.data),
  };
}

export async function updateWorkflow(workflow: Workflow): Promise<Result<Workflow>> {
  log.info('updateWorkflow', `Updating workflow: ${workflow.id}`);
  const normalized = await normalizeWorkflowForPersistence(workflow);
  const result = await httpClient.put<WorkflowApiDetail>(
    `/api/v1/workflows/${workflow.id}`,
    normalized.payload,
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: hydrateWorkflowFromApiDetail(result.data),
  };
}

export async function saveWorkflow(workflow: Workflow): Promise<Result<Workflow>> {
  log.info('saveWorkflow', `Saving workflow: ${workflow.id}`);
  return hasPersistedWorkflowIdentity(workflow)
    ? updateWorkflow(workflow)
    : createWorkflow(workflow);
}

export async function deleteWorkflow(workflowId: string): Promise<Result<DeleteWorkflowResponseData>> {
  log.info('deleteWorkflow', `Deleting workflow: ${workflowId}`);
  return httpClient.delete<DeleteWorkflowResponseData>(`/api/v1/workflows/${workflowId}`);
}

export async function renameWorkflow(
  workflowId: string,
  name: string,
): Promise<Result<Workflow>> {
  log.info('renameWorkflow', `Renaming workflow: ${workflowId}`);
  const result = await httpClient.patch<WorkflowApiDetail>(
    `/api/v1/workflows/${workflowId}/name`,
    { name },
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: hydrateWorkflowFromApiDetail(result.data),
  };
}

export async function createWorkflowGroup(
  name?: string,
): Promise<Result<WorkflowManagerGroupSummary>> {
  log.info('createWorkflowGroup', `Creating workflow group: ${name ?? '<auto>'}`);
  const result = await httpClient.post<WorkflowApiGroupSummary>(
    '/api/v1/workflows/groups',
    name === undefined ? {} : { name },
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: toWorkflowManagerGroup(result.data),
  };
}

export async function renameWorkflowGroup(
  groupId: string,
  name: string,
): Promise<Result<WorkflowManagerGroupSummary>> {
  log.info('renameWorkflowGroup', `Renaming workflow group: ${groupId}`);
  const result = await httpClient.patch<WorkflowApiGroupSummary>(
    `/api/v1/workflows/groups/${groupId}`,
    { name },
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: toWorkflowManagerGroup(result.data),
  };
}

export async function deleteWorkflowGroup(
  groupId: string,
): Promise<Result<DeleteWorkflowGroupResponseData>> {
  log.info('deleteWorkflowGroup', `Deleting workflow group: ${groupId}`);
  return httpClient.delete<DeleteWorkflowGroupResponseData>(
    `/api/v1/workflows/groups/${groupId}`,
  );
}

export async function moveWorkflowToGroup(
  workflowId: string,
  groupId: string | null,
): Promise<Result<Workflow>> {
  log.info('moveWorkflowToGroup', `Moving workflow ${workflowId} to group ${groupId ?? '<ungrouped>'}`);
  const result = await httpClient.patch<WorkflowApiDetail>(
    `/api/v1/workflows/${workflowId}/group`,
    { groupId },
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: hydrateWorkflowFromApiDetail(result.data),
  };
}

export async function exportWorkflow(workflowId: string): Promise<Result<Blob>> {
  log.info('exportWorkflow', `Exporting workflow: ${workflowId}`);
  return tryCatchAsync(async () => {
    const response = await fetch(`/api/v1/workflows/${workflowId}/export`);
    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }
    return response.blob();
  }, 'workflow-api', 'exportWorkflow');
}

export async function importWorkflow(file: File): Promise<Result<Workflow>> {
  log.info('importWorkflow', `Importing workflow from file: ${file.name}`);
  return httpClient.upload<Workflow>('/api/v1/workflows/import', file);
}

export async function createAITask(
  task: CreateAITaskRequest
): Promise<Result<AITask>> {
  log.info('createAITask', `Creating AI task: ${task.type}`);
  return httpClient.post<AITask>('/api/v1/ai/tasks', task);
}

export async function getAITask(id: string): Promise<Result<AITask>> {
  log.debug('getAITask', `Getting task: ${id}`);
  return httpClient.get<AITask>(`/api/v1/ai/tasks/${id}`);
}

export async function cancelAITask(id: string): Promise<Result<void>> {
  log.info('cancelAITask', `Cancelling task: ${id}`);
  return httpClient.delete<void>(`/api/v1/ai/tasks/${id}`);
}

export function subscribeAITask(
  id: string,
  handler: (chunk: AIStreamChunk) => void
): () => void {
  log.debug('subscribeAITask', `Subscribing to task: ${id}`);

  if (!websocketClient.isConnected()) {
    void websocketClient.connect();
  }

  const unsubscribe = websocketClient.subscribe('ai-stream', (message) => {
    const chunk = message.payload as AIStreamChunk;
    if (chunk.taskId === id) {
      handler(chunk);
    }
  });

  websocketClient.send('subscribe-task', { taskId: id });

  return () => {
    websocketClient.send('unsubscribe-task', { taskId: id });
    unsubscribe();
  };
}

export const workflowApi = {
  listManaged: listManagedWorkflows,
  getById: getWorkflowById,
  createBlank: createBlankWorkflow,
  create: createWorkflow,
  update: updateWorkflow,
  rename: renameWorkflow,
  delete: deleteWorkflow,
  createGroup: createWorkflowGroup,
  renameGroup: renameWorkflowGroup,
  deleteGroup: deleteWorkflowGroup,
  moveToGroup: moveWorkflowToGroup,
  save: saveWorkflow,
  export: exportWorkflow,
  import: importWorkflow,
};

export const aiApi = {
  createTask: createAITask,
  getTask: getAITask,
  cancelTask: cancelAITask,
  subscribeTask: subscribeAITask,
};
