import type { FileNodeData } from '@/types';
import { backendFileService } from './backendFileService';
import { hashWorkflowFile } from './workflow-upload-hash';
import type { BrowserFileSystemFileHandleLike } from './local-file-source-store';

export type LocalFileRebindErrorCode =
  | 'UNSUPPORTED_NODE_TYPE'
  | 'NAME_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'MIME_MISMATCH'
  | 'HASH_MISMATCH'
  | 'HASH_FAILED';

export interface LocalFileRebindSuccess {
  success: true;
  node: FileNodeData;
  file: File;
  sha256?: string;
}

export interface LocalFileRebindFailure {
  success: false;
  code: LocalFileRebindErrorCode;
  message: string;
}

export type LocalFileRebindResult = LocalFileRebindSuccess | LocalFileRebindFailure;

export interface LocalFileRebindOptions {
  signal?: AbortSignal;
  hashFile?: (file: File, signal?: AbortSignal) => Promise<string>;
  localSourceReferenceId?: string;
  localSourceHandle?: BrowserFileSystemFileHandleLike;
  permissionState?: PermissionState;
  workflowId?: string | null;
  authScope?: string | null;
}

function normalizeString(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMimeType(value: string | undefined | null): string {
  return normalizeString(value).toLowerCase();
}

function getExpectedSourceName(node: FileNodeData): string {
  if (node.source.type === 'imported') {
    return normalizeString(node.source.sourceDisplayName)
      || normalizeString(node.source.originalPath)
      || node.fileName;
  }

  return node.fileName;
}

function getExpectedHash(
  node: FileNodeData,
  options: Pick<LocalFileRebindOptions, 'workflowId' | 'authScope'> = {},
): string {
  return normalizeString(backendFileService.getCachedBackendFileBinding(node, {
    workflowId: options.workflowId,
    authScope: options.authScope,
  })?.sha256);
}

function validateBasicFileMatch(node: FileNodeData, file: File): LocalFileRebindFailure | null {
  if (node.type !== 'image') {
    return {
      success: false,
      code: 'UNSUPPORTED_NODE_TYPE',
      message: '当前入口仅支持重新关联图片节点的本地原图。',
    };
  }

  const expectedName = getExpectedSourceName(node);
  if (expectedName && file.name !== expectedName) {
    return {
      success: false,
      code: 'NAME_MISMATCH',
      message: `文件名不匹配：需要 ${expectedName}，当前选择 ${file.name || '未命名文件'}。`,
    };
  }

  if (node.fileSize > 0 && file.size !== node.fileSize) {
    return {
      success: false,
      code: 'SIZE_MISMATCH',
      message: `文件大小不匹配：需要 ${node.fileSize} B，当前选择 ${file.size} B。`,
    };
  }

  const expectedMimeType = normalizeMimeType(node.mimeType);
  const actualMimeType = normalizeMimeType(file.type);
  if (expectedMimeType && actualMimeType && actualMimeType !== expectedMimeType) {
    return {
      success: false,
      code: 'MIME_MISMATCH',
      message: `MIME 类型不匹配：需要 ${expectedMimeType}，当前选择 ${actualMimeType}。`,
    };
  }

  return null;
}

function buildReboundNodeWithOptions(
  node: FileNodeData,
  file: File,
  options: Pick<LocalFileRebindOptions, 'localSourceReferenceId' | 'localSourceHandle' | 'permissionState'>,
): FileNodeData {
  const updatedAt = Date.now();
  const isPersistentHandle = Boolean(options.localSourceHandle && options.localSourceReferenceId);

  return {
    ...node,
    fileName: node.fileName || file.name,
    mimeType: node.mimeType || file.type || 'application/octet-stream',
    source: node.source.type === 'imported'
      ? {
          ...node.source,
          importMethod: 'local',
          sourceDisplayName: node.source.sourceDisplayName || file.name,
          localSource: {
            ...node.source.localSource,
            status: isPersistentHandle ? 'available' : 'runtime-only',
            ...(options.localSourceReferenceId ? { referenceId: options.localSourceReferenceId } : {}),
            ...(isPersistentHandle ? { kind: 'file-system-access' as const } : { kind: 'runtime' as const }),
            ...(options.permissionState ? { permissionState: options.permissionState } : {}),
            ...(isPersistentHandle ? { lastResolvedAt: updatedAt } : {}),
          },
        }
      : node.source,
    timestamp: {
      ...node.timestamp,
      updated: updatedAt,
    },
  };
}

export async function rebindLocalFileToNode(
  node: FileNodeData,
  file: File,
  options: LocalFileRebindOptions = {},
): Promise<LocalFileRebindResult> {
  const basicMismatch = validateBasicFileMatch(node, file);
  if (basicMismatch) {
    return basicMismatch;
  }

  const expectedHash = getExpectedHash(node, options);
  let sha256: string | undefined;

  if (expectedHash) {
    try {
      sha256 = await (options.hashFile ?? hashWorkflowFile)(file, options.signal);
    } catch (error) {
      return {
        success: false,
        code: 'HASH_FAILED',
        message: error instanceof Error && error.message.trim().length > 0
          ? `文件哈希校验失败：${error.message}`
          : '文件哈希校验失败，请重新选择文件后重试。',
      };
    }

    if (sha256 !== expectedHash) {
      return {
        success: false,
        code: 'HASH_MISMATCH',
        message: '文件内容哈希不匹配，已阻止重新关联。',
      };
    }
  }

  backendFileService.restoreRuntimeNodeFileSourceFromHandle(node, file, {
    workflowId: options.workflowId,
    authScope: options.authScope,
  });

  return {
    success: true,
    node: buildReboundNodeWithOptions(node, file, options),
    file,
    ...(sha256 ? { sha256 } : {}),
  };
}
