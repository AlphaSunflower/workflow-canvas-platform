import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { WorkflowRelatedTaskRef } from '@/types';
import { executionRuntimeStore } from '@/execution-runtime/execution-runtime.store';
import { isEphemeralResourceUrl } from '@/services/protected-resource';
import {
  normalizeWorkflowTaskHistoryList,
} from '@/services/task-history-normalizer';
import { workflowTaskHistoryService } from '@/services/workflow-task-history.service';
import { canvasTaskHistoryStore, createTaskHistorySummaryItem } from './canvas-task-history.store';
import type {
  TaskHistoryDetail,
  TaskHistoryListItem,
  WorkflowTaskHistoryListQuery,
} from './task-history.types';

interface UseWorkflowTaskHistoryInput {
  workflowId: string | null;
  relatedTasks: WorkflowRelatedTaskRef[];
}

interface WorkflowTaskHistoryState {
  items: TaskHistoryListItem[];
  detailsByTaskId: ReadonlyMap<string, TaskHistoryDetail>;
  loading: boolean;
  initialized: boolean;
  refresh: () => Promise<void>;
}

function sanitizeRuntimeFileInfoForHistory<T extends { path: string; thumbnailPath?: string }>(fileInfo: T): T {
  return {
    ...fileInfo,
    path: isEphemeralResourceUrl(fileInfo.path) ? '' : fileInfo.path,
    ...(isEphemeralResourceUrl(fileInfo.thumbnailPath) ? {} : { thumbnailPath: fileInfo.thumbnailPath }),
  };
}

function hasPersistentHistoryPreview(
  preview: TaskHistoryListItem['primaryArtifact'],
): boolean {
  if (!preview) {
    return false;
  }

  return Boolean(
    preview.backendFile?.thumbnailUrl
    || preview.backendFile?.previewUrl
    || preview.backendFile?.downloadUrl
    || (preview.fileInfo?.thumbnailPath && !isEphemeralResourceUrl(preview.fileInfo.thumbnailPath))
    || (preview.fileInfo?.path && !isEphemeralResourceUrl(preview.fileInfo.path)),
  );
}

function sortRelatedTasks(relatedTasks: WorkflowRelatedTaskRef[]): WorkflowRelatedTaskRef[] {
  return [...relatedTasks].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
}

function shouldFetchTaskList(workflowId: string | null, relatedTasks: WorkflowRelatedTaskRef[]): boolean {
  return Boolean(workflowId) && relatedTasks.length > 0;
}

function mergeRuntimePrimaryArtifact(item: TaskHistoryListItem): TaskHistoryListItem['primaryArtifact'] {
  const runtimeTask = executionRuntimeStore.getTask(item.taskId);
  if (!runtimeTask?.resultFileInfo) {
    return item.primaryArtifact;
  }

  if (hasPersistentHistoryPreview(item.primaryArtifact)) {
    return item.primaryArtifact;
  }

  return {
    ...(item.primaryArtifact ?? {}),
    fileId: runtimeTask.resultFileInfo.id,
    fileInfo: sanitizeRuntimeFileInfoForHistory(runtimeTask.resultFileInfo),
    role: item.primaryArtifact?.role ?? 'result',
    label: item.primaryArtifact?.label ?? 'Result',
    order: item.primaryArtifact?.order ?? 0,
    isPrimary: true,
  };
}

function mergeRuntimeArtifactPreviewItems(item: TaskHistoryListItem): TaskHistoryListItem['artifactPreviewItems'] {
  const runtimeTask = executionRuntimeStore.getTask(item.taskId);
  if (!runtimeTask?.resultFileInfo) {
    return item.artifactPreviewItems;
  }

  if (item.artifactPreviewItems.some((artifact) => hasPersistentHistoryPreview(artifact))) {
    return item.artifactPreviewItems;
  }

  return [{
    ...(item.artifactPreviewItems[0] ?? {}),
    fileId: runtimeTask.resultFileInfo.id,
    fileInfo: sanitizeRuntimeFileInfoForHistory(runtimeTask.resultFileInfo),
    role: item.artifactPreviewItems[0]?.role ?? 'result',
    label: item.artifactPreviewItems[0]?.label ?? 'Result',
    order: item.artifactPreviewItems[0]?.order ?? 0,
    isPrimary: true,
  }];
}

