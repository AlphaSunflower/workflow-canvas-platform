import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { FileNodeData } from '@/types';
import {
  resolveFileNodeImageAsset,
  getFileNodeImageThumbnailUrl,
} from '@/services/image/image-asset';
import { imageImportPreviewService } from '@/services/image/image-import-preview.service';
import type { ImageImportPreviewSnapshot } from '@/services/image/image-import-preview.types';
import { imageManager } from '@/services/image/image-manager';
import { isProtectedResourceUrl } from '@/services/protected-resource';
import type {
  ImageResourceDebugState,
  ImageResourceDecodedState,
  ImageResourceMode,
  ImageResourcePhase,
  ImageResourcePlaceholder,
  ImageResourceStatus,
  ImageResourceViewerState,
  ResolvedFileNodeImageAsset,
} from '@/services/image/image-resource.types';
import {
  createImageResourceReadModel,
  resolveImageResourcePlaceholder as resolveImageResourcePlaceholderModel,
} from '@/services/image/image-resource.types';
import { recordCanvasImageResourceSubscription } from '@/utils/performance';

export interface UseImageResourceResult {
  src?: string;
  status: ImageResourceStatus;
  phase: ImageResourcePhase;
  error?: string;
  preview: ImageImportPreviewSnapshot | null;
  isVisible: boolean;
  isNearViewport: boolean;
  displayWidth: number;
  displayHeight: number;
  placeholder: ImageResourcePlaceholder;
  request: () => Promise<void>;
  release: () => void;
  viewer: ImageResourceViewerState;
  decoded: ImageResourceDecodedState;
  debug: ImageResourceDebugState;
  shouldAutoRequest: boolean;
  requestUrl?: string;
  reportRenderableFailure: (attemptedSrc?: string, reason?: string) => void;
}

export interface UseImageResourceOptions {
  enabled?: boolean;
  sourceRevision?: number;
  sourceUrl?: string;
  useExternalSource?: boolean;
}

export function shouldAutoRequestCanvasImageResource(
  _state: Pick<UseImageResourceResult, 'status' | 'isVisible' | 'isNearViewport' | 'src'>,
  _mode: ImageResourceMode
): boolean {
  return false;
}

export function resolveImageResourcePlaceholder(
  state: Pick<UseImageResourceResult, 'status' | 'isVisible' | 'isNearViewport'>
): UseImageResourceResult['placeholder'] {
  return resolveImageResourcePlaceholderModel({
    status: state.status,
    visibility: {
      isVisible: state.isVisible,
      isNearViewport: state.isNearViewport,
    },
  });
}

