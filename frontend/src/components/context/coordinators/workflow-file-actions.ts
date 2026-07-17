import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type {
  AnyNodeData,
  FileNodeData,
  Workflow,
} from '@/types';
import type {
  WorkflowAuthoritativeWorkflowSupplier,
} from '../workflow-context.types';
import { createAuthoritativeWorkflowExportProjection } from '../workflow-authoritative-workflow';
import { runWorkflowSavePreflight } from '../workflow-save-preflight';
import {
  buildWorkflowArchiveFileName,
  saveTextFile,
} from '@/services/browser-file';
import { fileExportService } from '@/services/file-export';
import {
  createLocalFileSourceReferenceId,
  createLocalFileSourceStoreRecord,
  localFileSourceStore,
} from '@/services/local-file-source-store';
import {
  createEmbeddedLocalWorkflowArchive,
  extractWorkflowFromLocalArchive,
  parseLocalWorkflowArchive,
  serializeLocalWorkflowArchive,
} from '@/services/local-workflow-archive';
import { rebindLocalFileToNode } from '@/services/local-file-rebind';
import { isExecutionOutputAccessDeniedError } from '@/services/execution-output-access-error';
import type { BrowserFileSystemFileHandleLike } from '@/services/local-file-source-store';
import { normalizeWorkflowNodeIdMetadata } from '@/utils';
import { createError, createModuleLogger, isFileNodeData } from '@/utils';

const log = createModuleLogger('workflow-file-actions');

interface WorkflowFileController {
  markClean: (savedAt?: number) => void;
  markDirty: () => void;
}

interface WorkflowFileActionsDependencies {
  workflow: WorkflowFileController;
  workflowRef: MutableRefObject<Workflow | null>;
  getAuthoritativeWorkflow: WorkflowAuthoritativeWorkflowSupplier;
  nodeMap: Map<string, AnyNodeData>;
  loadWorkflow: (workflow: Workflow) => void;
  patchCurrentWorkflow: (updater: (workflow: Workflow) => Workflow) => Workflow | null;
  setLastLoadError: (value: string | null) => void;
  showError: (title: string, message: string) => void;
  showInfo: (title: string, message: string) => void;
  showSuccess: (title: string, message: string) => void;
  showWarning: (title: string, message: string) => void;
}

export interface WorkflowFileActions {
  exportLocalArchive: () => Promise<void>;
  importLocalArchive: (content: string) => Promise<void>;
  exportFileNode: (
    nodeId: string,
    options?: { forceDirectoryPicker?: boolean },
  ) => Promise<void>;
  rebindLocalFileNodeSource: (
    nodeId: string,
    file: File,
    options?: {
      localSourceHandle?: BrowserFileSystemFileHandleLike;
    },
  ) => Promise<FileNodeData | null>;
}

