import type { FileNodeData } from '@/types';
import { createError } from '@/utils';

export function assertAdapterBackendFileId(
  backendFileId: string | null | undefined,
  sourceNode: FileNodeData,
  options: {
    module: string;
    fieldName: string;
  },
): string {
  const trimmed = typeof backendFileId === 'string' ? backendFileId.trim() : '';
  if (trimmed.length > 0) {
    return trimmed;
  }

  throw createError('FILE_REGISTER_FAILED', `Failed to resolve backend ${options.fieldName}.`, {
    module: options.module,
    operation: 'createExecutionPayload',
    timestamp: Date.now(),
    context: {
      nodeId: sourceNode.id.value,
      localFileId: sourceNode.fileId,
      backendFileId,
      fieldName: options.fieldName,
    },
  });
}
