import type { Workflow } from './workflow.types';

export const LOCAL_WORKFLOW_ARCHIVE_FORMAT = 'newworkflow-local-archive' as const;
export const LOCAL_WORKFLOW_ARCHIVE_VERSION = 1 as const;

export type LocalWorkflowArchiveFormat = typeof LOCAL_WORKFLOW_ARCHIVE_FORMAT;
export type LocalWorkflowArchiveVersion = typeof LOCAL_WORKFLOW_ARCHIVE_VERSION;

export type LocalWorkflowEmbeddedAssetKind = 'image' | 'video' | 'ply' | 'binary' | 'unknown';
export type LocalWorkflowEmbeddedAssetEncoding = 'base64';

export interface LocalWorkflowEmbeddedAsset {
  id: string;
  nodeId: string;
  fileId: string;
  kind: LocalWorkflowEmbeddedAssetKind;
  fileName: string;
  mimeType: string;
  size: number;
  encoding: LocalWorkflowEmbeddedAssetEncoding;
  data: string;
  width?: number;
  height?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface LocalWorkflowArchive {
  format: LocalWorkflowArchiveFormat;
  version: LocalWorkflowArchiveVersion;
  savedAt: number;
  workflow: Workflow;
  embeddedAssets: LocalWorkflowEmbeddedAsset[];
}

export interface CreateLocalWorkflowArchiveOptions {
  savedAt?: number;
  embeddedAssets?: LocalWorkflowEmbeddedAsset[];
}
