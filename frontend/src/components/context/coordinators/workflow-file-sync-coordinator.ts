import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { MutableRefObject } from 'react';
import { backendFileService } from '@/services/backendFileService';
import { workflowUploadScheduler } from '@/services/workflow-upload-scheduler';
import type { FileNodeData, Workflow, WorkflowSaveOptions } from '@/types';
import { isFileNodeData } from '@/utils';
import {
  requestWorkflowAutoSave,
  shouldAutoSaveAfterExecutionIdle,
  shouldRunFallbackAutoSave,
} from '../workflow-auto-save';

interface WorkflowFileSyncCoordinatorDependencies {
  workflow: {
    workflow: Workflow | null;
    nodes: Workflow['nodes'][string][];
    isDirty: boolean;
    isSaving: boolean;
    lastSaveError: string | null;
    autoSaveConfig: {
      enabled: boolean;
      idleSaveEnabled: boolean;
      fallbackIntervalMs: number;
    };
  };
  workflowRef: MutableRefObject<Workflow | null>;
  hasActiveExecution: boolean;
  saveWorkflow: (options?: WorkflowSaveOptions) => Promise<void>;
  showError: (title: string, message: string) => void;
}

export interface WorkflowFileSyncCoordinator {
  workflowFileSyncBlockReason: string | null;
}

function getWorkflowSyncBlockReason(
  snapshots: ReturnType<typeof workflowUploadScheduler.getSnapshot>,
): string | null {
  if (snapshots.some((snapshot) => snapshot.status === 'failed')) {
    return '存在文件同步失败，请先重试失败文件后再保存';
  }

  if (snapshots.some((snapshot) => snapshot.status !== 'ready')) {
    return '存在文件尚未同步完成，请等待上传结束后再保存';
  }

  return null;
}

function createFileNodeSyncSignature(node: FileNodeData): string {
  const localSource = node.source.type === 'imported' ? node.source.localSource : undefined;
  return [
    node.id.value,
    node.fileId,
    node.backendFileId ?? '',
    node.status,
    node.source.type,
    node.source.type === 'imported' ? node.source.importMethod : '',
    localSource?.status ?? '',
    localSource?.referenceId ?? '',
    localSource?.permissionState ?? '',
  ].join('|');
}

