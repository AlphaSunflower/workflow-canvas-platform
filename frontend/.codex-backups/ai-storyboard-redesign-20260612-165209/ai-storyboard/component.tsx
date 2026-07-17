import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, useReactFlow, useUpdateNodeInternals } from 'reactflow';

import type {
  AINodeData,
  AnyNodeData,
  FileNodeData,
  StoryboardConfig,
  StoryboardShotData,
  StoryboardViewMode,
} from '@/types';
import { NodeExecutionStatus } from '@/components/execution/NodeExecutionStatus';
import { NodeErrorBoundary } from '@/components/ui/ErrorBoundary';
import { NODE_TYPE_INFO } from '@/constants';
import { useNodeRuntimeBindings } from '@/nodes/runtime-bindings';
import { createWorkflowRuntimeSnapshot } from '@/utils';
import { useGroupedDropInteraction } from '../shared/grouped-drop/useGroupedDropInteraction';
import {
  resolveNodeResizeDimensions,
  useNodeResizeInteraction,
} from '../shared/useNodeResizeInteraction';
import type { AIStoryboardDropSide } from './drop';
import { resolveAIStoryboardInputGroups } from './groups';
import { resolveStoryboardInputImages } from './input-resolver';
import {
  getStoryboardExternalState,
  isStoryboardLocalStateEqual,
  mergeStoryboardShotsFromInputs,
} from './shot-sync';
import { resolveStoryboardGeneratedImagePreviewUrl } from './preview';
import {
  createStoryboardLocalStateKey,
  normalizeStoryboardShotImageConfig,
  normalizeStoryboardShotVideoConfig,
  getStoryboardShotDefaults,
  type StoryboardLocalState,
} from './types';
import { writeStoryboardLocalStateToNodeGraph } from './storyboard-state-service';
import { patchNodeConfigInGraph } from '../shared/node-config-updater';
import {
  AIStoryboardArrangeRequestController,
  resolveAIStoryboardArrangeAvailability,
} from './arrange';
import {
  AIStoryboardShotImageRequestController,
  resolveAIStoryboardShotImageAvailability,
} from './shot-image-execution';
import {
  AIStoryboardShotVideoRequestController,
  resolveAIStoryboardShotVideoAvailability,
} from './shot-video-execution';
import {
  AI_STORYBOARD_DESCRIPTION,
  AI_STORYBOARD_INPUT_PORT_ID,
  AI_STORYBOARD_MIN_HEIGHT,
  AI_STORYBOARD_MIN_WIDTH,
  AI_STORYBOARD_RESULT_PORT_ID,
} from './constants';
import {
  BatchVideoToolbar,
  ShotGridView,
  ShotListView,
  ShotTableView,
  StoryboardMetaBar,
  StoryboardToolbar,
  type StoryboardShotCollectionViewProps,
  type StoryboardShotImagePreview,
} from './views';

interface AIStoryboardNodeProps extends NodeProps<AINodeData> {}

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function buildSummaryText(imageCount: number, shotCount: number): string {
  if (imageCount === 0) {
    return '等待接入上游图片。当前分镜节点支持列表工作台、镜头参数编辑与批量操作。';
  }

  if (shotCount === 0) {
    return `已连接 ${imageCount} 张图片，尚未生成镜头条目。可直接添加空白镜头开始编辑。`;
  }

  return `已连接 ${imageCount} 张图片，当前共有 ${shotCount} 条分镜，可继续调整顺序、prompt 与视频参数。`;
}

function normalizeViewMode(value: unknown): StoryboardViewMode {
  return value === 'grid' || value === 'table' || value === 'list' ? value : 'list';
}

