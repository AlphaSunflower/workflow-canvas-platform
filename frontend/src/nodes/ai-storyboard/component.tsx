import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, useReactFlow, useUpdateNodeInternals } from 'reactflow';

import type {
  AINodeData,
  AnyNodeData,
  Dimensions,
  FileNodeData,
  StoryboardConfig,
  StoryboardCreationType,
  StoryboardShotData,
  StoryboardVideoDuration,
  StoryboardViewMode,
} from '@/types';
import { NodeExecutionStatus } from '@/components/execution/NodeExecutionStatus';
import { NodeErrorBoundary } from '@/components/ui/ErrorBoundary';
import { NODE_TYPE_INFO } from '@/constants';
import { useNodeRuntimeBindings } from '@/nodes/runtime-bindings';
import { useWorkflowActions } from '@/components/context/useWorkflowActions';
import { workflowTaskHistoryService } from '@/services/workflow-task-history.service';
import { createWorkflowRuntimeSnapshot } from '@/utils';
import { useGroupedDropInteraction } from '../shared/grouped-drop/useGroupedDropInteraction';
import {
  resolveNodeResizeDimensions,
  useNodeResizeInteraction,
} from '../shared/useNodeResizeInteraction';
import type { AIStoryboardDropSide } from './drop';
import {
  getAIStoryboardOutputHandle,
  resolveAIStoryboardInputGroups,
} from './groups';
import { resolveStoryboardInputImages, resolveStoryboardShotConnectedImages } from './input-resolver';
import {
  getStoryboardExternalState,
  isStoryboardLocalStateEqual,
  mergeStoryboardShotsFromInputs,
} from './shot-sync';
import { resolveStoryboardGeneratedImageFallbackUrl, resolveStoryboardGeneratedImagePreviewUrl } from './preview';
import {
  createStoryboardLocalStateKey,
  normalizeStoryboardCreationType,
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
  resolveAIStoryboardStoryArrangeAvailability,
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
  AI_STORYBOARD_INPUT_PORT_ID,
  AI_STORYBOARD_MIN_HEIGHT,
  AI_STORYBOARD_MIN_WIDTH,
} from './constants';
import {
  BatchVideoToolbar,
  ShotTimelineView,
  StoryboardStoryPanel,
  type StoryboardShotTimelineViewProps,
  type StoryboardShotImagePreview,
} from './views';

interface AIStoryboardNodeProps extends NodeProps<AINodeData> {}