export function useWorkflowFileSyncCoordinator(
  dependencies: WorkflowFileSyncCoordinatorDependencies,
): WorkflowFileSyncCoordinator {
  const {
    workflow,
    workflowRef,
    hasActiveExecution,
    saveWorkflow,
    showError,
  } = dependencies;

  const autoSaveFallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousHasActiveExecutionRef = useRef(false);
  const lastAutoSaveErrorMessageRef = useRef<string | null>(null);
  const autoSaveDirtyRef = useRef(false);
  const autoSaveSavingRef = useRef(false);
  const autoSaveFileSyncBlockReasonRef = useRef<string | null>(null);
  const fileNodeSyncSignaturesRef = useRef<Map<string, string>>(new Map());
  const runtimeSourceSyncSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const nextSignatures = new Map<string, string>();
    workflow.nodes.forEach((node) => {
      if (!isFileNodeData(node)) {
        return;
      }

      const signature = createFileNodeSyncSignature(node);
      nextSignatures.set(node.id.value, signature);
      if (fileNodeSyncSignaturesRef.current.get(node.id.value) === signature) {
        return;
      }

      workflowUploadScheduler.enqueueNode(node, {
        workflowId: workflow.workflow?.id ?? null,
      });
    });
    fileNodeSyncSignaturesRef.current = nextSignatures;
  }, [workflow.nodes, workflow.workflow?.id]);

  useEffect(() => {
    const fileNodes = workflow.nodes.filter((node): node is FileNodeData => isFileNodeData(node));
    const signature = fileNodes
      .map(createFileNodeSyncSignature)
      .sort()
      .join('\n');
    const scopedSignature = `${workflow.workflow?.id ?? ''}\n${signature}`;
    if (runtimeSourceSyncSignatureRef.current === scopedSignature) {
      return;
    }

    runtimeSourceSyncSignatureRef.current = scopedSignature;
    backendFileService.syncRuntimeNodeFileSources(fileNodes, {
      workflowId: workflow.workflow?.id ?? null,
    });
  }, [workflow.nodes, workflow.workflow?.id]);

  const workflowFileSyncSnapshots = useSyncExternalStore(
    (listener): (() => void) => workflowUploadScheduler.subscribe(listener),
    (): ReturnType<typeof workflowUploadScheduler.getSnapshot> => (
      workflowUploadScheduler.getSnapshot(undefined, workflow.workflow?.id ?? null)
    ),
    (): ReturnType<typeof workflowUploadScheduler.getSnapshot> => (
      workflowUploadScheduler.getSnapshot(undefined, workflow.workflow?.id ?? null)
    ),
  );

  const workflowFileSyncBlockReason = useMemo(() => {
    const activeWorkflow = workflow.workflow;
    if (!activeWorkflow) {
      return null;
    }

    const fileNodeIds = new Set(
      Object.values(activeWorkflow.nodes)
        .filter((node): node is FileNodeData => isFileNodeData(node))
        .map((node) => node.id.value),
    );

    if (fileNodeIds.size === 0) {
      return null;
    }

    return getWorkflowSyncBlockReason(
      workflowFileSyncSnapshots.filter((snapshot) => fileNodeIds.has(snapshot.nodeId)),
    );
  }, [workflow.workflow, workflowFileSyncSnapshots]);

  useEffect(() => {
    autoSaveDirtyRef.current = workflow.isDirty;
    autoSaveSavingRef.current = workflow.isSaving;
    autoSaveFileSyncBlockReasonRef.current = workflowFileSyncBlockReason;
  }, [workflow.isDirty, workflow.isSaving, workflowFileSyncBlockReason]);

  useEffect(() => {
    const previousHadActiveExecution = previousHasActiveExecutionRef.current;
    previousHasActiveExecutionRef.current = hasActiveExecution;

    const idleDecision = shouldAutoSaveAfterExecutionIdle({
      workflow: workflow.workflow,
      isDirty: workflow.isDirty,
      isSaving: workflow.isSaving,
      hasActiveExecution,
      previousHadActiveExecution,
      fileSyncBlockReason: workflowFileSyncBlockReason,
      autoSaveEnabled: workflow.autoSaveConfig.enabled && workflow.autoSaveConfig.idleSaveEnabled,
    });

    if (!idleDecision.shouldSave) {
      return;
    }

    if (!idleDecision.reason) {
      return;
    }

    void requestWorkflowAutoSave(saveWorkflow, idleDecision.reason).catch((error) => {
      const message = error instanceof Error ? error.message : '自动保存失败';
      if (lastAutoSaveErrorMessageRef.current !== message) {
        showError('自动保存失败', message);
        lastAutoSaveErrorMessageRef.current = message;
      }
    });
  }, [
    hasActiveExecution,
    saveWorkflow,
    showError,
    workflow,
    workflowFileSyncBlockReason,
  ]);

  useEffect(() => {
    const fallbackIntervalMs = workflow.autoSaveConfig.fallbackIntervalMs;
    if (!workflow.autoSaveConfig.enabled || fallbackIntervalMs <= 0) {
      return;
    }

    autoSaveFallbackTimerRef.current = setInterval(() => {
      const fallbackDecision = shouldRunFallbackAutoSave({
        workflow: workflowRef.current,
        isDirty: autoSaveDirtyRef.current,
        isSaving: autoSaveSavingRef.current,
        fileSyncBlockReason: autoSaveFileSyncBlockReasonRef.current,
        autoSaveEnabled: workflow.autoSaveConfig.enabled,
      });

      if (!fallbackDecision.shouldSave) {
        return;
      }

      if (!fallbackDecision.reason) {
        return;
      }

      void requestWorkflowAutoSave(saveWorkflow, fallbackDecision.reason).catch((error) => {
        const message = error instanceof Error ? error.message : '自动保存失败';
        if (lastAutoSaveErrorMessageRef.current !== message) {
          showError('自动保存失败', message);
          lastAutoSaveErrorMessageRef.current = message;
        }
      });
    }, fallbackIntervalMs);

    return () => {
      if (autoSaveFallbackTimerRef.current) {
        clearInterval(autoSaveFallbackTimerRef.current);
        autoSaveFallbackTimerRef.current = null;
      }
    };
  }, [saveWorkflow, showError, workflow, workflowRef]);

  useEffect(() => {
    if (!workflow.lastSaveError) {
      lastAutoSaveErrorMessageRef.current = null;
    }
  }, [workflow.lastSaveError]);

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      if (!autoSaveDirtyRef.current || !workflowRef.current) {
        return;
      }

      void saveWorkflow({ force: true, silent: true }).catch(() => {
        // Best-effort save on unload — may not complete before page closes
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveWorkflow, workflowRef]);

  return {
    workflowFileSyncBlockReason,
  };
}
