import type { FileNodeData, Workflow } from '@/types';
import type { AITaskInputFileBinding } from '@/types/ai.types';
import { createError } from '@/utils';
import { workflowUploadScheduler } from './workflow-upload-scheduler';
import type { WorkflowUploadTaskSnapshot } from './workflow-upload-scheduler.types';

export interface ExecutionFileReadinessIssue {
  nodeId: string;
  fileId: string;
  fileName: string;
  status: WorkflowUploadTaskSnapshot['status'] | 'missing';
  message: string;
}

export interface ExecutionFileReadinessResult {
  fileNodeIds: string[];
  readyFileIds: string[];
  fileBindingMap: Record<string, string>;
  fileBindings: AITaskInputFileBinding[];
  issues: ExecutionFileReadinessIssue[];
}

export interface ExecutionFileReadinessOptions {
  signal?: AbortSignal;
  scheduler?: Pick<typeof workflowUploadScheduler, 'getNodeSnapshot' | 'ensureReady'>;
  workflowId?: string | null;
}

function toFileIssue(node: FileNodeData, status: ExecutionFileReadinessIssue['status'], message: string): ExecutionFileReadinessIssue {
  return {
    nodeId: node.id.value,
    fileId: node.fileId,
    fileName: node.fileName,
    status,
    message,
  };
}

function buildFailureMessage(node: FileNodeData, snapshot: WorkflowUploadTaskSnapshot | null, error: unknown): string {
  if (snapshot?.error) {
    return snapshot.error;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return `${node.fileName} 尚未完成同步。`;
}

export async function ensureExecutionFilesReady(
  _workflow: Workflow,
  fileNodes: FileNodeData[],
  options: ExecutionFileReadinessOptions = {},
): Promise<ExecutionFileReadinessResult> {
  const scheduler = options.scheduler ?? workflowUploadScheduler;
  const readyFileIds: string[] = [];
  const fileBindingMap: Record<string, string> = {};
  const fileBindings: AITaskInputFileBinding[] = [];
  const issues: ExecutionFileReadinessIssue[] = [];
  const workflowId = options.workflowId ?? _workflow.id;

  for (const node of fileNodes) {
    const snapshot = scheduler.getNodeSnapshot(node.id.value, workflowId);

    if (node.backendFileId && snapshot?.status !== 'failed') {
      readyFileIds.push(node.backendFileId);
      fileBindingMap[node.fileId] = node.backendFileId;
      fileBindings.push({
        fileId: node.backendFileId,
        nodeId: node.id.value,
        role: 'input',
      });
      continue;
    }

    try {
      const backendFileId = await scheduler.ensureReady(node, {
        priority: 'high',
        signal: options.signal,
        workflowId,
      });
      readyFileIds.push(backendFileId);
      fileBindingMap[node.fileId] = backendFileId;
      fileBindings.push({
        fileId: backendFileId,
        nodeId: node.id.value,
        role: 'input',
      });
    } catch (error) {
      const latestSnapshot = scheduler.getNodeSnapshot(node.id.value, workflowId);
      issues.push(
        toFileIssue(
          node,
          latestSnapshot?.status ?? snapshot?.status ?? 'missing',
          buildFailureMessage(node, latestSnapshot ?? snapshot, error),
        ),
      );
    }
  }

  return {
    fileNodeIds: fileNodes.map((node) => node.id.value),
    readyFileIds,
    fileBindingMap,
    fileBindings,
    issues,
  };
}

export function assertExecutionFilesReady(
  workflow: Workflow,
  result: ExecutionFileReadinessResult,
): void {
  if (result.issues.length === 0) {
    return;
  }

  const message = result.issues
    .map((issue) => `${issue.fileName}: ${issue.message}`)
    .join("; ");

  throw createError("FILE_REGISTER_FAILED", message, {
    module: "execution-file-readiness",
    operation: "assertExecutionFilesReady",
    timestamp: Date.now(),
    context: {
      workflowId: workflow.id,
      issues: result.issues,
    },
  });
}