function buildRuntimePatchedItem(item: TaskHistoryListItem): TaskHistoryListItem {
  const runtimeTask = executionRuntimeStore.getTask(item.taskId);
  if (!runtimeTask) {
    return item;
  }

  const startedAt = item.startedAt;
  const completedAt = runtimeTask.isTerminal ? (item.completedAt ?? Date.now()) : item.completedAt;

  return {
    ...item,
    status: runtimeTask.status,
    currentStep: runtimeTask.currentStep,
    startedAt,
    completedAt,
    durationMs: runtimeTask.isTerminal && startedAt
      ? Math.max(0, (completedAt ?? Date.now()) - startedAt)
      : item.durationMs,
    message: runtimeTask.message ?? item.message,
    errorCode: runtimeTask.errorCode ?? item.errorCode,
    errorMessage: runtimeTask.error ?? item.errorMessage,
    isTerminal: runtimeTask.isTerminal ?? item.isTerminal,
    isFailed: runtimeTask.status === 'failed',
    isCancelled: runtimeTask.status === 'cancelled',
    isSuccessful: runtimeTask.status === 'completed',
    primaryArtifact: mergeRuntimePrimaryArtifact(item),
    artifactPreviewItems: mergeRuntimeArtifactPreviewItems(item),
  };
}

export function useWorkflowTaskHistory(input: UseWorkflowTaskHistoryInput): WorkflowTaskHistoryState {
  const normalizedRelatedTasks = useMemo(
    () => sortRelatedTasks(input.relatedTasks),
    [input.relatedTasks],
  );
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const taskSubscriptionsRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    if (!input.workflowId) {
      return;
    }

    canvasTaskHistoryStore.upsertSkeleton({
      workflowId: input.workflowId,
      relatedTasks: normalizedRelatedTasks,
    });
  }, [input.workflowId, normalizedRelatedTasks]);

  useEffect(() => {
    if (!shouldFetchTaskList(input.workflowId, normalizedRelatedTasks)) {
      return;
    }

    let cancelled = false;
    const workflowId = input.workflowId as string;

    const runFetch = async (): Promise<void> => {
      canvasTaskHistoryStore.setLoading(workflowId, true);
      try {
        const query: WorkflowTaskHistoryListQuery = {
          page: 1,
          pageSize: Math.max(normalizedRelatedTasks.length, 20),
          sortBy: 'createdAt',
          sortOrder: 'desc',
        };
        const response = await workflowTaskHistoryService.listWorkflowTasks(workflowId, query);
        if (cancelled) {
          return;
        }

        const items = await normalizeWorkflowTaskHistoryList(response.items, {
          relatedTasks: normalizedRelatedTasks,
        });
        if (cancelled) {
          return;
        }

        canvasTaskHistoryStore.replaceItems({
          workflowId,
          items: items.map((item) => createTaskHistorySummaryItem(item)),
        });
      } finally {
        if (!cancelled) {
          canvasTaskHistoryStore.setLoading(workflowId, false);
        }
      }
    };

    refreshRef.current = runFetch;
    void runFetch();

    return () => {
      cancelled = true;
    };
  }, [input.workflowId, normalizedRelatedTasks]);

  const snapshot = useSyncExternalStore(
    canvasTaskHistoryStore.subscribe,
    () => canvasTaskHistoryStore.getSnapshot(input.workflowId),
    () => canvasTaskHistoryStore.getSnapshot(input.workflowId),
  );

  const taskIds = useMemo(
    () => snapshot.items.map((item) => item.taskId),
    [snapshot.items],
  );

  useEffect(() => {
    return () => {
      taskSubscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
      taskSubscriptionsRef.current.clear();
    };
  }, [input.workflowId]);

  useEffect(() => {
    if (!input.workflowId) {
      return;
    }

    const workflowId = input.workflowId;

    const nextTaskIdSet = new Set(taskIds);
    taskSubscriptionsRef.current.forEach((unsubscribe, taskId) => {
      if (!nextTaskIdSet.has(taskId)) {
        unsubscribe();
        taskSubscriptionsRef.current.delete(taskId);
      }
    });

    taskIds.forEach((taskId) => {
      if (taskSubscriptionsRef.current.has(taskId)) {
        return;
      }

      const unsubscribe = executionRuntimeStore.subscribeTask(taskId, () => {
        canvasTaskHistoryStore.patchItem({
          workflowId,
          taskId,
          updater: buildRuntimePatchedItem,
        });
      });
      taskSubscriptionsRef.current.set(taskId, unsubscribe);

      canvasTaskHistoryStore.patchItem({
        workflowId,
        taskId,
        updater: buildRuntimePatchedItem,
      });
    });
  }, [input.workflowId, taskIds]);

  const refresh = async (): Promise<void> => {
    await refreshRef.current();
  };

  return {
    items: snapshot.items,
    detailsByTaskId: snapshot.detailsByTaskId,
    loading: snapshot.loading,
    initialized: snapshot.initialized,
    refresh,
  };
}