export function useImageResource(
  node: Pick<FileNodeData, 'id' | 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>,
  mode: ImageResourceMode = 'canvas',
  options: UseImageResourceOptions = {}
): UseImageResourceResult {
  const nodeId = node.id.value;
  const fileId = node.fileId;
  const imageAsset = node.imageAsset;
  const metadata = node.metadata;
  const thumbnailUrl = node.thumbnailUrl;
  const enabled = options.enabled ?? true;
  const sourceRevision = options.sourceRevision ?? 0;
  const sourceUrl = options.sourceUrl;
  const useExternalSource = options.useExternalSource ?? false;
  const detachedState = useMemo(() => imageManager.createDetachedState(nodeId, mode), [mode, nodeId]);
  const subscribe = useCallback((listener: () => void) => {
    if (!enabled) {
      return (): void => undefined;
    }

    const unsubscribe = imageManager.subscribe(nodeId, listener, mode);
    if (import.meta.env?.DEV) {
      const snapshot = imageManager.getDebugSnapshot().subscriptions;
      recordCanvasImageResourceSubscription({
        nodeId,
        mode,
        phase: 'subscribe',
        activeSubscriptions: snapshot.total,
        activeNodesWithSubscriptions: snapshot.nodesWithSubscribers,
      });
    }

    return (): void => {
      unsubscribe();
      if (import.meta.env?.DEV) {
        const snapshot = imageManager.getDebugSnapshot().subscriptions;
        recordCanvasImageResourceSubscription({
          nodeId,
          mode,
          phase: 'unsubscribe',
          activeSubscriptions: snapshot.total,
          activeNodesWithSubscriptions: snapshot.nodesWithSubscribers,
        });
      }
    };
  }, [enabled, mode, nodeId]);
  const state = useSyncExternalStore(
    subscribe,
    () => (mode === 'canvas' ? imageManager.getState(nodeId, mode) : (enabled ? imageManager.getState(nodeId, mode) : detachedState)),
    () => (mode === 'canvas' ? imageManager.getState(nodeId, mode) : (enabled ? imageManager.getState(nodeId, mode) : detachedState))
  );
  const resourceView = useMemo(() => createImageResourceReadModel(state), [state]);
  const subscribePreview = useCallback((listener: () => void) => {
    if (!enabled || mode !== 'canvas') {
      return (): void => undefined;
    }

    return imageImportPreviewService.subscribe(nodeId, listener);
  }, [enabled, mode, nodeId]);
  const previewSnapshot = useSyncExternalStore(
    subscribePreview,
    () => (mode === 'canvas' ? imageImportPreviewService.getSnapshot(nodeId) : null),
    () => null,
  );
  const runtimeThumbnailUrl = previewSnapshot?.runtimeEntry?.objectUrl;
  const baseResolvedAsset = useMemo(() => resolveFileNodeImageAsset({
    fileId,
    imageAsset,
    metadata,
    thumbnailUrl,
  }), [
    fileId,
    imageAsset,
    metadata,
    thumbnailUrl,
  ]);
  const remoteThumbnailUrl = useMemo(
    () => getFileNodeImageThumbnailUrl({
      fileId,
      imageAsset,
      metadata,
      thumbnailUrl,
    }),
    [fileId, imageAsset, metadata, thumbnailUrl],
  );
  const requestUrl = useMemo(() => {
    if (!enabled && mode !== 'canvas') {
      return undefined;
    }

    if (mode === 'canvas') {
      return runtimeThumbnailUrl ?? remoteThumbnailUrl;
    }

    if (useExternalSource) {
      return sourceUrl;
    }

    return undefined;
  }, [
    enabled,
    mode,
    remoteThumbnailUrl,
    sourceUrl,
    sourceRevision,
    useExternalSource,
    runtimeThumbnailUrl,
  ]);
  const resolvedAsset = useMemo<ResolvedFileNodeImageAsset>(() => ({
    ...baseResolvedAsset,
    thumbnail: runtimeThumbnailUrl
      ? {
        kind: 'thumbnail',
        url: runtimeThumbnailUrl,
        fromLegacy: false,
        asset: baseResolvedAsset.thumbnail?.asset,
      }
      : baseResolvedAsset.thumbnail,
    original: mode === 'original'
      ? (
        requestUrl
          ? {
            kind: 'original',
            url: requestUrl,
            fromLegacy: false,
            asset: baseResolvedAsset.original?.asset,
          }
          : useExternalSource
            ? undefined
            : baseResolvedAsset.original
      )
      : baseResolvedAsset.original,
    preferred: runtimeThumbnailUrl
      ? {
        kind: 'thumbnail',
        url: runtimeThumbnailUrl,
        fromLegacy: false,
        asset: baseResolvedAsset.thumbnail?.asset,
      }
      : baseResolvedAsset.preferred,
  }), [baseResolvedAsset, mode, requestUrl, runtimeThumbnailUrl, useExternalSource]);
  const registrationRequest = useMemo(() => ({
    nodeId,
    mode,
    resolvedAsset,
    preferredUrl: requestUrl,
  }), [mode, nodeId, requestUrl, resolvedAsset]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    imageManager.register(registrationRequest);
  }, [enabled, registrationRequest]);

  const request = useCallback(() => imageManager.request(nodeId, mode), [mode, nodeId]);
  const release = useCallback(() => imageManager.release(nodeId, mode), [mode, nodeId]);
  const shouldAutoRequest = mode === 'canvas' ? shouldAutoRequestCanvasImageResource({
    status: resourceView.status,
    isVisible: resourceView.isVisible,
    isNearViewport: resourceView.isNearViewport,
    src: requestUrl,
  }, mode) : resourceView.shouldAutoRequest;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!shouldAutoRequest) {
      return;
    }

    void request();
  }, [enabled, mode, request, requestUrl, shouldAutoRequest]);

  const resolvedSrc = useMemo(() => {
    const decodedSrc = state.decodedResource?.src;
    if (decodedSrc) {
      return decodedSrc;
    }

    const rawSrc = resourceView.src;
    if (!rawSrc) {
      return undefined;
    }

    if (isProtectedResourceUrl(rawSrc)) {
      return undefined;
    }

    return rawSrc;
  }, [resourceView.src, state.decodedResource?.src]);
  const reportRenderableFailure = useCallback((attemptedSrc?: string, reason = 'Renderable image source failed') => {
    const source = attemptedSrc ?? resolvedSrc ?? requestUrl;
    if (!source) {
      return;
    }

    imageManager.reportRenderableSourceFailure(nodeId, source, mode, reason);
  }, [mode, nodeId, requestUrl, resolvedSrc]);

  return {
    src: resolvedSrc,
    status: resourceView.status,
    phase: resourceView.phase,
    error: resourceView.error,
    preview: previewSnapshot,
    isVisible: resourceView.isVisible,
    isNearViewport: resourceView.isNearViewport,
    displayWidth: resourceView.displayWidth,
    displayHeight: resourceView.displayHeight,
    placeholder: resourceView.placeholder,
    request,
    release,
    viewer: resourceView.viewer,
    decoded: resourceView.decoded,
    debug: resourceView.debug,
    shouldAutoRequest,
    requestUrl,
    reportRenderableFailure,
  };
}
