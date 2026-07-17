import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeProps, useReactFlow } from 'reactflow';

import type { AnyNodeData, FileNodeData } from '../../../types';
import { NodeErrorBoundary } from '../../ui/ErrorBoundary';
import { NODE_TYPE_INFO } from '../../../constants';
import { buildFileNodeMediaLayoutPatch, createModuleLogger, createWorkflowRuntimeSnapshot } from '../../../utils';
import {
  recordCanvasFileNodeCommit,
  recordCanvasFileNodeRender,
  recordCanvasUploadSnapshotRead,
  shouldRecordCanvasFileNodeDiagnostics,
} from '../../../utils/performance';
import {
  getRenderableImageUrls,
  hasRenderableImagePreview,
  reportNodeImageLoadFailure,
} from '../../../services/image';
import { browserFileService } from '@/services/browser-file';
import {
  getExecutionOutputRuntimeResource,
  registerExecutionOutputNodeRuntimeSource,
  subscribeExecutionOutputNodeRuntime,
  unregisterExecutionOutputNodeRuntimeSource,
} from '../../../services/execution-output-runtime-sync';
import { useProtectedResourceUrl } from '../../../hooks/file/useProtectedResourceUrl';
import { useImageResource } from '../../../hooks/image/useImageResource';
import { useNodeUploadSnapshot } from '../../../hooks/workflow/useNodeUploadSnapshot';
import { useWorkflowContext } from '../../context/useWorkflowContext';
import {
  consumeCanvasNodeViewerOpenRequest,
  useCanvasNodeViewerOpenRequest,
} from '../../canvas/canvas-active-node-state';
import { useCanvasImageFirstPainted } from '../../canvas/canvas-image-first-paint-store';
import { useCanvasRasterReadyItem } from '../../canvas/canvas-raster-ready-store';
import {
  clearCanvasNodeLocalActiveState,
  syncCanvasNodeLocalActiveState,
  useCanvasRuntimeVisualState,
} from '../../canvas/canvas-runtime-visual-state';
import { setFileNodeLayoutRuntimeSnapshot } from './file-node-layout-runtime-store';
import { flushMediaLayoutRuntimeSync, scheduleMediaLayoutRuntimeSync } from './media-layout-runtime-sync';
import { areImageNodePropsEqual, arePlyNodePropsEqual, areVideoNodePropsEqual } from './file-node-equality';
import { FileNodeActionLayer } from './FileNodeActionLayer';
import { FileNodeCanvasShell } from './FileNodeCanvasShell';
import { FileNodeViewerLayer } from './FileNodeViewerLayer';
import { useNodeRuntimeBindings } from '@/nodes/runtime-bindings';
import {
  resolveNodeResizeScale,
  useNodeResizeInteraction,
} from '../../../nodes/shared/useNodeResizeInteraction';
import {
  clampScale,
  FILE_NODE_ACTION_LAYER_DELAY_MS,
  ROTATION_SNAP,
  formatFileNodeDuration,
  formatFileNodeFileSize,
  resolveImageNodePreviewDisplay,
  shouldMountFileNodeActionLayer,
} from './constants';

const log = createModuleLogger('file-node');
const PREVIEW_VIDEO_RESOURCE_RELEASE_GRACE_MS = 160;

interface FileNodeProps extends NodeProps<FileNodeData> {}

const stopPointerEvent = (event: React.MouseEvent | React.PointerEvent): void => {
  event.preventDefault();
  event.stopPropagation();
};