function createBlankShot(
  index: number,
  total: number,
  defaults: ReturnType<typeof getStoryboardShotDefaults>,
): StoryboardShotData {
  const order = index + 1;
  const uniqueId = `storyboard-manual-shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${order}`;

  return {
    id: uniqueId,
    order,
    row: index,
    col: 0,
    originalIndex: order,
    originalTotal: total,
    sourceNodeId: undefined,
    sourceFileId: undefined,
    sourceImageFileId: undefined,
    imageFileId: undefined,
    videoFileId: undefined,
    prompt: '',
    imageModel: defaults.defaultImageModel,
    imageAspectRatio: defaults.defaultImageAspectRatio,
    imageSize: defaults.defaultImageSize,
    videoModel: defaults.defaultVideoModel,
    videoDuration: defaults.defaultVideoDuration,
    videoAspectRatio: defaults.defaultVideoAspectRatio,
    videoResolution: defaults.defaultVideoResolution,
    imageGenStatus: 'idle',
    imageGenMessage: undefined,
    imageGenRunId: undefined,
    videoGenStatus: 'idle',
    videoProgress: undefined,
    videoError: undefined,
    videoRunId: undefined,
  };
}

function reorderStoryboardShots(shots: StoryboardShotData[]): StoryboardShotData[] {
  const total = shots.length;

  return shots.map((shot, index) => ({
    ...shot,
    order: index + 1,
    row: shot.row ?? index,
    col: shot.col ?? 0,
    originalIndex: shot.originalIndex ?? index + 1,
    originalTotal: total,
  }));
}

function mergePromptWithPrefix(prefix: string, prompt: string): string {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return prompt;
  }

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return trimmedPrefix;
  }

  return `${trimmedPrefix}\n${trimmedPrompt}`;
}

function findInputImageByShot(
  shot: StoryboardShotData,
  inputImages: ReturnType<typeof resolveStoryboardInputImages>,
): FileNodeData | undefined {
  if (shot.sourceNodeId) {
    const matchedByNodeId = inputImages.find((input) => input.sourceNodeId === shot.sourceNodeId);
    if (matchedByNodeId) {
      return matchedByNodeId.sourceNode;
    }
  }

  if (shot.sourceFileId || shot.sourceImageFileId) {
    const matchedByFileId = inputImages.find((input) => (
      input.sourceFileId === shot.sourceFileId
      || input.sourceImageFileId === shot.sourceImageFileId
    ));
    if (matchedByFileId) {
      return matchedByFileId.sourceNode;
    }
  }

  return undefined;
}

