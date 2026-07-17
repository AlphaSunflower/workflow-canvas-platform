import type { ExecutionTaskRef, FileInfo, FileSource } from '@/types';

type TaskSourceRecord = Pick<
  ExecutionTaskRef,
  'taskId' | 'taskNo' | 'createdAt' | 'startedAt' | 'completedAt' | 'node'
>;

export function createNodeOutputFileSource(taskRecord: TaskSourceRecord): FileSource {
  return {
    type: 'node-output',
    producerNodeId: taskRecord.node.nodeId,
    producerNodeDisplayId: taskRecord.node.nodeDisplayId,
    producerNodeType: taskRecord.node.nodeType,
    taskId: taskRecord.taskId,
    taskNo: taskRecord.taskNo,
    taskCreatedAt: taskRecord.createdAt,
    taskStartedAt: taskRecord.startedAt,
    taskCompletedAt: taskRecord.completedAt,
  };
}

export function normalizeTaskResultFileInfo(
  fileInfo: FileInfo,
  taskRecord: TaskSourceRecord
): FileInfo {
  return {
    ...fileInfo,
    source: createNodeOutputFileSource(taskRecord),
  };
}

export function normalizeTaskResultFileInfos(
  fileInfos: FileInfo[],
  taskRecord: TaskSourceRecord
): FileInfo[] {
  return fileInfos.map((fileInfo) => normalizeTaskResultFileInfo(fileInfo, taskRecord));
}
