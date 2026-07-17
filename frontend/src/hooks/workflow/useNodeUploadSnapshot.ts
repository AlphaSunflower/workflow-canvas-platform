import { useMemo, useSyncExternalStore } from 'react';
import type { FileNodeData } from '@/types';
import { workflowUploadScheduler } from '@/services/workflow-upload-scheduler';
import type { WorkflowUploadTaskSnapshot } from '@/services/workflow-upload-scheduler.types';

export function shouldActivateNodeUploadSubscription(node: Pick<FileNodeData, 'backendFileId' | 'source' | 'status'>): boolean {
  if (node.backendFileId) {
    return false;
  }

  if (node.status === 'pending' || node.status === 'processing') {
    return true;
  }

  return node.source.type === 'imported' && node.source.importMethod === 'local';
}

export function useNodeUploadSnapshot(
  node: Pick<FileNodeData, 'id' | 'backendFileId' | 'source' | 'status'>,
  options: { workflowId?: string | null } = {},
): WorkflowUploadTaskSnapshot | null {
  const nodeId = node.id.value;
  const workflowId = options.workflowId;
  const backendFileId = node.backendFileId;
  const sourceType = node.source.type;
  const sourceImportMethod = node.source.type === 'imported'
    ? node.source.importMethod
    : undefined;
  const status = node.status;
  const enabled = useMemo(() => {
    if (backendFileId) {
      return false;
    }

    if (status === 'pending' || status === 'processing') {
      return true;
    }

    return sourceType === 'imported' && sourceImportMethod === 'local';
  }, [backendFileId, sourceImportMethod, sourceType, status]);

  return useSyncExternalStore(
    (listener): (() => void) => (
      enabled
        ? workflowUploadScheduler.subscribeNode(nodeId, workflowId, listener)
        : (): void => undefined
    ),
    (): WorkflowUploadTaskSnapshot | null => workflowUploadScheduler.getNodeSnapshot(nodeId, workflowId),
    (): WorkflowUploadTaskSnapshot | null => workflowUploadScheduler.getNodeSnapshot(nodeId, workflowId),
  );
}