export const AI_STORYBOARD_AUTO_SIZE_THRESHOLD = 4;

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function readCssPixelValue(value: string): number {
  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function resolveAIStoryboardMeasuredContentHeight(contentElement: HTMLElement): number {
  const headerElement = contentElement.querySelector<HTMLElement>('.ai-storyboard-node__header');
  const bodyElement = contentElement.querySelector<HTMLElement>('.ai-storyboard-node__content');
  const workspaceTopElement = contentElement.querySelector<HTMLElement>('.ai-storyboard-node__workspace-top');
  const footerElement = contentElement.querySelector<HTMLElement>('.ai-storyboard-node__footer');

  if (!headerElement || !bodyElement || !workspaceTopElement || !footerElement) {
    return contentElement.scrollHeight;
  }

  const bodyStyle = window.getComputedStyle(bodyElement);
  const bodyPaddingHeight = readCssPixelValue(bodyStyle.paddingTop) + readCssPixelValue(bodyStyle.paddingBottom);
  const bodyContentHeight = Math.max(workspaceTopElement.offsetHeight, workspaceTopElement.scrollHeight);

  return headerElement.offsetHeight + bodyPaddingHeight + bodyContentHeight + footerElement.offsetHeight;
}

export function resolveAIStoryboardAutoDimensions(
  currentDimensions: Dimensions,
  measuredContentHeight: number,
): Dimensions | null {
  if (!Number.isFinite(measuredContentHeight) || measuredContentHeight <= 0) {
    return null;
  }

  const nextDimensions: Dimensions = {
    width: Math.max(AI_STORYBOARD_MIN_WIDTH, Math.round(currentDimensions.width)),
    height: Math.max(AI_STORYBOARD_MIN_HEIGHT, Math.ceil(measuredContentHeight)),
  };

  if (
    Math.abs(nextDimensions.width - currentDimensions.width) < AI_STORYBOARD_AUTO_SIZE_THRESHOLD
    && Math.abs(nextDimensions.height - currentDimensions.height) < AI_STORYBOARD_AUTO_SIZE_THRESHOLD
  ) {
    return null;
  }

  return nextDimensions;
}

function buildSummaryText(imageCount: number, shotCount: number): string {
  if (imageCount === 0) {
    return '等待接入上游图片。当前分镜节点支持列表工作台、镜头参数编辑与批量操作。';
  }

  if (shotCount === 0) {
    return `已连接 ${imageCount} 张图片，尚未生成镜头条目。可使用顶部添加镜头开始编辑。`;
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
    workflowId,
  } = useNodeRuntimeBindings();
  const workflowActions = useWorkflowActions();
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
  const legacyOutputHandle = getAIStoryboardOutputHandle(primaryGroupId);
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
  const [batchSettingsOpen, setBatchSettingsOpen] = useState(false);
  const [isArranging, setIsArranging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [storyMode, setStoryMode] = useState(false);
  const [storyText, setStoryText] = useState('');
  const [creationType, setCreationType] = useState<StoryboardCreationType>(
    normalizeStoryboardCreationType(data.config.creationType) ?? 'custom',
  );
  const [isStoryGenerating, setIsStoryGenerating] = useState(false);
  const [batchVideoModel, setBatchVideoModel] = useState(normalizedBatchVideoConfig.videoModel);
  const [batchVideoDuration, setBatchVideoDuration] = useState<StoryboardVideoDuration>(storyboardDefaults.defaultVideoDuration);
  const [batchVideoAspectRatio, setBatchVideoAspectRatio] = useState(normalizedBatchVideoConfig.videoAspectRatio);
  const [batchVideoResolution, setBatchVideoResolution] = useState(normalizedBatchVideoConfig.videoResolution);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentMeasureRef = useRef<HTMLDivElement | null>(null);
  const manualResizeLockRef = useRef(false);
  const selfWriteStateKeyRef = useRef<string | null>(null);
  const resolvedInputs = selectors.getResolvedNodeInputGroups(data.id.value);
  const resolvedInputImages = useMemo(() => resolveStoryboardInputImages(
    resolvedInputs,
    { getNodeById: selectors.getNodeById },
  ), [resolvedInputs, selectors]);
  const imageCount = resolvedInputImages.length;
  const shotCount = storyboardState.shots.length;
  const shotHandleVersion = useMemo(
    () => storyboardState.shots.map((shot) => shot.id).join('|'),
    [storyboardState.shots],
  );
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

  const storyArrangeAvailability = useMemo(() => (
    resolveAIStoryboardStoryArrangeAvailability({
      storyText,
      isGenerating: isStoryGenerating,
    })
  ), [storyText, isStoryGenerating]);

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

  const applyAutoDimensions = useCallback((nextDimensions: Dimensions): void => {
    const currentNodes = getNodes();
    let changed = false;
    const nextNodes = currentNodes.map((node) => {
      if (node.id !== data.id.value) {
        return node;
      }

      const currentData = node.data as AINodeData;
      if (
        currentData.dimensions.width === nextDimensions.width
        && currentData.dimensions.height === nextDimensions.height
      ) {
        return node;
      }

      changed = true;
      const nextData: AINodeData = {
        ...currentData,
        dimensions: nextDimensions,
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
    });

    if (!changed) {
      return;
    }

    setNodes(nextNodes);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(
      nextNodes,
      getEdges(),
      getViewport(),
    ));
  }, [actions, data.id.value, getEdges, getNodes, getViewport, setNodes]);

  const measureAndApplyAutoDimensions = useCallback((): void => {
    const contentElement = contentMeasureRef.current;
    if (!contentElement || isResizing || manualResizeLockRef.current) {
      return;
    }

    const measuredContentHeight = resolveAIStoryboardMeasuredContentHeight(contentElement);
    const nextDimensions = resolveAIStoryboardAutoDimensions(data.dimensions, measuredContentHeight);

    if (!nextDimensions) {
      return;
    }

    applyAutoDimensions(nextDimensions);
  }, [
    applyAutoDimensions,
    data.dimensions,
    isResizing,
  ]);

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
    onResizeStart: () => {
      manualResizeLockRef.current = true;
      setIsResizing(true);
    },
    onResizeEnd: () => setIsResizing(false),
    onCommit: () => syncRuntimeSnapshot(),
  });

  const commitStoryboardState = useCallback((nextState: StoryboardLocalState): void => {
    setStoryboardState(nextState);
    writeStoryboardStateToNode(nextState);
  }, [writeStoryboardStateToNode]);

  const patchShot = useCallback((shotId: string, patch: Partial<StoryboardShotData>): void => {
    const latestNode = selectors.getNodeById(data.id.value);
    const latestShots = (latestNode && latestNode.type === 'aiStoryboard' && Array.isArray(latestNode.config.shots))
      ? latestNode.config.shots as StoryboardShotData[]
      : storyboardState.shots;

    const nextShots = reorderStoryboardShots(
      latestShots.map((shot) => {
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
  }, [commitStoryboardState, data.id.value, selectors, storyboardDefaults, storyboardState]);

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

  const arrangeShots = useCallback(async (): Promise<void> => {
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
  }, [
    actions,
    arrangeAvailability.enabled,
    data.id.value,
  ]);

  const generateStoryShots = useCallback(async (): Promise<void> => {
    if (!storyArrangeAvailability.enabled) {
      return;
    }

    const requestHandle = arrangeRequestControllerRef.current.start();
    setIsStoryGenerating(true);

    try {
      await actions.runNodeAction({
        nodeId: data.id.value,
        actionId: 'story-arrange',
        options: {
          signal: requestHandle.signal,
          storyText,
          creationType,
        },
      });
    } finally {
      if (arrangeRequestControllerRef.current.finish(requestHandle.requestId)) {
        setIsStoryGenerating(false);
      }
    }
  }, [
    actions,
    storyArrangeAvailability.enabled,
    data.id.value,
    storyText,
    creationType,
  ]);

  const handleCreationTypeChange = useCallback((value: StoryboardCreationType): void => {
    setCreationType(value);
    updateNodeConfigFields({ creationType: value });
  }, [updateNodeConfigFields]);

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

    // For re-generation: clear the old imageFileId so the runner generates a fresh image
    if (targetShot.imageFileId) {
      patchShot(shotId, {
        imageFileId: undefined,
        imageGenStatus: 'idle',
        imageGenMessage: undefined,
      });
    }

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

      setTimeout(() => {
        // Read latest shot from workflowRef.current (updated by runner's patchStoryboardShotRuntimeState).
        // Use patchCurrentWorkflow as a read-only pass-through to access the current workflow.
        let latestShotWithImage: StoryboardShotData | undefined;
        workflowActions.patchCurrentWorkflow((current) => {
          const currentNode = current.nodes[data.id.value];
          if (currentNode && currentNode.type === 'aiStoryboard') {
            const config = currentNode.config as StoryboardConfig;
            latestShotWithImage = Array.isArray(config.shots)
              ? config.shots.find((s) => s.id === shotId) as StoryboardShotData | undefined
              : undefined;
          }
          return current;
        });

        if (latestShotWithImage) {
          // Commit to BOTH ReactFlow store (setNodes) and workflow state (syncRuntimeSnapshot).
          // This ensures data.config has imageFileId when the externalStoryboardState effect fires.
          const nextState: StoryboardLocalState = {
            ...storyboardState,
            shots: storyboardState.shots.map((s) => (
              s.id === shotId
                ? {
                  ...s,
                  imageGenStatus: latestShotWithImage!.imageGenStatus ?? 'completed',
                  imageGenMessage: latestShotWithImage!.imageGenMessage,
                  videoGenStatus: latestShotWithImage!.videoGenStatus ?? 'idle',
                  ...(latestShotWithImage!.imageFileId ? { imageFileId: latestShotWithImage!.imageFileId } : {}),
                }
                : s
            )),
          };
          commitStoryboardState(nextState);
        }
        // Persist to backend
        void workflowActions.saveWorkflow({ force: true, silent: true }).catch(() => {});
      }, 0);
    } finally {
      if (controller.finish(requestHandle.requestId)) {
        shotImageRequestControllersRef.current.delete(shotId);
      }
    }
  }, [
    actions,
    commitStoryboardState,
    data.id.value,
    patchShot,
    runtime.notification,
    storyboardState,
    workflowActions,
  ]);

  const shotConnectedImagesMap = useMemo(() => {
    const map = new Map<string, import('./types').StoryboardShotConnectedImage[]>();
    for (const shot of storyboardState.shots) {
      map.set(shot.id, resolveStoryboardShotConnectedImages(resolvedInputs, shot.id));
    }
    return map;
  }, [resolvedInputs, storyboardState.shots]);

  const generateShotVideo = useCallback(async (shotId: string): Promise<void> => {
    const targetShot = storyboardState.shots.find((shot) => shot.id === shotId);
    if (!targetShot) {
      return;
    }

    const availability = resolveAIStoryboardShotVideoAvailability({
      shot: targetShot,
      connectedImages: shotConnectedImagesMap.get(shotId),
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

      setTimeout(() => {
        // Read latest shot from workflowRef.current (updated by runner's patchStoryboardShotRuntimeState).
        let latestShotWithVideo: StoryboardShotData | undefined;
        workflowActions.patchCurrentWorkflow((current) => {
          const currentNode = current.nodes[data.id.value];
          if (currentNode && currentNode.type === 'aiStoryboard') {
            const config = currentNode.config as StoryboardConfig;
            latestShotWithVideo = Array.isArray(config.shots)
              ? config.shots.find((s) => s.id === shotId) as StoryboardShotData | undefined
              : undefined;
          }
          return current;
        });

        if (latestShotWithVideo) {
          // Commit to BOTH ReactFlow store and workflow state.
          const nextState: StoryboardLocalState = {
            ...storyboardState,
            shots: storyboardState.shots.map((s) => (
              s.id === shotId
                ? {
                  ...s,
                  imageGenStatus: latestShotWithVideo!.imageGenStatus ?? 'idle',
                  videoGenStatus: latestShotWithVideo!.videoGenStatus ?? 'completed',
                  videoProgress: latestShotWithVideo!.videoProgress,
                  videoError: latestShotWithVideo!.videoError,
                  ...(latestShotWithVideo!.videoFileId ? { videoFileId: latestShotWithVideo!.videoFileId } : {}),
                }
                : s
            )),
          };
          commitStoryboardState(nextState);
        }
        // Persist to backend
        void workflowActions.saveWorkflow({ force: true, silent: true }).catch(() => {});
      }, 0);
    } finally {
      if (controller.finish(requestHandle.requestId)) {
        shotVideoRequestControllersRef.current.delete(shotId);
      }
    }
  }, [
    actions,
    commitStoryboardState,
    data.id.value,
    patchShot,
    runtime.notification,
    shotConnectedImagesMap,
    storyboardState,
    workflowActions,
  ]);

  const shotPreviewMap = useMemo(() => {
    const previewMap = new Map<string, StoryboardShotImagePreview>();

    storyboardState.shots.forEach((shot) => {
      const sourceNode = findInputImageByShot(shot, resolvedInputImages);
      const sourceUrl = resolveStoryboardGeneratedImagePreviewUrl(shot);
      const fallbackUrl = resolveStoryboardGeneratedImageFallbackUrl(shot);
      const hasImageFile = typeof shot.imageFileId === 'string' && shot.imageFileId.trim().length > 0;
      const hasVideoFile = typeof shot.videoFileId === 'string' && shot.videoFileId.trim().length > 0;
      const sourceLabel = sourceNode?.fileName
        ?? shot.imageFileId
        ?? shot.sourceImageFileId
        ?? shot.sourceFileId
        ?? '空白镜头';

      previewMap.set(shot.id, {
        url: sourceUrl,
        fallbackUrl,
        label: sourceLabel,
        sourceNode,
        mediaType: hasImageFile ? 'image' : hasVideoFile ? 'video' : undefined,
      });
    });

    return previewMap;
  }, [resolvedInputImages, storyboardState.shots]);

  const dropHintText = '拖入图片到节点本体可添加分镜';

  const storyboardViewProps = useMemo<StoryboardShotTimelineViewProps>(() => ({
    shots: storyboardState.shots,
    previews: shotPreviewMap,
    connectedImagesMap: shotConnectedImagesMap,
    nodeColor,
    onPatchShot: patchShot,
    onDeleteShot: deleteShot,
    onGenerateShotImage: (shotId: string): void => {
      void generateShotImage(shotId);
    },
    onGenerateShotVideo: (shotId: string): void => {
      void generateShotVideo(shotId);
    },
  }), [
    deleteShot,
    generateShotImage,
    generateShotVideo,
    nodeColor,
    patchShot,
    shotConnectedImagesMap,
    shotPreviewMap,
    storyboardState.shots,
  ]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      measureAndApplyAutoDimensions();
      updateNodeInternals(data.id.value);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    data.id.value,
    data.dimensions.height,
    data.dimensions.width,
    arrangeAvailability.enabled,
    arrangeAvailability.reason,
    batchSettingsOpen,
    measureAndApplyAutoDimensions,
    shotHandleVersion,
    shouldShowExecutionStatus,
    storyboardState.shots.length,
    updateNodeInternals,
    viewMode,
  ]);

  useEffect(() => {
    const contentElement = contentMeasureRef.current;
    if (!contentElement) {
      return undefined;
    }

    let frameId = 0;
    const queueMeasure = (): void => {
      if (frameId !== 0) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        measureAndApplyAutoDimensions();
      });
    };

    queueMeasure();

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        if (frameId !== 0) {
          window.cancelAnimationFrame(frameId);
        }
      };
    }

    const observer = new ResizeObserver(queueMeasure);
    observer.observe(contentElement);

    return () => {
      observer.disconnect();
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [measureAndApplyAutoDimensions]);

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

  // Heartbeat: poll backend for completed image-gen/video-gen tasks to recover imageFileId/videoFileId.
  // This handles: (1) page refresh where imageFileId wasn't persisted, (2) runner state sync failures.
  useEffect(() => {
    if (!workflowId) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const pollCompletedTasks = async (): Promise<void> => {
      // Poll image-gen tasks
      try {
        const response = await workflowTaskHistoryService.listWorkflowTasks(
          workflowId,
          { nodeId: data.id.value, taskType: 'image-gen', status: 'completed', pageSize: 100 },
        );
        if (cancelled) return;

        let hasUpdates = false;
        const nextShots = storyboardState.shots.map((shot) => {
          if (shot.imageFileId) return shot;
          const matchingTask = response.items.find((t) => t.groupId === shot.id && t.resultFileId);
          if (!matchingTask) return shot;
          hasUpdates = true;
          return {
            ...shot,
            imageFileId: matchingTask.resultFileId ?? undefined,
            imageGenStatus: 'completed' as const,
            imageGenMessage: '已完成',
          };
        });

        if (hasUpdates) {
          commitStoryboardState({ ...storyboardState, shots: nextShots });
          void workflowActions.saveWorkflow({ force: true, silent: true }).catch(() => {});
        }
      } catch {
        // silent — will retry on next interval
      }

      // Poll video-gen tasks
      try {
        const response = await workflowTaskHistoryService.listWorkflowTasks(
          workflowId,
          { nodeId: data.id.value, taskType: 'video-gen', status: 'completed', pageSize: 100 },
        );
        if (cancelled) return;

        let hasUpdates = false;
        const nextShots = storyboardState.shots.map((shot) => {
          if (shot.videoFileId) return shot;
          const matchingTask = response.items.find((t) => t.groupId === shot.id && t.resultFileId);
          if (!matchingTask) return shot;
          hasUpdates = true;
          return {
            ...shot,
            videoFileId: matchingTask.resultFileId ?? undefined,
            videoGenStatus: 'completed' as const,
          };
        });

        if (hasUpdates) {
          commitStoryboardState({ ...storyboardState, shots: nextShots });
          void workflowActions.saveWorkflow({ force: true, silent: true }).catch(() => {});
        }
      } catch {
        // silent
      }
    };

    // Initial poll on mount
    void pollCompletedTasks();

    // Set up 5s interval while any shot is generating
    const hasGeneratingShots = storyboardState.shots.some(
      (s) => s.imageGenStatus === 'generating' || s.videoGenStatus === 'generating',
    );
    if (hasGeneratingShots) {
      intervalId = setInterval(() => { void pollCompletedTasks(); }, 5000);
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [workflowId, data.id.value, storyboardState, commitStoryboardState, workflowActions]);

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

  const shellClasses = [
    'ai-storyboard-node-shell',
    selected ? 'ai-storyboard-node-shell--selected' : '',
    data.locked ? 'ai-storyboard-node-shell--locked' : '',
    isProcessing ? 'ai-storyboard-node-shell--processing' : '',
  ].filter(Boolean).join(' ');

  const wrapperClasses = [
    'node-wrapper',
    'ai-node',
    'ai-storyboard-node',
    'grouped-drop-input-region',
    selected || isResizing ? 'ai-storyboard-node--active' : '',
    selected ? 'selected' : '',
    data.locked ? 'locked' : '',
    isProcessing ? 'processing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={shellClasses}
      style={{
        width: nodeWidth,
        minWidth: nodeWidth,
      }}
      data-node-id={data.id.value}
      data-node-dropzone="body"
      data-storyboard-summary={summaryText}
    >
      <div
        ref={wrapperRef}
        className={wrapperClasses}
        style={{
          width: '100%',
          minHeight: nodeHeight,
          borderColor: nodeColor,
        }}
        data-node-id={data.id.value}
        data-node-dropzone="body"
        data-storyboard-summary={summaryText}
        {...inputRegionProps}
      >
      <div
        ref={contentMeasureRef}
        className="ai-storyboard-node__auto-content"
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
        <span className="ai-storyboard-node__header-stat">{imageCount} 图</span>
        <span className="ai-storyboard-node__header-stat">{shotCount} 镜头</span>
        <span className="ai-storyboard-node__header-id">{data.id.display}</span>
      </div>

      <div
        className="node-content ai-storyboard-node__content nodrag nopan"
      >
        <div className="ai-storyboard-node__workspace">
          <div className="ai-storyboard-node__workspace-top">
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
              <div className="ai-storyboard-primary-toolbar">
                <button
                  type="button"
                  className={`ai-storyboard-workbench__button nodrag nopan${storyMode ? ' ai-storyboard-workbench__button--active' : ''}`}
                  onClick={() => setStoryMode((mode) => !mode)}
                >
                  {storyMode ? '退出剧情模式' : '剧情模式'}
                </button>
                <button
                  type="button"
                  className="ai-storyboard-workbench__button ai-storyboard-workbench__button--accent nodrag nopan"
                  disabled={!arrangeAvailability.enabled || storyMode}
                  onClick={() => {
                    void arrangeShots();
                  }}
                >
                  {isArranging ? 'AI 编排中...' : 'AI 编排'}
                </button>
                <button
                  type="button"
                  className="ai-storyboard-workbench__button ai-storyboard-workbench__button--video-primary nodrag nopan"
                  disabled={storyboardState.shots.length === 0}
                  onClick={() => {
                  void actions.runNodeAction({
                    nodeId: data.id.value,
                    actionId: 'batch-video',
                  });
                }}
                >
                  批量生成视频
                </button>
                <button
                  type="button"
                  className="ai-storyboard-workbench__button nodrag nopan"
                  onClick={addBlankShot}
                >
                  添加镜头
                </button>
                <button
                  type="button"
                  className="ai-storyboard-workbench__button nodrag nopan"
                  onClick={() => setBatchSettingsOpen((open) => !open)}
                >
                  {batchSettingsOpen ? '收起批量设置' : '批量设置'}
                </button>
              </div>

              {!arrangeAvailability.enabled && !storyMode ? (
                <div className="ai-storyboard-node__hint">
                  {arrangeAvailability.reason}
                </div>
              ) : null}

              {storyMode ? (
                <div className="ai-storyboard-node__section ai-storyboard-node__section--story">
                  <StoryboardStoryPanel
                    storyText={storyText}
                    creationType={creationType}
                    isGenerating={isStoryGenerating}
                    generateDisabled={!storyArrangeAvailability.enabled}
                    generateDisabledReason={storyArrangeAvailability.reason}
                    onStoryTextChange={setStoryText}
                    onCreationTypeChange={handleCreationTypeChange}
                    onGenerate={() => {
                      void generateStoryShots();
                    }}
                  />
                </div>
              ) : null}
            </div>

            <div className="ai-storyboard-node__drop-hint">
              {dropHintText}
            </div>

            {batchSettingsOpen ? (
              <div className="ai-storyboard-node__section ai-storyboard-node__section--batch-video">
                <div className="ai-storyboard-batch-prefix">
                  <input
                    className="ai-storyboard-workbench__input nodrag nopan"
                    value={batchPrefix}
                    onChange={(event) => setBatchPrefix(event.target.value)}
                    placeholder="批量添加到每条 Prompt 前"
                  />
                  <button
                    type="button"
                    className="ai-storyboard-workbench__button nodrag nopan"
                    disabled={storyboardState.shots.length === 0 || batchPrefix.trim().length === 0}
                    onClick={applyBatchPrefix}
                  >
                    应用前缀
                  </button>
                </div>
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
            ) : null}

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

        </div>
      </div>

      <div className="node-footer ai-storyboard-node__footer">
        <span className="node-id">{data.id.display}</span>
        <span className="ai-storyboard-node__footer-meta">
          {imageCount} images / {shotCount} shots
        </span>
      </div>
      </div>

      <Handle
        id={`${primaryGroupId}:${AI_STORYBOARD_INPUT_PORT_ID}`}
        type="target"
        position={Position.Left}
        className="react-flow__handle ai-storyboard-node__handle ai-storyboard-node__handle--input nodrag nopan"
        style={{ background: nodeColor, top: '50%' }}
      />
      <Handle
        id={legacyOutputHandle}
        type="source"
        position={Position.Right}
        className="react-flow__handle ai-storyboard-node__handle ai-storyboard-node__handle--legacy-output nodrag nopan"
        style={{ background: nodeColor, top: '50%', opacity: 0, pointerEvents: 'none' }}
      />
    </div>

      {shotCount > 0 ? (
        <div className="ai-storyboard-node__shot-dock nodrag nopan">
          <ShotTimelineView {...storyboardViewProps} />
        </div>
      ) : null}
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
