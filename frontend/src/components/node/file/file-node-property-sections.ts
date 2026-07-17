import type { FileNodeData, LocalFileSourceStatus } from '@/types';

export interface PropertyFieldItem {
  label: string;
  value?: string | null;
  multiline?: boolean;
}

export interface PropertySection {
  title: string;
  items: PropertyFieldItem[];
}

const EMPTY_VALUE = '\u672a\u8bb0\u5f55';

function formatTimestamp(timestamp?: number): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return EMPTY_VALUE;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatLocalSourceStatus(status: LocalFileSourceStatus | undefined): string {
  switch (status) {
    case 'runtime-only':
      return '\u4ec5\u5f53\u524d\u4f1a\u8bdd';
    case 'available':
      return '\u672c\u5730\u6e90\u53ef\u7528';
    case 'linked':
      return '\u5df2\u5efa\u7acb\u6301\u4e45\u5f15\u7528';
    case 'permission-required':
      return '\u9700\u91cd\u65b0\u6388\u6743';
    case 'missing':
      return '\u672c\u5730\u6e90\u4e0d\u53ef\u7528';
    case 'unknown':
      return '\u672a\u77e5';
    default:
      return EMPTY_VALUE;
  }
}

function getLocalSourceRecoveryHint(node: FileNodeData): string {
  if (node.type !== 'image') {
    return EMPTY_VALUE;
  }

  switch (node.source.localSource?.status) {
    case 'runtime-only':
      return '当前会话已关联本地原图';
    case 'available':
      return '已通过浏览器持久句柄恢复，本地原图可优先用于 viewer';
    case 'linked':
      return '已记录持久引用，重开后会尝试恢复本地来源';
    case 'permission-required':
      return '浏览器本地句柄权限未恢复，可重新授权或重新关联本地文件';
    case 'missing':
    case 'unknown':
    case undefined:
      return '可使用“重新关联本地文件”恢复 viewer 本地原图优先读取';
    default:
      return EMPTY_VALUE;
  }
}

export function buildFileNodePropertySections(node: FileNodeData | null): PropertySection[] {
  if (!node) {
    return [];
  }

  const sourceLabel = node.source.type === 'imported'
    ? '\u5bfc\u5165'
    : '\u8282\u70b9\u4ea7\u7269';
  const fileTypeLabel = node.type === 'image'
    ? '\u56fe\u7247'
    : node.type === 'video'
      ? '\u89c6\u9891'
      : 'PLY \u6a21\u578b';

  const metadataItems: PropertyFieldItem[] = [
    { label: '\u8282\u70b9\u7f16\u53f7', value: node.id.display },
    { label: '\u6587\u4ef6\u540d\u79f0', value: node.fileName },
    { label: '\u6587\u4ef6\u7c7b\u578b', value: fileTypeLabel },
    { label: '\u6587\u4ef6\u5927\u5c0f', value: formatFileSize(node.fileSize) },
    { label: 'MIME \u7c7b\u578b', value: node.mimeType || EMPTY_VALUE },
    { label: '\u6587\u4ef6\u6765\u6e90', value: sourceLabel },
    { label: '\u521b\u5efa\u65f6\u95f4', value: formatTimestamp(node.timestamp.created) },
    { label: '\u66f4\u65b0\u65f6\u95f4', value: formatTimestamp(node.timestamp.updated) },
  ];

  if (node.metadata.width && node.metadata.height) {
    metadataItems.push({
      label: '\u5a92\u4f53\u5c3a\u5bf8',
      value: `${node.metadata.width} x ${node.metadata.height}`,
    });
  }

  if (typeof node.metadata.duration === 'number' && Number.isFinite(node.metadata.duration)) {
    metadataItems.push({
      label: '\u65f6\u957f',
      value: `${node.metadata.duration.toFixed(2)} \u79d2`,
    });
  }

  const result: PropertySection[] = [
    {
      title: '\u57fa\u7840\u4fe1\u606f',
      items: metadataItems,
    },
  ];

  if (node.source.type === 'imported') {
    const sourceDisplayName = node.source.sourceDisplayName ?? node.source.originalPath ?? EMPTY_VALUE;
    result.push({
      title: '\u6765\u6e90\u4fe1\u606f',
      items: [
        { label: '\u6765\u6e90\u7c7b\u578b', value: '\u5bfc\u5165' },
        { label: '\u5bfc\u5165\u65b9\u5f0f', value: node.source.importMethod === 'local' ? '\u672c\u5730\u5bfc\u5165' : EMPTY_VALUE },
        { label: '\u5bfc\u5165\u65f6\u95f4', value: formatTimestamp(node.source.importedAt) },
        { label: '\u6765\u6e90\u6587\u4ef6\u540d', value: sourceDisplayName, multiline: true },
        { label: '\u672c\u5730\u6e90\u72b6\u6001', value: formatLocalSourceStatus(node.source.localSource?.status) },
        { label: '\u6743\u9650\u72b6\u6001', value: node.source.localSource?.permissionState ?? EMPTY_VALUE },
        { label: '\u672c\u5730\u6e90\u6062\u590d', value: getLocalSourceRecoveryHint(node), multiline: true },
      ],
    });
  }

  if (node.source.type === 'node-output') {
    result.push({
      title: '\u6765\u6e90\u4fe1\u606f',
      items: [
        { label: '\u6765\u6e90\u7c7b\u578b', value: '\u8282\u70b9\u4ea7\u7269' },
        { label: '\u751f\u6210\u8282\u70b9\u7f16\u53f7', value: node.source.producerNodeDisplayId ?? EMPTY_VALUE },
        { label: '\u751f\u6210\u8282\u70b9 ID', value: node.source.producerNodeId ?? EMPTY_VALUE },
        { label: '\u751f\u6210\u8282\u70b9\u7c7b\u578b', value: node.source.producerNodeType ?? EMPTY_VALUE },
      ],
    });

    result.push({
      title: '\u751f\u6210\u4fe1\u606f',
      items: [
        { label: '\u4efb\u52a1\u7f16\u53f7', value: node.source.taskNo ?? EMPTY_VALUE },
        { label: '\u4efb\u52a1 ID', value: node.source.taskId ?? EMPTY_VALUE },
        { label: '\u4efb\u52a1\u521b\u5efa\u65f6\u95f4', value: formatTimestamp(node.source.taskCreatedAt) },
        { label: '\u4efb\u52a1\u5f00\u59cb\u65f6\u95f4', value: formatTimestamp(node.source.taskStartedAt) },
        { label: '\u4efb\u52a1\u5b8c\u6210\u65f6\u95f4', value: formatTimestamp(node.source.taskCompletedAt) },
      ],
    });
  }

  return result;
}
