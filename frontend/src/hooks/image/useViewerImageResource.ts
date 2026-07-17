import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileNodeData } from '@/types';
import { useImageResource, type UseImageResourceOptions, type UseImageResourceResult } from './useImageResource';
import {
  resolveFileResource,
  type FileResourceDiagnosticsMetadata,
  type FileResourceHandle,
} from '@/services/file-resource';

function getFileResourceDiagnostics(error: unknown): FileResourceDiagnosticsMetadata | undefined {
  return error && typeof error === 'object'
    ? (error as { fileResourceDiagnostics?: FileResourceDiagnosticsMetadata }).fileResourceDiagnostics
    : undefined;
}

function createViewerResourceSignature(node: FileNodeData): string {
  const imageAsset = node.imageAsset;
  const originalVariant = imageAsset?.variants.original;
  return [
    node.id.value,
    node.fileId,
    node.backendFileId ?? '',
    node.fileName,
    node.mimeType,
    node.fileSize,
    node.source.type,
    node.source.type === 'imported' ? node.source.localSource?.referenceId ?? '' : '',
    node.source.type === 'node-output' ? node.source.taskId : '',
    node.source.type === 'node-output' ? node.source.taskNo : '',
    imageAsset?.assetId ?? '',
    imageAsset?.source ?? '',
    imageAsset?.version ?? '',
    originalVariant?.url ?? '',
    originalVariant?.updatedAt ?? '',
    originalVariant?.mimeType ?? '',
    originalVariant?.width ?? '',
    originalVariant?.height ?? '',
    node.metadata.width ?? '',
    node.metadata.height ?? '',
  ].join('|');
}

export function useViewerImageResource(
  node: FileNodeData,
  enabled: boolean,
  options: Omit<UseImageResourceOptions, 'enabled'> & {
    signal?: AbortSignal;
    workflowId?: string | null;
    authScope?: string | null;
  } = {}
): UseImageResourceResult {
  const nodeId = node.id;
  const fileId = node.fileId;
  const imageAsset = node.imageAsset;
  const originalVariant = imageAsset?.variants.original;
  const metadata = node.metadata;
  const viewerResourceSignature = useMemo(() => createViewerResourceSignature(node), [node]);
  const viewerResourceNodeRef = useRef(node);
  const viewerResourceSignatureRef = useRef(viewerResourceSignature);
  if (viewerResourceSignatureRef.current !== viewerResourceSignature) {
    viewerResourceSignatureRef.current = viewerResourceSignature;
    viewerResourceNodeRef.current = node;
  }
  const [viewerSource, setViewerSource] = useState<{
    url?: string;
    revision: number;
    error?: string;
    loading: boolean;
    diagnostics?: FileResourceDiagnosticsMetadata;
  }>({ revision: 0, loading: false });
  const viewerHandleRef = useRef<FileResourceHandle | null>(null);
  const requestSequenceRef = useRef(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const originalOnlyNode = useMemo(() => ({
    id: nodeId,
    fileId,
    metadata,
    thumbnailUrl: undefined,
    imageAsset: imageAsset
      ? {
        ...imageAsset,
        variants: {
          original: originalVariant,
        },
      }
      : undefined,
  }), [
    fileId,
    imageAsset,
    metadata,
    nodeId,
    originalVariant,
  ]);

  useEffect(() => {
    if (!enabled) {
      viewerHandleRef.current?.release();
      viewerHandleRef.current = null;
      setViewerSource((current) => (
        current.url || current.error || current.loading
          ? { revision: current.revision + 1, loading: false }
          : current
      ));
      return;
    }

    let cancelled = false;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;

    const releaseCurrentHandle = (): void => {
      viewerHandleRef.current?.release();
      viewerHandleRef.current = null;
    };

    setViewerSource((current) => ({
      revision: current.revision + 1,
      loading: true,
    }));

    const resourceNode = viewerResourceNodeRef.current;
    void resolveFileResource(resourceNode, {
      purpose: 'viewer-original',
      require: 'displayUrl',
      signal: options.signal,
      workflowId: options.workflowId,
      authScope: options.authScope,
      owner: `viewer-original:${nodeId.value}:${fileId}`,
    }).then((handle) => {
      if (cancelled) {
        handle.release();
        return;
      }

      if (requestSequenceRef.current !== sequence) {
        handle.release();
        return;
      }

      releaseCurrentHandle();
      viewerHandleRef.current = handle;
      setViewerSource((current) => ({
        url: handle.displayUrl ?? handle.objectUrl,
        revision: current.revision + 1,
        loading: false,
      }));
    }).catch((error: unknown) => {
      if (cancelled || requestSequenceRef.current !== sequence) {
        return;
      }
      releaseCurrentHandle();
      setViewerSource((current) => ({
        revision: current.revision + 1,
        error: error instanceof Error ? error.message : 'Original image is unavailable.',
        diagnostics: getFileResourceDiagnostics(error),
        loading: false,
      }));
    });

    return (): void => {
      cancelled = true;
      if (requestSequenceRef.current === sequence) {
        releaseCurrentHandle();
      }
    };
  }, [
    enabled,
    fileId,
    nodeId.value,
    options.authScope,
    options.signal,
    options.workflowId,
    retryRevision,
    viewerResourceSignature,
  ]);

  const resource = useImageResource(originalOnlyNode, 'original', {
    ...options,
    enabled,
    sourceRevision: (options.sourceRevision ?? 0) + viewerSource.revision + retryRevision,
    sourceUrl: viewerSource.url,
    useExternalSource: true,
  });
  const reportRenderableFailure = useCallback((attemptedSrc?: string, reason?: string): void => {
    resource.reportRenderableFailure(attemptedSrc, reason);
    viewerHandleRef.current?.release();
    viewerHandleRef.current = null;
    setViewerSource((current) => ({
      revision: current.revision + 1,
      loading: true,
    }));
    setRetryRevision((current) => current + 1);
  }, [resource.reportRenderableFailure]);

  if (enabled && viewerSource.loading && !viewerSource.url) {
    return {
      ...resource,
      status: 'loading',
      phase: 'loading',
      error: undefined,
      requestUrl: undefined,
      src: undefined,
      reportRenderableFailure,
    };
  }

  if (enabled && viewerSource.error && !viewerSource.url) {
    return {
      ...resource,
      status: 'error',
      phase: 'error',
      error: viewerSource.error,
      debug: {
        ...resource.debug,
        fileResourceDiagnostics: viewerSource.diagnostics,
      },
      requestUrl: undefined,
      src: undefined,
      reportRenderableFailure,
    };
  }

  return {
    ...resource,
    reportRenderableFailure,
  };
}