const FileNodeInner: React.FC<FileNodeProps> = ({ data, selected, dragging = false }) => {
  const { actions, workflowId } = useNodeRuntimeBindings();
  const { actions: workflowActions } = useWorkflowContext();
  const { setNodes, setEdges, getNodes, getEdges, getViewport } = useReactFlow<AnyNodeData>();

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const rebindFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastMediaLayoutSignatureRef = useRef<string | null>(null);

  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isCanvasImageElementReady, setIsCanvasImageElementReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRebinding, setIsRebinding] = useState(false);
  const [viewerStatus, setViewerStatus] = useState<string | undefined>(undefined);
  const [actionsMounted, setActionsMounted] = useState(selected);
  const [retainPreviewVideoResource, setRetainPreviewVideoResource] = useState(false);
  const [runtimePreviewVideoUrl, setRuntimePreviewVideoUrl] = useState<string | undefined>(undefined);
  const lastCanvasImageSrcRef = useRef<string | undefined>(undefined);

  const nodeInfo = NODE_TYPE_INFO[data.type];
  const nodeColor = nodeInfo?.color || '#3b82f6';
  const nodeIcon = nodeInfo?.icon || 'FILE';
  const isInteractionActive = isResizing || isRotating || isPreviewPlaying;
  const viewerOpenRequestToken = useCanvasNodeViewerOpenRequest(data.id.value);
  const uploadSnapshot = useNodeUploadSnapshot(data, { workflowId });
  const runtimeVisualState = useCanvasRuntimeVisualState(data.id.value, 'full');

  useEffect(() => {
    if (!import.meta.env?.DEV) {
      return;
    }

    recordCanvasUploadSnapshotRead(data.id.value);
  }, [data.id.value, uploadSnapshot]);

  useEffect(() => {
    if (selected) {
      setActionsMounted(true);
      return;
    }

    if (!actionsMounted || isResizing || isRotating || isPreviewPlaying || isPreviewModalOpen || isImageViewerOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActionsMounted(false);
    }, FILE_NODE_ACTION_LAYER_DELAY_MS);

    return (): void => {
      window.clearTimeout(timeoutId);
    };
  }, [
    actionsMounted,
    isImageViewerOpen,
    isPreviewModalOpen,
    isPreviewPlaying,
    isResizing,
    isRotating,
    selected,
  ]);

  useEffect(() => {
    if (data.type !== 'video') {
      setRetainPreviewVideoResource(false);
      return;
    }

    const shouldKeepPreviewVideoWarm =
      runtimeVisualState.renderTier === 'full' ||
      runtimeVisualState.activeState === 'active' ||
      isPreviewModalOpen ||
      isPreviewPlaying;

    if (shouldKeepPreviewVideoWarm) {
      setRetainPreviewVideoResource(true);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRetainPreviewVideoResource(false);
    }, PREVIEW_VIDEO_RESOURCE_RELEASE_GRACE_MS);

    return (): void => {
      window.clearTimeout(timeoutId);
    };
  }, [
    data.type,
    isPreviewModalOpen,
    isPreviewPlaying,
    runtimeVisualState.activeState,
    runtimeVisualState.renderTier,
  ]);

  useEffect(() => {
    if (data.type !== 'image' || viewerOpenRequestToken <= 0) {
      return;
    }

    consumeCanvasNodeViewerOpenRequest(data.id.value);
    setActionsMounted(true);
    setIsImageViewerOpen(true);
  }, [data.id.value, data.type, viewerOpenRequestToken]);

  const renderableImageUrls = data.type === 'image' ? getRenderableImageUrls(data) : undefined;
  const imageThumbnailUrl = renderableImageUrls?.thumbnailUrl;
  const localActiveReasons = useMemo(() => {
    const reasons: Array<
      'upload-active' |
      'viewer' |
      'preview-modal' |
      'preview-playing' |
      'resizing' |
      'rotating'
    > = [];

    if (uploadSnapshot?.status && ['waiting', 'hashing', 'registering', 'uploading'].includes(uploadSnapshot.status)) {
      reasons.push('upload-active');
    }
    if (isImageViewerOpen) {
      reasons.push('viewer');
    }
    if (isPreviewModalOpen) {
      reasons.push('preview-modal');
    }
    if (isPreviewPlaying) {
      reasons.push('preview-playing');
    }
    if (isResizing) {
      reasons.push('resizing');
    }
    if (isRotating) {
      reasons.push('rotating');
    }

    return reasons;
  }, [
    isImageViewerOpen,
    isPreviewModalOpen,
    isPreviewPlaying,
    isResizing,
    isRotating,
    uploadSnapshot?.status,
  ]);
  const forceFullDomImageFallback = data.type === 'image' &&
    data.renderTier === 'full' &&
    data.imageResourceOwner === 'dom';
  const renderTier = forceFullDomImageFallback
    ? 'full'
    : runtimeVisualState.renderTier;
  const plannedImageResourceOwner = data.type === 'image'
    ? data.imageResourceOwner ?? (renderTier === 'minimal' ? 'none' : 'dom')
    : 'none';
  const previewVideoUrl = data.type === 'video'
    ? runtimePreviewVideoUrl ?? data.previewUrl
    : undefined;
  const shouldResolvePreviewVideo = data.type === 'video' && (
    renderTier === 'full' ||
    retainPreviewVideoResource
  );
  const rasterFirstPaintProbe = useImageResource(data, 'canvas', {
    enabled: false,
  });
  const rasterFirstPaintProbeSrc = data.type === 'image' ? rasterFirstPaintProbe.src : undefined;
  if (rasterFirstPaintProbeSrc) {
    lastCanvasImageSrcRef.current = rasterFirstPaintProbeSrc;
  }
  const hasRasterFirstPainted = useCanvasImageFirstPainted(
    data.id.value,
    data.type === 'image' ? lastCanvasImageSrcRef.current : undefined,
  );
  const hasRasterReadyItem = useCanvasRasterReadyItem(
    data.id.value,
    data.type === 'image' ? lastCanvasImageSrcRef.current : undefined,
  );
  const canUseStableRasterPreview = hasRasterFirstPainted &&
    hasRasterReadyItem &&
    !forceFullDomImageFallback;
  const imageResourceOwner = data.type === 'image' && plannedImageResourceOwner === 'dom' && canUseStableRasterPreview && runtimeVisualState.activeState !== 'active'
    ? 'raster'
    : plannedImageResourceOwner;
  const canvasImageResourceEnabled = data.type === 'image' && imageResourceOwner === 'dom';
  const imageResource = useImageResource(data, 'canvas', {
    enabled: canvasImageResourceEnabled,
  });
  const previewVideoResource = useProtectedResourceUrl(shouldResolvePreviewVideo ? previewVideoUrl : undefined);
  const imageSrc = data.type === 'image'
    ? imageResource.src
    : undefined;
  if (imageSrc) {
    lastCanvasImageSrcRef.current = imageSrc;
  }
  const previewVideoSrc = data.type === 'video' ? previewVideoResource.resolvedUrl : undefined;
  const canvasRequestDebug = data.type === 'image' ? imageResource.debug : undefined;
  const shouldMountViewerLayer = renderTier === 'full' || isPreviewModalOpen || isImageViewerOpen;
  const suppressImageDomPreview = data.type === 'image' &&
    renderTier === 'full' &&
    runtimeVisualState.activeState !== 'active' &&
    (imageResource.isVisible || imageResource.isNearViewport) &&
    canUseStableRasterPreview &&
    imageResource.decoded.kind !== 'display-url';
  const suppressImageRasterOwnedPreview = data.type === 'image' &&
    imageResourceOwner === 'raster' &&
    canUseStableRasterPreview;
  const isFullDomMediaNode =
    renderTier === 'full' &&
    (data.type !== 'image' || imageResourceOwner === 'dom');
  const isMediaLayoutInteractionActive =
    runtimeVisualState.activeState === 'active' ||
    selected ||
    dragging ||
    isImageViewerOpen ||
    isPreviewModalOpen ||
    isPreviewPlaying ||
    isResizing ||
    isRotating;
  const shouldCommitMediaLayoutImmediately =
    isFullDomMediaNode && isMediaLayoutInteractionActive;
  const mediaLayoutCommitMode = shouldCommitMediaLayoutImmediately
    ? 'active-full-dom'
    : 'runtime-snapshot';

  const hasRenderablePreview = hasRenderableImagePreview(data);
  const previewState = data.type === 'image' ? imageResource.preview : null;
  const isImportPlaceholder =
    data.status === 'pending' ||
    (data.type !== 'image' && data.status === 'processing' && !hasRenderablePreview);
  const isImportError = data.status === 'error' || previewState?.status === 'error';
  const imagePreviewDisplay = data.type !== 'image'
    ? 'empty'
    : suppressImageRasterOwnedPreview
      ? 'ready'
    : resolveImageNodePreviewDisplay({
      previewState: {
        status: previewState?.status ?? null,
        hasRenderablePreview,
      },
      resourceState: {
        placeholder: imageResource.placeholder,
        hasImageSrc: Boolean(imageSrc),
        status: imageResource.status,
        preferStableLoading: true,
      },
      businessState: {
        isImportError: data.status === 'error',
      },
    });
  const imagePreviewDiagnosticState = data.type !== 'image'
    ? 'default'
    : imagePreviewDisplay === 'viewport-hidden'
      ? 'hidden'
      : imagePreviewDisplay === 'loading'
        ? 'loading'
        : imagePreviewDisplay === 'unavailable'
          ? 'unavailable'
          : imagePreviewDisplay === 'ready'
            ? 'ready'
            : 'default';
  const isCanvasImageReady = data.type === 'image'
    ? Boolean(imageSrc) && (
      isCanvasImageElementReady ||
      !imageResource.src ||
      imageResource.decoded.kind !== 'display-url'
    )
    : false;

  const baseDimensions = useMemo(() => {
    const scale = data.scale || 1;
    return {
      width: data.dimensions.width / scale,
      height: data.dimensions.height / scale,
    };
  }, [data.dimensions.height, data.dimensions.width, data.scale]);

  useEffect(() => {
    if (data.source?.type !== 'node-output') {
      return;
    }

    registerExecutionOutputNodeRuntimeSource(data.id.value, data.fileId, {
      workflowId,
    });
    return () => {
      unregisterExecutionOutputNodeRuntimeSource(data.id.value, data.fileId);
    };
  }, [data.fileId, data.id.value, data.source?.type, workflowId]);

  const bottomInfoText = useMemo(() => {
    const segments = [formatFileNodeFileSize(data.fileSize)];
    if (data.metadata.width && data.metadata.height) {
      segments.push(`${data.metadata.width} x ${data.metadata.height}`);
    }
    if (data.type === 'video' && data.metadata.duration) {
      segments.push(formatFileNodeDuration(data.metadata.duration));
    }
    if (uploadSnapshot) {
      const syncLabel = uploadSnapshot.status === 'ready'
        ? 'synced'
        : uploadSnapshot.status === 'failed'
          ? 'sync failed'
          : `sync ${uploadSnapshot.status}`;
      segments.push(syncLabel);
    }
    return segments.join(' | ');
  }, [data.fileSize, data.metadata.duration, data.metadata.height, data.metadata.width, data.type, uploadSnapshot]);

  const buildUpdatedNodes = useCallback((
    currentNodes: ReturnType<typeof getNodes>,
    updates: Partial<FileNodeData> | ((currentData: FileNodeData) => Partial<FileNodeData> | null | undefined),
  ) => {
    const nextNodes = currentNodes.map((node) => {
      if (node.id !== data.id.value) {
        return node;
      }

      const currentData = node.data as FileNodeData;
      const nextUpdates = typeof updates === 'function' ? updates(currentData) : updates;
      if (!nextUpdates) {
        return node;
      }

      return {
        ...node,
        data: {
          ...currentData,
          ...nextUpdates,
          timestamp: {
            ...currentData.timestamp,
            updated: Date.now(),
          },
        },
      };
    });

    return {
      nextNodes,
    };
  }, [data.id.value]);

  const syncRuntimeSnapshot = useCallback((nextNodes = getNodes(), nextEdges = getEdges()): void => {
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, getEdges, getNodes, getViewport]);

  const updateCurrentNodeLocal = useCallback((
    updates: Partial<FileNodeData> | ((currentData: FileNodeData) => Partial<FileNodeData> | null | undefined),
  ): void => {
    setNodes((currentNodes) => buildUpdatedNodes(currentNodes, updates).nextNodes);
  }, [buildUpdatedNodes, setNodes]);

  const persistCurrentNodePatch = useCallback((
    updates: Partial<FileNodeData> | ((currentData: FileNodeData) => Partial<FileNodeData> | null | undefined),
  ): void => {
    workflowActions.patchCurrentWorkflow((currentWorkflow) => {
      const currentNode = currentWorkflow.nodes[data.id.value];
      if (!currentNode || currentNode.type !== data.type) {
        return currentWorkflow;
      }

      const typedCurrentNode = currentNode as FileNodeData;
      const nextUpdates = typeof updates === 'function' ? updates(typedCurrentNode) : updates;
      if (!nextUpdates) {
        return currentWorkflow;
      }

      const updatedAt = Date.now();
      const nextNode: FileNodeData = {
        ...typedCurrentNode,
        ...nextUpdates,
        timestamp: {
          ...typedCurrentNode.timestamp,
          updated: updatedAt,
        },
      };

      return {
        ...currentWorkflow,
        nodes: {
          ...currentWorkflow.nodes,
          [data.id.value]: nextNode,
        },
        timestamp: {
          ...currentWorkflow.timestamp,
          updated: updatedAt,
        },
      };
    });
  }, [data.id.value, data.type, workflowActions]);

  useEffect(() => {
    if (data.type !== 'video' || data.source?.type !== 'node-output') {
      setRuntimePreviewVideoUrl(undefined);
      return;
    }

    const runtimeResource = getExecutionOutputRuntimeResource(data.fileId);
    setRuntimePreviewVideoUrl(
      runtimeResource?.fileType === 'video'
        ? runtimeResource.objectUrl
        : undefined,
    );

    return subscribeExecutionOutputNodeRuntime(data.fileId, (resource) => {
      if (resource.fileType !== 'video') {
        return;
      }

      setRuntimePreviewVideoUrl((current) => (
        current === resource.objectUrl ? current : resource.objectUrl
      ));
    });
  }, [data.fileId, data.source?.type, data.type]);

  useEffect(() => {
    syncCanvasNodeLocalActiveState(data.id.value, {
      activeState: localActiveReasons.length > 0 ? 'active' : 'passive',
      activeReasons: localActiveReasons,
    });
  }, [data.id.value, localActiveReasons]);

  useEffect(() => (
    () => {
      clearCanvasNodeLocalActiveState(data.id.value);
    }
  ), [data.id.value]);

  const syncMediaLayout = useCallback((width: number, height: number, duration?: number): void => {
    const normalizedDuration =
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? Number(duration.toFixed(3))
        : undefined;
    const layoutSignature = [width, height, normalizedDuration ?? '', mediaLayoutCommitMode].join(':');
    if (lastMediaLayoutSignatureRef.current === layoutSignature) {
      return;
    }

    const patch = buildFileNodeMediaLayoutPatch(data, width, height, normalizedDuration);
    if (!patch) {
      lastMediaLayoutSignatureRef.current = layoutSignature;
      return;
    }

    lastMediaLayoutSignatureRef.current = layoutSignature;
    if (!shouldCommitMediaLayoutImmediately) {
      setFileNodeLayoutRuntimeSnapshot({
        nodeId: data.id.value,
        fileId: data.fileId,
        nodeType: data.type,
        width,
        height,
        duration: normalizedDuration,
        reason: 'media-layout-runtime-snapshot',
      });
      return;
    }

    updateCurrentNodeLocal((currentData) => buildFileNodeMediaLayoutPatch(currentData, width, height, normalizedDuration));
    persistCurrentNodePatch((currentData) => buildFileNodeMediaLayoutPatch(currentData, width, height, normalizedDuration));
  }, [
    data,
    mediaLayoutCommitMode,
    persistCurrentNodePatch,
    shouldCommitMediaLayoutImmediately,
    updateCurrentNodeLocal,
  ]);

  useEffect(() => {
    if (!shouldCommitMediaLayoutImmediately) {
      return;
    }

    scheduleMediaLayoutRuntimeSync({
      reason: 'media-layout-node-active',
    });
  }, [shouldCommitMediaLayoutImmediately]);

  const handleDelete = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    stopPointerEvent(event);
    flushMediaLayoutRuntimeSync({
      reason: 'media-layout-before-delete',
      force: true,
    });

    const currentEdges = getEdges();
    const relatedConnections = currentEdges.filter((edge) => edge.source === data.id.value || edge.target === data.id.value);

    if (relatedConnections.length > 0) {
      const confirmed = window.confirm(`该节点存在 ${relatedConnections.length} 条连接，确认删除吗？`);
      if (!confirmed) {
        return;
      }
    }

    const nextNodes = getNodes().filter((node) => node.id !== data.id.value);
    const nextEdges = currentEdges.filter((edge) => edge.source !== data.id.value && edge.target !== data.id.value);
    setNodes(nextNodes);
    setEdges(nextEdges);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, data.id.value, getEdges, getNodes, getViewport, setEdges, setNodes]);

  const handleExport = useCallback(async (event: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    stopPointerEvent(event);

    if (isExporting) {
      return;
    }

    setIsExporting(true);
    try {
      await actions.exportFileNode(data.id.value);
    } finally {
      setIsExporting(false);
    }
  }, [actions, data.id.value, isExporting]);

  const handleRebind = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    stopPointerEvent(event);
    if (data.type !== 'image' || isRebinding) {
      return;
    }

    if (!browserFileService.supportsFileSystemAccessFilePicker()) {
      rebindFileInputRef.current?.click();
      return;
    }

    setIsRebinding(true);
    void browserFileService.pickFilesWithHandles({
      multiple: false,
      types: [
        {
          description: 'Image files',
          accept: {
            'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'],
          },
        },
      ],
    }).then((picked) => {
      if (!picked.success) {
        rebindFileInputRef.current?.click();
        return;
      }

      const selected = picked.data?.[0];
      if (!selected) {
        return;
      }

      return actions.rebindLocalFileNodeSource(data.id.value, selected.file, {
        localSourceHandle: selected.handle,
      }).then((reboundNode) => {
        if (!reboundNode) {
          return;
        }

        updateCurrentNodeLocal(reboundNode);
        persistCurrentNodePatch(reboundNode);
      });
    }).finally(() => {
      setIsRebinding(false);
    });
  }, [
    actions,
    data.id.value,
    data.type,
    isRebinding,
    persistCurrentNodePatch,
    updateCurrentNodeLocal,
  ]);

  const handleRebindFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || data.type !== 'image' || isRebinding) {
      return;
    }

    setIsRebinding(true);
    void actions.rebindLocalFileNodeSource(data.id.value, file)
      .then((reboundNode) => {
        if (!reboundNode) {
          return;
        }

        updateCurrentNodeLocal(reboundNode);
        persistCurrentNodePatch(reboundNode);
      })
      .finally(() => {
        setIsRebinding(false);
      });
  }, [actions, data.id.value, data.type, isRebinding, persistCurrentNodePatch, updateCurrentNodeLocal]);

  const handleResizeStart = useNodeResizeInteraction<Partial<FileNodeData>>({
    captureElementRef: wrapperRef,
    getViewportZoom: () => getViewport().zoom,
    resolveUpdate: ({ screenDelta, zoom }) => resolveNodeResizeScale({
      startDimensions: data.dimensions,
      baseDimensions,
      startScale: data.scale || 1,
      screenDelta,
      zoom,
      clampScale,
    }),
    applyUpdate: updateCurrentNodeLocal,
    onResizeStart: () => {
      setActionsMounted(true);
      setIsResizing(true);
    },
    onResizeEnd: () => setIsResizing(false),
    onCommit: () => syncRuntimeSnapshot(),
  });

  const handleRotateStart = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    stopPointerEvent(event);
    if (!wrapperRef.current) {
      return;
    }

    const pointerId = event.pointerId;
    const rect = wrapperRef.current.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const startRotation = data.rotation || 0;
    const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x) * (180 / Math.PI);
    let frameId = 0;
    let pendingRotation: Partial<FileNodeData> | null = null;
    setActionsMounted(true);
    setIsRotating(true);

    const flushPendingRotation = (): void => {
      frameId = 0;
      if (!pendingRotation) {
        return;
      }

      updateCurrentNodeLocal(pendingRotation);
      pendingRotation = null;
    };

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const currentAngle = Math.atan2(moveEvent.clientY - center.y, moveEvent.clientX - center.x) * (180 / Math.PI);
      let nextRotation = startRotation + (currentAngle - startAngle);
      if (moveEvent.shiftKey) {
        nextRotation = Math.round(nextRotation / ROTATION_SNAP) * ROTATION_SNAP;
      }
      pendingRotation = { rotation: nextRotation };

      if (frameId === 0) {
        frameId = window.requestAnimationFrame(flushPendingRotation);
      }
    };

    const handlePointerUp = (): void => {
      setIsRotating(false);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      flushPendingRotation();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      wrapperRef.current?.releasePointerCapture?.(pointerId);
      syncRuntimeSnapshot();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    wrapperRef.current.setPointerCapture?.(pointerId);
  }, [data.rotation, syncRuntimeSnapshot, updateCurrentNodeLocal]);

  const handlePreviewPlay = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    stopPointerEvent(event);
    setActionsMounted(true);
    if (!previewVideoRef.current) {
      return;
    }

    previewVideoRef.current.muted = true;
    previewVideoRef.current.playsInline = true;
    void previewVideoRef.current.play().then(() => {
      setIsPreviewPlaying(true);
    }).catch(() => {
      log.warn('handlePreviewPlay', `Failed to start preview: ${data.fileName}`);
    });
  }, [data.fileName]);

  const handlePreviewPause = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    stopPointerEvent(event);
    previewVideoRef.current?.pause();
    if (previewVideoRef.current) {
      previewVideoRef.current.currentTime = 0;
    }
    setIsPreviewPlaying(false);
  }, []);

  const handleVideoDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    stopPointerEvent(event);
    setActionsMounted(true);
    setIsPreviewPlaying(false);
    previewVideoRef.current?.pause();
    setIsPreviewModalOpen(true);
  }, []);

  const handleImageDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    stopPointerEvent(event);
    if (data.type !== 'image') {
      return;
    }

    setActionsMounted(true);
    setIsImageViewerOpen(true);
  }, [data.type]);

  const handleImageError = useCallback(() => {
    reportNodeImageLoadFailure(data.id.value, data.fileName, 'canvas', {
      requestKey: imageResource.debug.requestKey,
      attemptedUrl: imageResource.debug.lastAttemptedUrl ?? imageResource.src,
    });
    log.warn('handleImageError', `Failed to load image: ${data.fileName}`, {
      nodeId: data.id.value,
      attemptedUrl: imageResource.debug.lastAttemptedUrl ?? imageResource.src,
    });
  }, [
    data.fileName,
    data.id.value,
    imageResource.debug.lastAttemptedUrl,
    imageResource.debug.requestKey,
    imageResource.src,
  ]);

  const handleVideoError = useCallback(() => {
    setVideoReady(false);
    updateCurrentNodeLocal({ status: 'error' });
    persistCurrentNodePatch({ status: 'error' });
    log.warn('handleVideoError', `Failed to load video: ${data.fileName}`);
  }, [data.fileName, persistCurrentNodePatch, updateCurrentNodeLocal]);

  const handleVideoLoadedMetadata = useCallback((event: React.SyntheticEvent<HTMLVideoElement>): void => {
    const { videoWidth, videoHeight, duration } = event.currentTarget;
    syncMediaLayout(videoWidth, videoHeight, duration);
  }, [syncMediaLayout]);

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>): void => {
    setIsCanvasImageElementReady(true);
    syncMediaLayout(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
  }, [syncMediaLayout]);

  useEffect(() => {
    setIsCanvasImageElementReady(false);
  }, [imageResource.src]);

  useEffect(() => {
    if (
      data.type !== 'image' ||
      !suppressImageDomPreview ||
      imageResource.decoded.width <= 0 ||
      imageResource.decoded.height <= 0
    ) {
      return;
    }

    setIsCanvasImageElementReady(true);
    syncMediaLayout(imageResource.decoded.width, imageResource.decoded.height);
  }, [
    data.type,
    imageResource.decoded.height,
    imageResource.decoded.width,
    suppressImageDomPreview,
    syncMediaLayout,
  ]);

  useEffect(() => {
    setVideoReady(false);
  }, [data.imageAsset?.version, data.thumbnailUrl, imageThumbnailUrl, previewVideoUrl]);

  useEffect(() => {
    lastMediaLayoutSignatureRef.current = null;
  }, [
    data.fileId,
    data.id.value,
    data.metadata.duration,
    data.metadata.height,
    data.metadata.width,
    data.type,
    imageResource.src,
    previewVideoSrc,
  ]);

  useEffect(() => {
    if (!import.meta.env?.DEV || data.type !== 'image') {
      return;
    }

    const diagnosticSignature = [
      data.status,
      selected ? 'selected' : 'idle',
      dragging ? 'dragging' : 'steady',
      imagePreviewDiagnosticState,
      renderTier,
      isImageViewerOpen ? viewerStatus ?? '' : '',
      imageResource.status,
      imageResource.phase,
      imageResource.debug.requestKey ?? '',
      imageResource.debug.lastEventKind ?? '',
      imageResource.debug.lastEventClassification ?? '',
      imageResource.debug.lastSwitchReason ?? '',
      imageResource.debug.lastAttemptedUrl ?? '',
      imageResourceOwner,
      imageResource.isVisible ? 'visible' : 'hidden',
      imageResource.isNearViewport ? 'near' : 'far',
      imageResource.displayWidth ?? '',
      imageResource.displayHeight ?? '',
    ].join('|');

    if (!shouldRecordCanvasFileNodeDiagnostics({
      nodeId: data.id.value,
      signature: diagnosticSignature,
      force: imageResource.debug.lastEventKind === 'load-succeeded' || imageResource.debug.lastEventKind === 'load-failed',
    })) {
      return;
    }

    recordCanvasFileNodeCommit({
      nodeId: data.id.value,
      nodeType: data.type,
      fileName: data.fileName,
      selected,
      dragging,
      status: data.status,
      placeholder: data.type === 'image'
        ? imagePreviewDiagnosticState
        : isImportError
          ? 'default'
          : isImportPlaceholder
            ? 'loading'
            : 'ready',
      renderTier,
      activeState: runtimeVisualState.activeState,
      activeVariantKind: data.type === 'image'
        ? imageResource.viewer.activeVariantKind
        : undefined,
      viewerStatus: data.type === 'image' && isImageViewerOpen
        ? viewerStatus
        : undefined,
      requestKey: data.type === 'image'
        ? imageResource.debug.requestKey
        : undefined,
      requestEventKind: data.type === 'image'
        ? imageResource.debug.lastEventKind
        : undefined,
      requestEventClassification: data.type === 'image'
        ? imageResource.debug.lastEventClassification
        : undefined,
      requestEventReason: data.type === 'image'
        ? imageResource.debug.lastEventReason
        : undefined,
      requestSwitchReason: data.type === 'image'
        ? imageResource.debug.lastSwitchReason
        : undefined,
      attemptedUrl: data.type === 'image'
        ? imageResource.debug.lastAttemptedUrl
        : undefined,
      src: data.type === 'image'
        ? imageResource.src
        : undefined,
      resourceStatus: data.type === 'image'
        ? imageResource.status
        : undefined,
      resourcePhase: data.type === 'image'
        ? imageResource.phase
        : undefined,
      isVisible: data.type === 'image'
        ? imageResource.isVisible
        : undefined,
      isNearViewport: data.type === 'image'
        ? imageResource.isNearViewport
        : undefined,
      displayWidth: data.type === 'image'
        ? imageResource.displayWidth
        : undefined,
      displayHeight: data.type === 'image'
        ? imageResource.displayHeight
        : undefined,
    });
  }, [
    data.fileName,
    data.id.value,
    data.status,
    data.type,
    dragging,
    imageResource.debug.lastAttemptedUrl,
    imageResource.debug.lastEventClassification,
    imageResource.debug.lastEventKind,
    imageResource.debug.lastEventReason,
    imageResource.debug.lastSwitchReason,
    imageResource.debug.requestKey,
    imageResource.displayHeight,
    imageResource.displayWidth,
    imageResourceOwner,
    imageResource.isNearViewport,
    imageResource.isVisible,
    imageResource.phase,
    imagePreviewDiagnosticState,
    imageResource.src,
    imageResource.status,
    imageResource.viewer.activeVariantKind,
    isImageViewerOpen,
    isImportError,
    isImportPlaceholder,
    renderTier,
    runtimeVisualState.activeState,
    selected,
    suppressImageRasterOwnedPreview,
    viewerStatus,
  ]);

  const actionLayerVisible = shouldMountFileNodeActionLayer({
    selected,
    isResizing,
    isRotating,
    isPreviewPlaying,
    isPreviewModalOpen,
    isImageViewerOpen,
  });

  return (
    <React.Profiler
      id={`FileNode:${data.id.value}`}
      onRender={(_id, phase, actualDuration) => {
        if (!import.meta.env?.DEV || (phase !== 'mount' && phase !== 'update')) {
          return;
        }

        recordCanvasFileNodeRender({
          nodeId: data.id.value,
          nodeType: data.type,
          fileName: data.fileName,
          commitDurationMs: actualDuration,
          dragging,
        });
      }}
    >
      <>
        <input
          ref={rebindFileInputRef}
          className="file-node__rebind-input"
          type="file"
          accept="image/*"
          onChange={handleRebindFileChange}
        />
        <FileNodeCanvasShell
          data={data}
          selected={selected}
          dragging={dragging}
          nodeColor={nodeColor}
          nodeIcon={nodeIcon}
          wrapperRef={wrapperRef}
          previewVideoRef={previewVideoRef}
          imageResource={imageResource}
          imageSrc={imageSrc}
          previewVideoSrc={previewVideoSrc}
          imageThumbnailUrl={imageThumbnailUrl}
          bottomInfoText={bottomInfoText}
          isInteractionActive={isInteractionActive}
          isImportPlaceholder={isImportPlaceholder}
          isImportError={isImportError}
          imagePreviewDisplay={imagePreviewDisplay}
          hasRenderablePreview={hasRenderablePreview}
          isCanvasImageReady={isCanvasImageReady}
          videoReady={videoReady}
          isPreviewPlaying={isPreviewPlaying}
          renderTier={renderTier}
          imageResourceOwner={data.type === 'image' ? imageResourceOwner : undefined}
          suppressImageDomPreview={suppressImageDomPreview || suppressImageRasterOwnedPreview}
          onImageDoubleClick={handleImageDoubleClick}
          onVideoDoubleClick={handleVideoDoubleClick}
          onImageLoad={handleImageLoad}
          onImageError={handleImageError}
          onVideoLoadedMetadata={handleVideoLoadedMetadata}
          onVideoLoadedData={() => setVideoReady(true)}
          onVideoError={handleVideoError}
          onVideoPause={() => setIsPreviewPlaying(false)}
          onVideoPlay={() => setIsPreviewPlaying(true)}
          onPreviewPlay={handlePreviewPlay}
          onPreviewPause={handlePreviewPause}
          canvasRequestDebug={canvasRequestDebug}
          viewerRequestKey={undefined}
          actionLayer={(
            <FileNodeActionLayer
              mounted={actionLayerVisible && actionsMounted}
              isExporting={isExporting}
              onRebind={data.type === 'image' ? handleRebind : undefined}
              onRotateStart={handleRotateStart}
              onExport={(event) => { void handleExport(event); }}
              onDelete={handleDelete}
              onResizeStart={handleResizeStart}
            />
          )}
        />
        {shouldMountViewerLayer && (
          <FileNodeViewerLayer
            data={data}
            imageViewerOpen={isImageViewerOpen}
            videoModalOpen={isPreviewModalOpen}
            previewVideoSrc={previewVideoSrc}
            onCloseImageViewer={() => setIsImageViewerOpen(false)}
            onCloseVideoModal={() => setIsPreviewModalOpen(false)}
            onViewerStatusChange={setViewerStatus}
          />
        )}
      </>
    </React.Profiler>
  );
};

FileNodeInner.displayName = 'FileNodeInner';

export const FileNode: React.FC<FileNodeProps> = (props) => (
  <NodeErrorBoundary nodeId={props.data.id.value} nodeType={props.data.type}>
    <FileNodeInner {...props} />
  </NodeErrorBoundary>
);

FileNode.displayName = 'FileNode';

export const ImageNode = memo((props: FileNodeProps) => <FileNode {...props} />, areImageNodePropsEqual);
ImageNode.displayName = 'ImageNode';

export const VideoNode = memo((props: FileNodeProps) => <FileNode {...props} />, areVideoNodePropsEqual);
VideoNode.displayName = 'VideoNode';

export const PLYNode = memo((props: FileNodeProps) => <FileNode {...props} />, arePlyNodePropsEqual);
PLYNode.displayName = 'PLYNode';