const AIStoryboardNodeInner: React.FC<AIStoryboardNodeProps> = ({
  data,
  selected,
}) => {
  const {
    actions,
    selectors,
    runtime,
    nodeExecutionRuntime,
  } = useNodeRuntimeBindings();
  const { getNodes, getEdges, getViewport, setNodes, setEdges } = useReactFlow<AnyNodeData>();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeInfo = NODE_TYPE_INFO[data.type];
  const nodeColor = nodeInfo?.color ?? '#f59e0b';
  const displayName = nodeInfo?.displayName ?? 'AI 分镜表';
  const executionState = nodeExecutionRuntime?.executionState ?? null;
  const isProcessing = nodeExecutionRuntime?.isProcessing ?? false;
  const shouldShowExecutionStatus = Boolean(executionState?.status);
  const { inputRegionProps, getPanelTargetProps, getSlotTargetProps } =
    useGroupedDropInteraction<AIStoryboardDropSide>();

  const groups = useMemo(() => resolveAIStoryboardInputGroups(data), [data]);
  const primaryGroupId = groups[0]?.id ?? 'group-1';
  const storyboardDefaults = useMemo(
    () => getStoryboardShotDefaults(data.config as Partial<StoryboardConfig>),
    [data.config],
  );
  const normalizedBatchVideoConfig = useMemo(() => normalizeStoryboardShotVideoConfig(
    {
      videoModel: data.config.batchVideoModel,
      videoAspectRatio: data.config.batchVideoAspectRatio,
      videoResolution: data.config.batchVideoResolution,
    },
    storyboardDefaults,
  ), [
    data.config.batchVideoAspectRatio,
    data.config.batchVideoModel,
    data.config.batchVideoResolution,
    storyboardDefaults,
  ]);
  const externalStoryboardState = useMemo(
    () => getStoryboardExternalState(data.config as Partial<StoryboardConfig>, storyboardDefaults),
    [data.config, storyboardDefaults],
  );
  const [storyboardState, setStoryboardState] = useState<StoryboardLocalState>(externalStoryboardState);
  const [viewMode, setViewMode] = useState<StoryboardViewMode>(normalizeViewMode(data.config.viewMode));
  const [batchPrefix, setBatchPrefix] = useState('');
  const [isArranging, setIsArranging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [batchVideoModel, setBatchVideoModel] = useState(normalizedBatchVideoConfig.videoModel);
  const [batchVideoDuration, setBatchVideoDuration] = useState<8>(storyboardDefaults.defaultVideoDuration);
  const [batchVideoAspectRatio, setBatchVideoAspectRatio] = useState(normalizedBatchVideoConfig.videoAspectRatio);
  const [batchVideoResolution, setBatchVideoResolution] = useState(normalizedBatchVideoConfig.videoResolution);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selfWriteStateKeyRef = useRef<string | null>(null);
  const resolvedInputs = selectors.getResolvedNodeInputGroups(data.id.value);
  const resolvedInputImages = useMemo(() => resolveStoryboardInputImages(
    resolvedInputs,
    { getNodeById: selectors.getNodeById },
  ), [resolvedInputs, selectors]);
  const imageCount = resolvedInputImages.length;
  const shotCount = storyboardState.shots.length;
  const summaryText = buildSummaryText(imageCount, shotCount);
  const arrangeRequestControllerRef = useRef(new AIStoryboardArrangeRequestController());
  const shotImageRequestControllersRef = useRef(new Map<string, AIStoryboardShotImageRequestController>());
  const shotVideoRequestControllersRef = useRef(new Map<string, AIStoryboardShotVideoRequestController>());
  const nodeWidth = Math.max(AI_STORYBOARD_MIN_WIDTH, data.dimensions.width);
  const nodeHeight = Math.max(AI_STORYBOARD_MIN_HEIGHT, data.dimensions.height);
  const arrangeAvailability = useMemo(() => (
    resolveAIStoryboardArrangeAvailability({
      shots: storyboardState.shots,
      isArranging,
    })
  ), [isArranging, storyboardState.shots]);

  const writeStoryboardStateToNode = useCallback((nextState: StoryboardLocalState): void => {
    const graphWriteResult = writeStoryboardLocalStateToNodeGraph({
      nodes: getNodes(),
      nodeId: data.id.value,
      nextState,
      defaults: storyboardDefaults,
    });

    if (!graphWriteResult.changed) {
      return;
    }

    selfWriteStateKeyRef.current = graphWriteResult.nextStateKey;
    setNodes(graphWriteResult.nextNodes);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(
      graphWriteResult.nextNodes,
      getEdges(),
      getViewport(),
    ));
  }, [
    actions,
    data.id.value,
    getEdges,
    getNodes,
    getViewport,
    setNodes,
    storyboardDefaults,
  ]);

  const updateNodeConfigFields = useCallback((patch: Partial<StoryboardConfig>): void => {
    const patchResult = patchNodeConfigInGraph<StoryboardConfig>({
      nodes: getNodes(),
      nodeId: data.id.value,
      expectedType: 'aiStoryboard',
      updater: () => patch,
    });

    if (!patchResult.changed) {
      return;
    }

    setNodes(patchResult.nextNodes);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(
      patchResult.nextNodes,
      getEdges(),
      getViewport(),
    ));
  }, [
    actions,
    data.id.value,
    getEdges,
    getNodes,
    getViewport,
    setNodes,
  ]);

  const syncRuntimeSnapshot = useCallback((): void => {
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(getNodes(), getEdges(), getViewport()));
  }, [actions, getEdges, getNodes, getViewport]);

  const updateNodeLocal = useCallback((updates: Partial<AINodeData>): void => {
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== data.id.value) {
        return node;
      }

      const currentData = node.data as AINodeData;
      const nextData: AINodeData = {
        ...currentData,
        ...updates,
        timestamp: {
          ...currentData.timestamp,
          updated: Date.now(),
        },
      };

      return {
        ...node,
        data: nextData,
        position: nextData.position,
      };
    }));
  }, [data.id.value, setNodes]);

  const handleDelete = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    stopPointerEvent(event);

    const currentEdges = getEdges();
    const relatedConnections = currentEdges.filter((edge) => (
      edge.source === data.id.value || edge.target === data.id.value
    ));

    if (relatedConnections.length > 0) {
      const confirmed = window.confirm(`删除该分镜节点会同时移除 ${relatedConnections.length} 条相关连接，是否继续？`);
      if (!confirmed) {
        return;
      }
    }

    const nextNodes = getNodes().filter((node) => node.id !== data.id.value);
    const nextEdges = currentEdges.filter((edge) => (
      edge.source !== data.id.value && edge.target !== data.id.value
    ));
    setNodes(nextNodes);
    setEdges(nextEdges);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, data.id.value, getEdges, getNodes, getViewport, setEdges, setNodes]);

  const handleResizeStart = useNodeResizeInteraction<Partial<AINodeData>>({
    captureElementRef: wrapperRef,
    getViewportZoom: () => getViewport().zoom,
    resolveUpdate: ({ screenDelta, zoom }) => ({
      dimensions: resolveNodeResizeDimensions({
        startDimensions: data.dimensions,
        minDimensions: {
          width: AI_STORYBOARD_MIN_WIDTH,
          height: AI_STORYBOARD_MIN_HEIGHT,
        },
        screenDelta,
        zoom,
      }),
    }),
    applyUpdate: updateNodeLocal,
    onResizeStart: () => setIsResizing(true),
    onResizeEnd: () => setIsResizing(false),
    onCommit: () => syncRuntimeSnapshot(),
  });

  const commitStoryboardState = useCallback((nextState: StoryboardLocalState): void => {
    setStoryboardState(nextState);
    writeStoryboardStateToNode(nextState);
  }, [writeStoryboardStateToNode]);

  const patchShot = useCallback((shotId: string, patch: Partial<StoryboardShotData>): void => {
    const nextShots = reorderStoryboardShots(
      storyboardState.shots.map((shot) => {
        if (shot.id !== shotId) {
          return shot;
        }

        const nextShot = {
          ...shot,
          ...patch,
        };

        const normalizedImageConfig = normalizeStoryboardShotImageConfig(
          {
            imageModel: nextShot.imageModel,
            imageAspectRatio: nextShot.imageAspectRatio,
            imageSize: nextShot.imageSize,
          },
          storyboardDefaults,
        );
        const normalizedVideoConfig = normalizeStoryboardShotVideoConfig(
          {
            videoModel: nextShot.videoModel,
            videoAspectRatio: nextShot.videoAspectRatio,
            videoResolution: nextShot.videoResolution,
          },
          storyboardDefaults,
        );

        return {
          ...nextShot,
          ...normalizedImageConfig,
          ...normalizedVideoConfig,
        };
      }),
    );

    commitStoryboardState({
      ...storyboardState,
      shots: nextShots,
    });
  }, [commitStoryboardState, storyboardDefaults, storyboardState]);

  const deleteShot = useCallback((shotId: string): void => {
    const nextShots = reorderStoryboardShots(
      storyboardState.shots.filter((shot) => shot.id !== shotId),
    );

    commitStoryboardState({
      ...storyboardState,
      shots: nextShots,
    });
  }, [commitStoryboardState, storyboardState]);

  const addBlankShot = useCallback((): void => {
    const total = storyboardState.shots.length + 1;
    const nextShots = reorderStoryboardShots([
      ...storyboardState.shots,
      createBlankShot(storyboardState.shots.length, total, storyboardDefaults),
    ]);

    commitStoryboardState({
      ...storyboardState,
      shots: nextShots,
    });
  }, [commitStoryboardState, storyboardDefaults, storyboardState]);

  const applyBatchVideoConfig = useCallback((): void => {
    if (storyboardState.shots.length === 0) {
      return;
    }

    const normalizedBatchVideoConfig = normalizeStoryboardShotVideoConfig(
      {
        videoModel: batchVideoModel,
        videoAspectRatio: batchVideoAspectRatio,
        videoResolution: batchVideoResolution,
      },
      storyboardDefaults,
    );

    const nextShots = reorderStoryboardShots(
      storyboardState.shots.map((shot) => ({
        ...shot,
        videoModel: normalizedBatchVideoConfig.videoModel,
        videoDuration: batchVideoDuration,
        videoAspectRatio: normalizedBatchVideoConfig.videoAspectRatio,
        videoResolution: normalizedBatchVideoConfig.videoResolution,
      })),
    );

    commitStoryboardState({
      ...storyboardState,
      shots: nextShots,
    });

    updateNodeConfigFields({
      batchVideoModel: normalizedBatchVideoConfig.videoModel,
      batchVideoDuration,
      batchVideoAspectRatio: normalizedBatchVideoConfig.videoAspectRatio,
      batchVideoResolution: normalizedBatchVideoConfig.videoResolution,
    });
  }, [
    batchVideoAspectRatio,
    batchVideoDuration,
    batchVideoModel,
    batchVideoResolution,
    commitStoryboardState,
    storyboardState,
    storyboardDefaults,
    updateNodeConfigFields,
  ]);

  const handleBatchVideoAspectRatioChange = useCallback((value: string): void => {
    const nextConfig = normalizeStoryboardShotVideoConfig(
      {
        videoModel: batchVideoModel,
        videoAspectRatio: value,
        videoResolution: batchVideoResolution,
      },
      storyboardDefaults,
    );

    setBatchVideoModel(nextConfig.videoModel);
    setBatchVideoAspectRatio(nextConfig.videoAspectRatio);
    setBatchVideoResolution(nextConfig.videoResolution);
  }, [
    batchVideoModel,
    batchVideoResolution,
    storyboardDefaults,
  ]);

  const handleBatchVideoResolutionChange = useCallback((value: string): void => {
    const nextConfig = normalizeStoryboardShotVideoConfig(
      {
        videoModel: batchVideoModel,
        videoAspectRatio: batchVideoAspectRatio,
        videoResolution: value,
      },
      storyboardDefaults,
    );

    setBatchVideoModel(nextConfig.videoModel);
    setBatchVideoAspectRatio(nextConfig.videoAspectRatio);
    setBatchVideoResolution(nextConfig.videoResolution);
  }, [
    batchVideoAspectRatio,
    batchVideoModel,
    storyboardDefaults,
  ]);

  const applyBatchPrefix = useCallback((): void => {
    const trimmedPrefix = batchPrefix.trim();
    if (!trimmedPrefix || storyboardState.shots.length === 0) {
      return;
    }

    const nextShots = reorderStoryboardShots(
      storyboardState.shots.map((shot) => ({
        ...shot,
        prompt: mergePromptWithPrefix(trimmedPrefix, shot.prompt),
      })),
    );

    commitStoryboardState({
      ...storyboardState,
      shots: nextShots,
    });
  }, [batchPrefix, commitStoryboardState, storyboardState]);

  const generateShotImage = useCallback(async (shotId: string): Promise<void> => {
    const targetShot = storyboardState.shots.find((shot) => shot.id === shotId);
    if (!targetShot) {
      return;
    }

    const availability = resolveAIStoryboardShotImageAvailability({
      shot: targetShot,
    });

    if (!availability.enabled) {
      runtime.notification.showWarning('AI 出图不可用', availability.reason ?? '当前镜头暂时无法执行 AI 出图。');
      return;
    }

    const controller = shotImageRequestControllersRef.current.get(shotId)
      ?? new AIStoryboardShotImageRequestController();
    shotImageRequestControllersRef.current.set(shotId, controller);

    const requestHandle = controller.start();
    patchShot(shotId, {
      imageGenStatus: 'generating',
      imageGenMessage: '任务创建中',
    });

    try {
      await actions.runNodeAction({
        nodeId: data.id.value,
        actionId: 'shot-image',
        targetId: shotId,
        options: {
          signal: requestHandle.signal,
        },
      });
    } finally {
      if (controller.finish(requestHandle.requestId)) {
        shotImageRequestControllersRef.current.delete(shotId);
      }
    }
  }, [
    actions,
    data.id.value,
    patchShot,
    runtime.notification,
    storyboardState.shots,
  ]);

  const generateShotVideo = useCallback(async (shotId: string): Promise<void> => {
    const targetShot = storyboardState.shots.find((shot) => shot.id === shotId);
    if (!targetShot) {
      return;
    }

    const availability = resolveAIStoryboardShotVideoAvailability({
      shot: targetShot,
    });

    if (!availability.enabled) {
      runtime.notification.showWarning('生成视频不可用', availability.reason ?? '当前镜头暂时无法执行视频生成。');
      return;
    }

    const controller = shotVideoRequestControllersRef.current.get(shotId)
      ?? new AIStoryboardShotVideoRequestController();
    shotVideoRequestControllersRef.current.set(shotId, controller);

    const requestHandle = controller.start();
    patchShot(shotId, {
      videoGenStatus: 'generating',
      videoProgress: 0,
      videoError: undefined,
    });

    try {
      await actions.runNodeAction({
        nodeId: data.id.value,
        actionId: 'shot-video',
        targetId: shotId,
        options: {
          signal: requestHandle.signal,
        },
      });
    } finally {
      if (controller.finish(requestHandle.requestId)) {
        shotVideoRequestControllersRef.current.delete(shotId);
      }
    }
  }, [
    actions,
    data.id.value,
    patchShot,
    runtime.notification,
    storyboardState.shots,
  ]);

  const shotPreviewMap = useMemo(() => {
    const previewMap = new Map<string, StoryboardShotImagePreview>();

    storyboardState.shots.forEach((shot) => {
      const sourceNode = findInputImageByShot(shot, resolvedInputImages);
      const sourceUrl = resolveStoryboardGeneratedImagePreviewUrl(shot);
      const sourceLabel = sourceNode?.fileName
        ?? shot.imageFileId
        ?? shot.sourceImageFileId
        ?? shot.sourceFileId
        ?? '空白镜头';

      previewMap.set(shot.id, {
        url: sourceUrl,
        label: sourceLabel,
        sourceNode,
      });
    });

    return previewMap;
  }, [resolvedInputImages, storyboardState.shots]);

  const emptyStateText = imageCount > 0
    ? '当前还没有可编辑的镜头。你可以手动添加空白镜头。'
    : '先接入上游图片，或直接添加空白镜头开始搭建分镜。';

  const storyboardViewProps = useMemo<StoryboardShotCollectionViewProps>(() => ({
    shots: storyboardState.shots,
    previews: shotPreviewMap,
    emptyStateText,
    onPatchShot: patchShot,
    onDeleteShot: deleteShot,
    onGenerateShotImage: (shotId: string): void => {
      void generateShotImage(shotId);
    },
    onGenerateShotVideo: (shotId: string): void => {
      void generateShotVideo(shotId);
    },
    onAddBlankShot: addBlankShot,
  }), [
    addBlankShot,
    deleteShot,
    emptyStateText,
    generateShotImage,
    generateShotVideo,
    patchShot,
    shotPreviewMap,
    storyboardState.shots,
  ]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      updateNodeInternals(data.id.value);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    data.id.value,
    data.dimensions.height,
    data.dimensions.width,
    storyboardState.shots.length,
    updateNodeInternals,
    viewMode,
  ]);

  useEffect(() => {
    const externalKey = createStoryboardLocalStateKey(externalStoryboardState);

    setStoryboardState((currentState) => {
      const currentKey = createStoryboardLocalStateKey(currentState);

      if (selfWriteStateKeyRef.current === externalKey) {
        selfWriteStateKeyRef.current = null;
        return currentKey === externalKey ? currentState : externalStoryboardState;
      }

      return currentKey === externalKey ? currentState : externalStoryboardState;
    });
  }, [externalStoryboardState]);

  useEffect(() => {
    setViewMode(normalizeViewMode(data.config.viewMode));
  }, [data.config.viewMode]);

  useEffect(() => {
    setBatchVideoModel(normalizedBatchVideoConfig.videoModel);
    setBatchVideoDuration(storyboardDefaults.defaultVideoDuration);
    setBatchVideoAspectRatio(normalizedBatchVideoConfig.videoAspectRatio);
    setBatchVideoResolution(normalizedBatchVideoConfig.videoResolution);
  }, [
    normalizedBatchVideoConfig.videoAspectRatio,
    normalizedBatchVideoConfig.videoModel,
    normalizedBatchVideoConfig.videoResolution,
    storyboardDefaults.defaultVideoAspectRatio,
    storyboardDefaults.defaultVideoDuration,
    storyboardDefaults.defaultVideoModel,
    storyboardDefaults.defaultVideoResolution,
  ]);

  useEffect(() => {
    const nextState = mergeStoryboardShotsFromInputs(
      storyboardState,
      resolvedInputImages,
      storyboardDefaults,
    );

    if (isStoryboardLocalStateEqual(storyboardState, nextState)) {
      return;
    }

    commitStoryboardState(nextState);
  }, [
    commitStoryboardState,
    resolvedInputImages,
    storyboardDefaults,
    storyboardState,
  ]);

  useEffect(() => () => {
    arrangeRequestControllerRef.current.cancel();
  }, []);

  useEffect(() => () => {
    shotImageRequestControllersRef.current.forEach((controller) => controller.cancel());
    shotImageRequestControllersRef.current.clear();
  }, []);

  useEffect(() => () => {
    shotVideoRequestControllersRef.current.forEach((controller) => controller.cancel());
    shotVideoRequestControllersRef.current.clear();
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={[
        'node-wrapper',
        'ai-node',
        'ai-storyboard-node',
        selected || isResizing ? 'ai-storyboard-node--active' : '',
        selected ? 'selected' : '',
        isProcessing ? 'processing' : '',
      ].filter(Boolean).join(' ')}
      style={{
        width: nodeWidth,
        height: nodeHeight,
        borderColor: nodeColor,
      }}
      data-node-id={data.id.value}
      data-node-dropzone="body"
    >
      {!data.locked ? (
        <>
          <button
            className="ai-storyboard-node__delete-button node-control-btn node-control-btn--delete nodrag nopan"
            title="Delete"
            onMouseDown={stopPointerEvent}
            onClick={handleDelete}
          >
            {'x'}
          </button>

          <button
            className="ai-storyboard-node__resize-handle node-resize-handle nodrag nopan"
            onMouseDown={stopPointerEvent}
            onPointerDown={handleResizeStart}
            title="Resize"
          />
        </>
      ) : null}

      <div
        className="node-header ai-storyboard-node__header"
        style={{ backgroundColor: `${nodeColor}14`, borderBottomColor: `${nodeColor}36` }}
      >
        <span className="node-type-icon">{nodeInfo?.icon ?? 'STB'}</span>
        <span className="node-type-name">{displayName}</span>
        <span className="ai-storyboard-node__header-id">{data.id.display}</span>
      </div>

      <div
        className="node-content ai-storyboard-node__content grouped-drop-input-region nodrag nopan"
        {...inputRegionProps}
      >
        <div className="ai-storyboard-node__workspace">
          <div className="ai-storyboard-node__workspace-top">
            <div className="ai-storyboard-node__intro">
              <div className="ai-storyboard-node__intro-copy">
                <div className="ai-storyboard-node__title">{displayName}</div>
                <div className="ai-storyboard-node__description">
                  {AI_STORYBOARD_DESCRIPTION}
                </div>
              </div>
            </div>

            <div className="ai-storyboard-node__summary-card">
              {summaryText}
            </div>

            {shouldShowExecutionStatus ? (
              <div
                className="ai-storyboard-node__status-region"
                data-storyboard-status-region="node-execution"
              >
                <NodeExecutionStatus
                  execution={executionState}
                  compact
                  showProgress
                  className="ai-storyboard-node__status-panel"
                />
              </div>
            ) : null}

            <div className="ai-storyboard-node__section ai-storyboard-node__section--toolbar">
              <StoryboardToolbar
                viewMode={viewMode}
                prefixText={batchPrefix}
                shotCount={storyboardState.shots.length}
                isArranging={isArranging}
                onViewModeChange={(nextViewMode) => {
                  setViewMode(nextViewMode);
                  updateNodeConfigFields({ viewMode: nextViewMode });
                }}
                onPrefixTextChange={setBatchPrefix}
                onApplyPrefix={applyBatchPrefix}
                onArrangeShots={async () => {
                  if (!arrangeAvailability.enabled) {
                    return;
                  }

                  const requestHandle = arrangeRequestControllerRef.current.start();
                  setIsArranging(true);

                  try {
                    await actions.runNodeAction({
                      nodeId: data.id.value,
                      actionId: 'arrange',
                      options: {
                        signal: requestHandle.signal,
                      },
                    });
                  } finally {
                    if (arrangeRequestControllerRef.current.finish(requestHandle.requestId)) {
                      setIsArranging(false);
                    }
                  }
                }}
                onGenerateAllVideos={() => {
                  void actions.runNodeAction({
                    nodeId: data.id.value,
                    actionId: 'batch-video',
                  });
                }}
                arrangeDisabled={!arrangeAvailability.enabled}
                generateAllVideosDisabled={storyboardState.shots.length === 0}
              />

              {!arrangeAvailability.enabled ? (
                <div className="ai-storyboard-node__hint">
                  {arrangeAvailability.reason}
                </div>
              ) : null}
            </div>

            <div className="ai-storyboard-node__section ai-storyboard-node__section--batch-video">
              <BatchVideoToolbar
                model={batchVideoModel}
                duration={batchVideoDuration}
                aspectRatio={batchVideoAspectRatio}
                resolution={batchVideoResolution}
                disabled={storyboardState.shots.length === 0}
                onModelChange={setBatchVideoModel}
                onDurationChange={setBatchVideoDuration}
                onAspectRatioChange={handleBatchVideoAspectRatioChange}
                onResolutionChange={handleBatchVideoResolutionChange}
                onApply={applyBatchVideoConfig}
              />
            </div>

            <div className="ai-storyboard-node__section ai-storyboard-node__section--meta">
              <StoryboardMetaBar
                imageCount={imageCount}
                shotCount={shotCount}
              />
            </div>

            <div
              className="ai-storyboard-node__drop-targets"
              aria-hidden="true"
            >
              <div
                className="grouped-drop-panel-target ai-storyboard-node__drop-target-anchor"
                {...getPanelTargetProps({
                  nodeId: data.id.value,
                  side: 'input',
                })}
              >
                <div
                  className="grouped-drop-slot-target ai-storyboard-node__drop-slot-anchor"
                  {...getSlotTargetProps({
                    nodeId: data.id.value,
                    groupId: primaryGroupId,
                    portId: AI_STORYBOARD_INPUT_PORT_ID,
                    side: 'input',
                  })}
                />
              </div>
            </div>
          </div>

          <div className="ai-storyboard-node__main custom-scrollbar">
            <div className="ai-storyboard-node__view-frame">
              {viewMode === 'list' ? <ShotListView {...storyboardViewProps} /> : null}
              {viewMode === 'grid' ? <ShotGridView {...storyboardViewProps} /> : null}
              {viewMode === 'table' ? <ShotTableView {...storyboardViewProps} /> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="node-footer ai-storyboard-node__footer">
        <span className="node-id">{data.id.display}</span>
        <span className="ai-storyboard-node__footer-meta">
          {imageCount} images / {shotCount} shots
        </span>
      </div>

      <Handle
        id={`${primaryGroupId}:${AI_STORYBOARD_INPUT_PORT_ID}`}
        type="target"
        position={Position.Left}
        className="react-flow__handle ai-storyboard-node__handle ai-storyboard-node__handle--input nodrag nopan"
        style={{ background: nodeColor, top: '50%' }}
      />
      <Handle
        id={`${primaryGroupId}:${AI_STORYBOARD_RESULT_PORT_ID}`}
        type="source"
        position={Position.Right}
        className="react-flow__handle ai-storyboard-node__handle ai-storyboard-node__handle--output nodrag nopan"
        style={{ background: nodeColor, top: '50%' }}
      />
    </div>
  );
};

AIStoryboardNodeInner.displayName = 'AIStoryboardNodeInner';

export const AIStoryboardNode = memo((props: AIStoryboardNodeProps) => (
  <NodeErrorBoundary nodeId={props.data.id.value} nodeType={props.data.type}>
    <AIStoryboardNodeInner {...props} />
  </NodeErrorBoundary>
));

AIStoryboardNode.displayName = 'AIStoryboardNode';