export function useWorkflowFileActions(
  dependencies: WorkflowFileActionsDependencies,
): WorkflowFileActions {
  const {
    workflow,
    workflowRef,
    getAuthoritativeWorkflow,
    nodeMap,
    loadWorkflow,
    patchCurrentWorkflow,
    setLastLoadError,
    showError,
    showInfo,
    showSuccess,
    showWarning,
  } = dependencies;

  const exportLocalArchive = useCallback(async (): Promise<void> => {
    runWorkflowSavePreflight({
      reason: 'local-export',
      force: true,
    });

    const activeWorkflow = getAuthoritativeWorkflow();
    if (!activeWorkflow) {
      throw createError('WORKFLOW_ERROR', 'No workflow is available to export.', {
        module: 'workflow-context',
        operation: 'exportLocalArchive',
        timestamp: Date.now(),
      });
    }

    const savedAt = Date.now();
    const exportWorkflow = createAuthoritativeWorkflowExportProjection(activeWorkflow, savedAt);
    const archiveResult = await createEmbeddedLocalWorkflowArchive(exportWorkflow, { savedAt });
    if (!archiveResult.success) {
      throw archiveResult.error;
    }

    const serializedArchive = serializeLocalWorkflowArchive(archiveResult.data);
    if (!serializedArchive.success) {
      throw serializedArchive.error;
    }

    const fileName = buildWorkflowArchiveFileName(savedAt);
    const saveResult = await saveTextFile(serializedArchive.data, fileName);
    if (!saveResult.success) {
      throw saveResult.error;
    }

    workflowRef.current = exportWorkflow;
    workflow.markClean(savedAt);
    log.info('exportLocalArchive', `Workflow exported to local archive: ${fileName}`);
  }, [
    getAuthoritativeWorkflow,
    workflow,
    workflowRef,
  ]);

  const importLocalArchive = useCallback(async (content: string): Promise<void> => {
    const parsedArchive = parseLocalWorkflowArchive(content);
    if (!parsedArchive.success) {
      setLastLoadError(parsedArchive.error.message);
      throw parsedArchive.error;
    }

    const extractedWorkflow = await extractWorkflowFromLocalArchive(parsedArchive.data);
    if (!extractedWorkflow.success) {
      setLastLoadError(extractedWorkflow.error.message);
      throw extractedWorkflow.error;
    }

    const normalizedWorkflow = {
      ...extractedWorkflow.data,
      metadata: normalizeWorkflowNodeIdMetadata(
        extractedWorkflow.data.metadata,
        extractedWorkflow.data.nodes,
      ),
    };

    loadWorkflow(normalizedWorkflow);
    workflow.markClean(parsedArchive.data.savedAt);
    log.info('importLocalArchive', `Workflow imported from local archive saved at ${parsedArchive.data.savedAt}`);
  }, [loadWorkflow, setLastLoadError, workflow]);

  const exportFileNode = useCallback(async (
    nodeId: string,
    options?: { forceDirectoryPicker?: boolean },
  ): Promise<void> => {
    const node = nodeMap.get(nodeId);

    if (!node || !isFileNodeData(node)) {
      showWarning('保存失败', '当前节点不是可导出的文件节点。');
      return;
    }

    const result = await fileExportService.exportNodeFile(node, {
      forceDirectoryPicker: options?.forceDirectoryPicker,
      workflowId: workflowRef.current?.id ?? null,
    });

    if (result.status === 'saved') {
      const directoryLabel = result.directoryName ? `已保存到 ${result.directoryName}` : '已保存到选定目录';
      showSuccess('导出成功', `${node.fileName} ${directoryLabel}`);
      return;
    }

    if (result.status === 'downloaded') {
      showInfo('已降级下载', `${node.fileName} 已通过浏览器下载保存`);
      return;
    }

    showError(
      isExecutionOutputAccessDeniedError(result.error) ? '产物读取失败' : '导出失败',
      result.error.message,
    );
  }, [nodeMap, showError, showInfo, showSuccess, showWarning, workflowRef]);

  const rebindLocalFileNodeSource = useCallback(async (
    nodeId: string,
    file: File,
    options?: {
      localSourceHandle?: BrowserFileSystemFileHandleLike;
    },
  ): Promise<FileNodeData | null> => {
    const node = nodeMap.get(nodeId);

    if (!node || !isFileNodeData(node)) {
      showWarning('重新关联不可用', '当前节点不是可重新关联的文件节点。');
      return null;
    }

    const localSourceReferenceId = options?.localSourceHandle
      ? createLocalFileSourceReferenceId(nodeId, node.fileId)
      : undefined;

    let persistedLocalSourceHandle = false;
    if (options?.localSourceHandle && localSourceReferenceId) {
      try {
        await localFileSourceStore.save(
          createLocalFileSourceStoreRecord(localSourceReferenceId, options.localSourceHandle, file, 'granted'),
        );
        persistedLocalSourceHandle = true;
      } catch {
        showWarning('句柄保存失败', '本次已恢复本地原图，但浏览器未能保存持久句柄，重开后仍需重新关联。');
      }
    }

    const result = await rebindLocalFileToNode(node, file, {
      localSourceHandle: persistedLocalSourceHandle ? options?.localSourceHandle : undefined,
      localSourceReferenceId: persistedLocalSourceHandle ? localSourceReferenceId : undefined,
      permissionState: persistedLocalSourceHandle ? 'granted' : undefined,
      workflowId: workflowRef.current?.id ?? null,
    });
    if (!result.success) {
      showWarning('重新关联失败', result.message);
      return null;
    }

    const reboundNode = result.node;
    patchCurrentWorkflow((currentWorkflow) => ({
      ...currentWorkflow,
      nodes: {
        ...currentWorkflow.nodes,
        [nodeId]: reboundNode,
      },
      timestamp: {
        ...currentWorkflow.timestamp,
        updated: reboundNode.timestamp.updated,
      },
    }));
    workflow.markDirty();
    showSuccess('重新关联成功', `${reboundNode.fileName} 已恢复本地原图优先读取。`);
    return reboundNode;
  }, [nodeMap, patchCurrentWorkflow, showSuccess, showWarning, workflow]);

  return {
    exportLocalArchive,
    importLocalArchive,
    exportFileNode,
    rebindLocalFileNodeSource,
  };
}
