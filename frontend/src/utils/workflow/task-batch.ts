import type {
  AINodeData,
  ExecutionTaskNodeRef,
  ExecutionTaskRef,
  FileNodeData,
  NodeTaskRef,
  TaskFileRef,
} from '@/types';
import { isFileNodeData } from '@/utils/common/guards';

export function buildExecutionTaskNodeRef(node: AINodeData): ExecutionTaskNodeRef {
  return {
    nodeId: node.id.value,
    nodeDisplayId: node.id.display,
    nodeType: node.type,
    nodeTitle: typeof node.annotation === 'string' && node.annotation.trim().length > 0
      ? node.annotation.trim()
      : undefined,
  };
}

function toTaskFileRef(node: FileNodeData): TaskFileRef {
  return {
    fileId: node.fileId,
    fileName: node.fileName,
    mimeType: node.mimeType,
  };
}

export function toNodeTaskRef(task: ExecutionTaskRef): NodeTaskRef {
  return {
    taskId: task.taskId,
    taskNo: task.taskNo,
    batchId: task.batchId,
    runId: task.runId,
    runNo: task.runNo,
    scope: task.scope,
    groupId: task.groupId,
    groupLabel: task.groupLabel,
    groupOrder: task.groupOrder,
    ...(task.taskType !== undefined ? { taskType: task.taskType } : {}),
    ...(task.outputHandle !== undefined ? { outputHandle: task.outputHandle } : {}),
    status: task.status,
    createdAt: task.createdAt,
    ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
    ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
  };
}

export function collectExecutionInputFiles(nodes: FileNodeData[]): TaskFileRef[] {
  return nodes
    .filter((node): node is FileNodeData => isFileNodeData(node))
    .map(toTaskFileRef);
}
