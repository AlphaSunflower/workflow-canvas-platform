import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Handle,
  Position,
  type NodeProps,
  useReactFlow,
  useUpdateNodeInternals,
} from 'reactflow';
import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import { NodeErrorBoundary } from '@/components/ui/ErrorBoundary';
import { NODE_TYPE_INFO } from '@/constants';
import {
  useNodeRuntimeBindings,
} from '@/nodes/runtime-bindings';
import {
  createWorkflowRuntimeSnapshot,
  ensureAIImageInputGroups,
  isFileNodeData,
} from '@/utils';
import { patchNodeConfigInGraph } from '../shared/node-config-updater';
import {
  createAppendedInputGroups,
  removeInputGroupAndReorder,
} from '../shared/groups';
import {
  GroupedInputActionButton,
  GroupedInputItemChrome,
  GroupedInputPanel,
} from '../shared/GroupedInputPanel';
import {
  isGroupedInputInteractionDisabled,
  removeGroupedPortInput,
} from '../shared/grouped-input-edit';
import {
  getOrderedSourceIdsForHandle,
  reorderGroupedPortInputs,
  reorderGroupedPortSourceIds,
} from '../shared/grouped-input-sort';
import { useGroupedDropInteraction } from '../shared/grouped-drop/useGroupedDropInteraction';
import {
  resolveNodeResizeDimensions,
  useNodeResizeInteraction,
} from '../shared/useNodeResizeInteraction';
import { getReactFlowEdgeConnectionType } from '../shared/connection';
import type { AIImageGenDropSide } from './drop-config';
import {
  AI_IMAGE_GEN_MAX_GROUPS,
  AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP,
  AI_IMAGE_INPUT_PORT_ID,
  getAIImageGenGroupInputHandle,
  getAIImageGenGroupOutputHandle,
} from './groups';
import { buildAIImageGenInputLayoutVersion } from './layout';
import {
  handleAIImageGenPromptBlur as reducePromptBlur,
  handleAIImageGenPromptChange as reducePromptChange,
  handleAIImageGenPromptCompositionEnd as reducePromptCompositionEnd,
  handleAIImageGenPromptCompositionStart as reducePromptCompositionStart,
  handleAIImageGenPromptFocus as reducePromptFocus,
  handleAIImageGenPromptRun as reducePromptRun,
  settleAIImageGenPromptRun as reducePromptRunSettle,
  syncAIImageGenPromptControllerFromExternal as reducePromptExternalSync,
  type AIImageGenPromptControllerState,
} from './prompt-controller';
import {
  AIImageGenPromptOptimizeRequestController,
  resolveAIImageGenPromptOptimizeAvailability,
} from './prompt-optimize';
import {
  AI_IMAGE_GEN_NODE_IMAGE_SIZE_OPTIONS,
  AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS,
  AI_IMAGE_GEN_NODE_OFFICIAL_QUALITY_OPTIONS,
  getAIImageGenNodeAspectRatioOptions,
  isAIImageGenNodeOfficialModel,
  isAIImageGenNodeParameterlessModel,
  normalizeAIImageGenNodeConfig,
  normalizeAIImageGenNodeModel,
  normalizeAIImageGenNodeOfficialQuality,
} from './constants';
import { NodeInputImagePreview } from '../shared/NodeInputImagePreview';

interface AINodeProps extends NodeProps<AINodeData> {}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 340;
const GROUP_STACK_GAP = 10;
const DEFAULT_GROUP_HEIGHT = 118;
const PROMPT_COMMIT_DEBOUNCE_MS = 300;

function getGroupStatusLabel(status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped' | null | undefined): string | null {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'processing':
      return '执行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    case 'skipped':
      return '已跳过';
    default:
      return null;
  }
}

function getReferenceTitle(node: FileNodeData): string {
  return `${node.fileName} | ${node.id.display}`;
}

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function useNodeConfigEditor(
  nodeId: string,
  expectedType: AINodeData['type'],
): (updater: (config: AINodeData['config'], node: AINodeData) => Partial<AINodeData['config']> | null) => void {
  const { actions } = useNodeRuntimeBindings();
  const { getNodes, setNodes } = useReactFlow<AnyNodeData>();

  return useCallback((updater): void => {
    const patchResult = patchNodeConfigInGraph({
      nodes: getNodes(),
      nodeId,
      expectedType,
      updater,
    });
    if (!patchResult.changed) {
      return;
    }

    setNodes(patchResult.nextNodes);
    actions.patchNodeConfig(nodeId, updater, { expectedType });
  }, [actions, expectedType, getNodes, nodeId, setNodes]);
}

function useNodeStructuralEditor(nodeId: string): (updater: (node: AINodeData) => AINodeData) => void {
  const { actions } = useNodeRuntimeBindings();
  const { getNodes, getEdges, getViewport, setNodes } = useReactFlow<AnyNodeData>();

  return useCallback((updater: (node: AINodeData) => AINodeData): void => {
    const currentNodes = getNodes();
    const nextNodes = currentNodes.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }

      const currentData = node.data as AINodeData;
      const nextData = updater(currentData);

      return {
        ...node,
        data: nextData,
        position: nextData.position,
      };
    });

    setNodes(nextNodes);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, getEdges(), getViewport()));
  }, [actions, getEdges, getNodes, getViewport, nodeId, setNodes]);
}

const AIImageGenNodeInner: React.FC<AINodeProps> = ({ data, selected }) => {
  const {
    actions,
    selectors,
    nodeExecutionRuntime,
    groupExecutionStates,
  } = useNodeRuntimeBindings();
  const updateNodeConfig = useNodeConfigEditor(data.id.value, data.type);
  const updateNodeStructure = useNodeStructuralEditor(data.id.value);
  const { getNodes, getEdges, getViewport, setNodes, setEdges } = useReactFlow<AnyNodeData>();
  const updateNodeInternals = useUpdateNodeInternals();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const groupLayerRef = useRef<HTMLDivElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isPromptFocusedRef = useRef(false);
  const isPromptComposingRef = useRef(false);
  const promptCommitTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pendingPromptRunRef = useRef<string | null>(null);
  const shouldRunAfterPromptCompositionRef = useRef(false);
  const optimizePromptRequestControllerRef = useRef(new AIImageGenPromptOptimizeRequestController());
  const [isResizing, setIsResizing] = useState(false);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(data.config.prompt ?? '');
  const [sortingState, setSortingState] = useState<{
    groupId: string;
    activeSourceId: string;
    overSourceId: string | null;
  } | null>(null);
  const { inputRegionProps, getPanelTargetProps, getSlotTargetProps } =
    useGroupedDropInteraction<AIImageGenDropSide>();

  const nodeInfo = NODE_TYPE_INFO[data.type];
  const nodeColor = nodeInfo?.color || '#ec4899';
  const nodeIcon = nodeInfo?.icon || 'IMG';
  const executionState = nodeExecutionRuntime?.executionState ?? null;
  const isProcessing = nodeExecutionRuntime?.isProcessing ?? false;
  const groupExecutionStateMap = useMemo(
    () => new Map(groupExecutionStates.map((groupState) => [groupState.groupId, groupState] as const)),
    [groupExecutionStates],
  );
  const canRun = selectors.canRunNode(data.id.value);
  const groups = useMemo(() => ensureAIImageInputGroups(data.config), [data.config]);
  const resolvedGroupStates = useMemo(
    () => selectors.getResolvedNodeInputGroups(data.id.value),
    [data.id.value, selectors]
  );
  const groupsWithExecution = useMemo(() => resolvedGroupStates.map((groupState) => ({
    group: groupState.group,
    inputs: groupState.ports.find((port) => port.portId === AI_IMAGE_INPUT_PORT_ID)?.inputs ?? [],
    execution: groupExecutionStateMap.get(groupState.group.id) ?? null,
  })), [groupExecutionStateMap, resolvedGroupStates]);
  const inputLayoutVersion = useMemo(
    () => buildAIImageGenInputLayoutVersion(resolvedGroupStates),
    [resolvedGroupStates],
  );
  const promptOptimizeAvailability = useMemo(() => (
    resolveAIImageGenPromptOptimizeAvailability({
      prompt: promptDraft,
      configuredGroupCount: groups.length,
      resolvedGroups: resolvedGroupStates,
      isOptimizing: isOptimizingPrompt,
    })
  ), [groups.length, isOptimizingPrompt, promptDraft, resolvedGroupStates]);
  const promptOptimizeButtonDisabled = !promptOptimizeAvailability.enabled;
  const promptOptimizeDisabledReason = promptOptimizeAvailability.reason;
  const promptOptimizeButtonTitle = promptOptimizeAvailability.enabled
    ? (
      promptOptimizeAvailability.referenceCount > 0
        ? `结合 ${promptOptimizeAvailability.referenceCount} 张参考图优化提示词`
        : '根据当前文本优化提示词'
    )
    : promptOptimizeDisabledReason ?? 'AI 提示词优化不可用';

  const normalizedImageConfig = useMemo(() => normalizeAIImageGenNodeConfig({
    model: data.config.model,
    imageSize: data.config.imageSize,
    aspectRatio: data.config.aspectRatio,
    quality: data.config.quality,
  }), [data.config.aspectRatio, data.config.imageSize, data.config.model, data.config.quality]);
  const isOfficialModel = isAIImageGenNodeOfficialModel(normalizedImageConfig.model);
  const usesParameterControls = !isAIImageGenNodeParameterlessModel(normalizedImageConfig.model);
  const aspectRatioOptions = useMemo(
    () => getAIImageGenNodeAspectRatioOptions(normalizedImageConfig.model),
    [normalizedImageConfig.model],
  );

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      updateNodeInternals(data.id.value);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [data.dimensions.height, data.dimensions.width, data.id.value, inputLayoutVersion, updateNodeInternals]);

  const getPromptControllerState = useCallback((): AIImageGenPromptControllerState => ({
    draft: promptDraft,
    committedPrompt: data.config.prompt ?? '',
    isFocused: isPromptFocusedRef.current,
    isComposing: isPromptComposingRef.current,
    pendingRunPrompt: pendingPromptRunRef.current,
    shouldRunAfterComposition: shouldRunAfterPromptCompositionRef.current,
  }), [data.config.prompt, promptDraft]);

  useEffect(() => {
    const nextCommittedPrompt = data.config.prompt ?? '';

    setPromptDraft((currentPrompt) => {
      const syncResult = reducePromptExternalSync({
        draft: currentPrompt,
        committedPrompt: nextCommittedPrompt,
        isFocused: isPromptFocusedRef.current,
        isComposing: isPromptComposingRef.current,
        pendingRunPrompt: pendingPromptRunRef.current,
        shouldRunAfterComposition: shouldRunAfterPromptCompositionRef.current,
      }, nextCommittedPrompt);

      return currentPrompt === syncResult.state.draft ? currentPrompt : syncResult.state.draft;
    });
  }, [data.config.prompt]);

  useEffect(() => {
    const settleResult = reducePromptRunSettle(getPromptControllerState(), data.config.prompt ?? '');

    pendingPromptRunRef.current = settleResult.state.pendingRunPrompt;

    if (!settleResult.shouldRunNode) {
      return;
    }

    void actions.runAINode(data.id.value);
  }, [actions, data.config.prompt, data.id.value, getPromptControllerState]);

  const syncRuntimeSnapshot = useCallback((nextNodes = getNodes(), nextEdges = getEdges()): void => {
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, getEdges, getNodes, getViewport]);

  const getGroupStackOffset = useCallback((groupElement?: Element | null): number => {
    const resolveHeight = (element: Element | null | undefined): number | null => {
      if (!(element instanceof HTMLElement)) {
        return null;
      }

      const viewportZoom = getViewport().zoom;
      const zoom = Number.isFinite(viewportZoom) && viewportZoom > 0 ? viewportZoom : 1;
      const measuredHeight = element.getBoundingClientRect().height / zoom;
      if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
        return null;
      }

      return measuredHeight;
    };

    const measuredHeight =
      resolveHeight(groupElement) ??
      resolveHeight(groupLayerRef.current?.querySelector('.ai-image-gen-node__group--empty')) ??
      resolveHeight(groupLayerRef.current?.querySelector('.ai-image-gen-node__group')) ??
      DEFAULT_GROUP_HEIGHT;

    return Math.round(measuredHeight + GROUP_STACK_GAP);
  }, [getViewport]);

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

  const handleResizeStart = useNodeResizeInteraction<Partial<AINodeData>>({
    captureElementRef: wrapperRef,
    getViewportZoom: () => getViewport().zoom,
    resolveUpdate: ({ screenDelta, zoom }) => ({
      dimensions: resolveNodeResizeDimensions({
        startDimensions: data.dimensions,
        minDimensions: { width: MIN_WIDTH, height: MIN_HEIGHT },
        screenDelta,
        zoom,
      }),
    }),
    applyUpdate: updateNodeLocal,
    onResizeStart: () => setIsResizing(true),
    onResizeEnd: () => setIsResizing(false),
    onCommit: () => syncRuntimeSnapshot(),
  });

  const updateImageConfig = useCallback((patch: Partial<AINodeData['config']>) => {
    updateNodeConfig(() => patch);
  }, [updateNodeConfig]);

  useEffect(() => {
    const modelChanged = normalizedImageConfig.model !== data.config.model;
    const imageSizeChanged = usesParameterControls && normalizedImageConfig.imageSize !== data.config.imageSize;
    const aspectRatioChanged = usesParameterControls && normalizedImageConfig.aspectRatio !== data.config.aspectRatio;
    const qualityChanged = isOfficialModel && normalizedImageConfig.quality !== data.config.quality;

    if (!modelChanged && !imageSizeChanged && !aspectRatioChanged && !qualityChanged) {
      return;
    }

    updateImageConfig({
      model: normalizedImageConfig.model,
      ...(usesParameterControls
        ? {
            imageSize: normalizedImageConfig.imageSize,
            aspectRatio: normalizedImageConfig.aspectRatio,
          }
        : {}),
      ...(isOfficialModel ? { quality: normalizedImageConfig.quality } : {}),
    });
  }, [
    data.config.aspectRatio,
    data.config.imageSize,
    data.config.model,
    data.config.quality,
    isOfficialModel,
    normalizedImageConfig.aspectRatio,
    normalizedImageConfig.imageSize,
    normalizedImageConfig.model,
    normalizedImageConfig.quality,
    usesParameterControls,
    updateImageConfig,
  ]);

  const clearPromptCommitTimer = useCallback(() => {
    if (promptCommitTimerRef.current === null) {
      return;
    }

    window.clearTimeout(promptCommitTimerRef.current);
    promptCommitTimerRef.current = null;
  }, []);

  const commitPromptDraft = useCallback((nextPrompt = promptDraft) => {
    clearPromptCommitTimer();

    if (nextPrompt === (data.config.prompt ?? '')) {
      return;
    }

    updateImageConfig({ prompt: nextPrompt });
  }, [clearPromptCommitTimer, data.config.prompt, promptDraft, updateImageConfig]);

  const schedulePromptDraftCommit = useCallback((nextPrompt: string) => {
    clearPromptCommitTimer();
    promptCommitTimerRef.current = window.setTimeout(() => {
      promptCommitTimerRef.current = null;
      commitPromptDraft(nextPrompt);
    }, PROMPT_COMMIT_DEBOUNCE_MS);
  }, [clearPromptCommitTimer, commitPromptDraft]);

  useEffect(() => () => {
    clearPromptCommitTimer();
  }, [clearPromptCommitTimer]);

  useEffect(() => () => {
    optimizePromptRequestControllerRef.current.cancel();
  }, []);

  const handleRun = useCallback(() => {
    const runResult = reducePromptRun(getPromptControllerState());

    pendingPromptRunRef.current = runResult.state.pendingRunPrompt;
    shouldRunAfterPromptCompositionRef.current = runResult.state.shouldRunAfterComposition;

    if (runResult.state.shouldRunAfterComposition) {
      promptTextareaRef.current?.focus();
      return;
    }

    if (runResult.committedPrompt !== null) {
      commitPromptDraft(runResult.committedPrompt);
    }

    if (runResult.shouldRunNode) {
      pendingPromptRunRef.current = null;
      void actions.runAINode(data.id.value);
    }
  }, [actions, commitPromptDraft, data.id.value, getPromptControllerState]);

  const handleCancel = useCallback(() => {
    void actions.cancelAINodeRun(data.id.value);
  }, [actions, data.id.value]);

  const handleOptimizePrompt = useCallback(async (event: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    stopPointerEvent(event);

    if (!promptOptimizeAvailability.enabled) {
      return;
    }

    const nextPrompt = promptDraft.trim();
    clearPromptCommitTimer();
    if (nextPrompt !== (data.config.prompt ?? '')) {
      setPromptDraft(nextPrompt);
      updateImageConfig({ prompt: nextPrompt });
    }

    const requestHandle = optimizePromptRequestControllerRef.current.start();
    setIsOptimizingPrompt(true);

    try {
      await actions.optimizeAIImageGenPrompt(data.id.value, {
        signal: requestHandle.signal,
        prompt: nextPrompt,
      });
    } finally {
      if (optimizePromptRequestControllerRef.current.finish(requestHandle.requestId)) {
        setIsOptimizingPrompt(false);
      }
    }
  }, [
    actions,
    clearPromptCommitTimer,
    data.config.prompt,
    data.id.value,
    promptDraft,
    promptOptimizeAvailability.enabled,
    updateImageConfig,
  ]);

  const handlePromptCompositionStart = useCallback(() => {
    const nextState = reducePromptCompositionStart(getPromptControllerState()).state;
    isPromptComposingRef.current = nextState.isComposing;
    clearPromptCommitTimer();
  }, [clearPromptCommitTimer, getPromptControllerState]);

  const handlePromptCompositionEnd = useCallback((event: React.CompositionEvent<HTMLTextAreaElement>) => {
    const nextPrompt = event.currentTarget.value;
    const compositionResult = reducePromptCompositionEnd(getPromptControllerState(), nextPrompt);

    isPromptComposingRef.current = compositionResult.state.isComposing;
    shouldRunAfterPromptCompositionRef.current = compositionResult.state.shouldRunAfterComposition;
    clearPromptCommitTimer();
    setPromptDraft(compositionResult.state.draft);
    promptCommitTimerRef.current = window.setTimeout(() => {
      promptCommitTimerRef.current = null;
      if (compositionResult.state.pendingRunPrompt !== null) {
        pendingPromptRunRef.current = compositionResult.state.pendingRunPrompt;
      }

      if (compositionResult.committedPrompt !== null) {
        commitPromptDraft(compositionResult.committedPrompt);
      }

      if (compositionResult.shouldRunNode) {
        pendingPromptRunRef.current = null;
        void actions.runAINode(data.id.value);
      }
    }, 0);
  }, [actions, clearPromptCommitTimer, commitPromptDraft, data.id.value, getPromptControllerState]);

  const handlePromptFocus = useCallback(() => {
    isPromptFocusedRef.current = reducePromptFocus(getPromptControllerState()).state.isFocused;
  }, [getPromptControllerState]);

  const handlePromptBlur = useCallback((event: React.FocusEvent<HTMLTextAreaElement>) => {
    const nextPrompt = event.currentTarget.value;
    const blurResult = reducePromptBlur(getPromptControllerState(), nextPrompt);

    isPromptFocusedRef.current = blurResult.state.isFocused;
    isPromptComposingRef.current = blurResult.state.isComposing;
    clearPromptCommitTimer();
    setPromptDraft(blurResult.state.draft);

    if (blurResult.committedPrompt !== null) {
      commitPromptDraft(blurResult.committedPrompt);
    }
  }, [clearPromptCommitTimer, commitPromptDraft, getPromptControllerState]);

  const handlePromptChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextPrompt = event.target.value;
    const nativeIsComposing = (event.nativeEvent as Event & { isComposing?: boolean }).isComposing === true;
    const changeResult = reducePromptChange(getPromptControllerState(), nextPrompt, {
      isComposing: nativeIsComposing,
    });

    isPromptComposingRef.current = changeResult.state.isComposing;
    setPromptDraft(changeResult.state.draft);

    if (changeResult.shouldScheduleDebounceCommit) {
      schedulePromptDraftCommit(changeResult.state.draft);
    }
  }, [getPromptControllerState, schedulePromptDraftCommit]);

  const handleAspectRatioChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateImageConfig({ aspectRatio: event.target.value });
  }, [updateImageConfig]);

  const handleResolutionChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateImageConfig({ imageSize: event.target.value });
  }, [updateImageConfig]);

  const handleQualityChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateImageConfig({
      quality: normalizeAIImageGenNodeOfficialQuality(event.target.value),
    });
  }, [updateImageConfig]);

  const handleModelChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextModel = normalizeAIImageGenNodeModel(event.target.value);
    const nextConfig = normalizeAIImageGenNodeConfig({
      model: nextModel,
      imageSize: normalizedImageConfig.imageSize,
      aspectRatio: normalizedImageConfig.aspectRatio,
      quality: normalizedImageConfig.quality,
    });

    updateImageConfig({
      model: nextConfig.model,
      ...(!isAIImageGenNodeParameterlessModel(nextConfig.model)
        ? {
            imageSize: nextConfig.imageSize,
            aspectRatio: nextConfig.aspectRatio,
          }
        : {}),
      ...(isAIImageGenNodeOfficialModel(nextConfig.model) ? { quality: nextConfig.quality } : {}),
    });
  }, [
    normalizedImageConfig.aspectRatio,
    normalizedImageConfig.imageSize,
    normalizedImageConfig.quality,
    updateImageConfig,
  ]);

  const handleAddGroup = useCallback(() => {
    if (groups.length >= AI_IMAGE_GEN_MAX_GROUPS) {
      return;
    }

    const stackOffset = getGroupStackOffset();

    updateNodeStructure((currentNode) => {
      const nextPosition = {
        ...currentNode.position,
        y: currentNode.position.y - stackOffset,
      };

      return {
        ...currentNode,
        position: nextPosition,
        config: {
          ...currentNode.config,
          inputGroups: createAppendedInputGroups(currentNode.config, 1),
        },
        timestamp: {
          ...currentNode.timestamp,
          updated: Date.now(),
        },
      };
    });
  }, [getGroupStackOffset, groups.length, updateNodeStructure]);

  const handleRemoveGroup = useCallback((groupId: string, event: React.MouseEvent<HTMLButtonElement>): void => {
    stopPointerEvent(event);

    if (groups.length <= 1) {
      return;
    }

    const stackOffset = getGroupStackOffset(event.currentTarget.closest('.ai-image-gen-node__group'));
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const nextInputGroups = removeInputGroupAndReorder(groups, groupId);

    const nextEdges = currentEdges.filter((edge) => !(
      (edge.target === data.id.value && edge.targetHandle === getAIImageGenGroupInputHandle(groupId)) ||
      (edge.source === data.id.value && edge.sourceHandle === getAIImageGenGroupOutputHandle(groupId))
    ));

    const remainingOutputFileIds = new Set(
      nextEdges
        .filter((edge) =>
          edge.source === data.id.value &&
          getReactFlowEdgeConnectionType(edge) === 'output-link'
        )
        .flatMap((edge) => {
          const targetNode = currentNodes.find((node) => node.id === edge.target);
          if (!targetNode || !isFileNodeData(targetNode.data)) {
            return [];
          }

          return [targetNode.data.fileId];
        })
    );

    const nextNodes = currentNodes.map((node) => {
      if (node.id !== data.id.value) {
        return node;
      }

      const currentData = node.data as AINodeData;
      const nextPosition = {
        ...node.position,
        y: node.position.y + stackOffset,
      };
      const nextData: AINodeData = {
        ...currentData,
        position: nextPosition,
        config: {
          ...currentData.config,
          inputGroups: nextInputGroups,
        },
        outputs: currentData.outputs.filter((fileId) => remainingOutputFileIds.has(fileId)),
        timestamp: {
          ...currentData.timestamp,
          updated: Date.now(),
        },
      };

      return {
        ...node,
        data: nextData,
        position: nextPosition,
      };
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, data.id.value, getEdges, getGroupStackOffset, getNodes, getViewport, groups, setEdges, setNodes]);

  const handleSortDragStart = useCallback((
    groupId: string,
    sourceId: string,
    event: React.DragEvent<HTMLDivElement>
  ): void => {
    if (data.locked || isProcessing) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-ai-image-gen-sort', sourceId);
    setSortingState({
      groupId,
      activeSourceId: sourceId,
      overSourceId: sourceId,
    });
  }, [data.locked, isProcessing]);

  const handleSortDragOver = useCallback((
    groupId: string,
    sourceId: string,
    event: React.DragEvent<HTMLDivElement>
  ): void => {
    if (!sortingState || sortingState.groupId !== groupId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    setSortingState((current) => {
      if (!current || current.groupId !== groupId || current.overSourceId === sourceId) {
        return current;
      }

      return {
        ...current,
        overSourceId: sourceId,
      };
    });
  }, [sortingState]);

  const handleSortDragEnd = useCallback((): void => {
    setSortingState(null);
  }, []);

  const handleSortDrop = useCallback((
    groupId: string,
    overSourceId: string,
    event: React.DragEvent<HTMLDivElement>
  ): void => {
    if (!sortingState || sortingState.groupId !== groupId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const activeSourceId = sortingState.activeSourceId;
    setSortingState(null);

    if (activeSourceId === overSourceId) {
      return;
    }

    const inputHandle = getAIImageGenGroupInputHandle(groupId);
    const orderedSourceIds = getOrderedSourceIdsForHandle(getEdges(), data.id.value, inputHandle);
    const nextSourceIds = reorderGroupedPortSourceIds(orderedSourceIds, activeSourceId, overSourceId);

    if (nextSourceIds.length !== orderedSourceIds.length) {
      return;
    }

    const hasChanged = nextSourceIds.some((sourceId, index) => sourceId !== orderedSourceIds[index]);
    if (!hasChanged) {
      return;
    }

    const { nextEdges, nextNodes } = reorderGroupedPortInputs(getNodes(), getEdges(), {
      nodeId: data.id.value,
      inputHandle,
      outputHandle: getAIImageGenGroupOutputHandle(groupId),
      sourceIds: nextSourceIds,
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, data.id.value, getEdges, getNodes, getViewport, setEdges, setNodes, sortingState]);

  const handleRemoveGroupInput = useCallback((
    groupId: string,
    sourceId: string,
    event: React.MouseEvent<HTMLButtonElement>
  ): void => {
    stopPointerEvent(event);

    const { nextNodes, nextEdges } = removeGroupedPortInput(getNodes(), getEdges(), {
      nodeId: data.id.value,
      inputHandle: getAIImageGenGroupInputHandle(groupId),
      outputHandle: getAIImageGenGroupOutputHandle(groupId),
      sourceId,
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, data.id.value, getEdges, getNodes, getViewport, setEdges, setNodes]);

  const shellClasses = [
    'ai-image-gen-node-shell',
    selected ? 'ai-image-gen-node-shell--selected' : '',
    data.locked ? 'ai-image-gen-node-shell--locked' : '',
    isProcessing ? 'ai-image-gen-node-shell--processing' : '',
  ].filter(Boolean).join(' ');

  const wrapperClasses = [
    'node-wrapper',
    'ai-node',
    'ai-image-gen-node',
    selected ? 'selected' : '',
    data.locked ? 'locked' : '',
    isProcessing ? 'processing' : '',
    isResizing ? 'ai-image-gen-node--active' : '',
  ].filter(Boolean).join(' ');
  const compositeWidth = Math.max(MIN_WIDTH, data.dimensions.width);
  const compositeHeight = Math.max(MIN_HEIGHT, data.dimensions.height);

  return (
    <div
      className={shellClasses}
      style={{
        width: compositeWidth,
        minWidth: compositeWidth,
      }}
      data-node-id={data.id.value}
      data-node-dropzone="body"
    >
      <div className="ai-image-gen-node__group-layer nodrag nopan">
        <GroupedInputPanel
          className="grouped-drop-input-region"
          regionProps={inputRegionProps}
          panels={(
            <div
              className="grouped-drop-panel-target"
              style={{ gridColumn: '1 / -1' }}
              {...getPanelTargetProps({
                nodeId: data.id.value,
                side: 'input',
                panelLabel: '批量投放区',
              })}
            />
          )}
          groups={(
            <div ref={groupLayerRef} className="ai-image-gen-node__groups">
              {groupsWithExecution.map(({ group, inputs, execution }) => {
                const hasInputs = inputs.length > 0;
                const canRemoveGroup = groups.length > 1;
                const isInputInteractionDisabled = isGroupedInputInteractionDisabled({
                  locked: data.locked,
                  status: executionState?.status ?? null,
                });
                const canSortGroupInputs = !isInputInteractionDisabled && hasInputs && inputs.length > 1;
                const groupClasses = [
                  'ai-image-gen-node__group',
                  hasInputs ? 'ai-image-gen-node__group--filled' : 'ai-image-gen-node__group--empty',
                  execution?.status === 'processing' ? 'ai-image-gen-node__group--processing' : '',
                ].filter(Boolean).join(' ');
                const dropzoneClasses = [
                  'ai-image-gen-node__group-dropzone',
                  'grouped-drop-slot-target',
                  'grouped-drop-slot-surface',
                  hasInputs ? 'ai-image-gen-node__group-dropzone--filled' : 'ai-image-gen-node__group-dropzone--empty',
                ].join(' ');

                return (
                  <div
                    key={group.id}
                    className={groupClasses}
                    data-group-state={hasInputs ? 'filled' : 'empty'}
                  >
                    <Handle
                      id={getAIImageGenGroupInputHandle(group.id)}
                      type="target"
                      position={Position.Left}
                      className="react-flow__handle ai-image-gen-node__group-handle nodrag nopan"
                      style={{
                        background: nodeColor,
                        top: '50%',
                        left: -7,
                        transform: 'translateY(-50%)',
                      }}
                    />

                    <Handle
                      id={getAIImageGenGroupOutputHandle(group.id)}
                      type="source"
                      position={Position.Right}
                      className="react-flow__handle ai-image-gen-node__group-output-handle nodrag nopan"
                      style={{
                        background: nodeColor,
                        top: '50%',
                        right: -7,
                        transform: 'translateY(-50%)',
                      }}
                    />

                    <div className="ai-image-gen-node__group-header">
                      <div className="ai-image-gen-node__group-header-main">
                        <span className="ai-image-gen-node__group-title">{group.label}</span>
                        {execution?.status && (
                          <span className={`ai-image-gen-node__group-status ai-image-gen-node__group-status--${execution.status}`}>
                            {getGroupStatusLabel(execution.status)}
                          </span>
                        )}
                      </div>
                      <div className="ai-image-gen-node__group-header-actions">
                        <span className="ai-image-gen-node__group-meta">{inputs.length} / {AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP}</span>
                        <button
                          type="button"
                          className="ai-image-gen-node__group-delete-button nodrag nopan"
                          onMouseDown={stopPointerEvent}
                          onClick={(event) => handleRemoveGroup(group.id, event)}
                          disabled={!canRemoveGroup}
                          title={canRemoveGroup ? '删除输入组' : '至少保留一个输入组'}
                        >
                          x
                        </button>
                      </div>
                    </div>

                    <div
                      className={dropzoneClasses}
                      {...getSlotTargetProps({
                        nodeId: data.id.value,
                        groupId: group.id,
                        portId: AI_IMAGE_INPUT_PORT_ID,
                        side: 'input',
                      })}
                    >
                      {inputs.length > 0 ? (
                        <div className="ai-image-gen-node__group-inputs">
                          {inputs.map(({ sourceNode }, index) => {
                            const isSortingGroup = sortingState?.groupId === group.id;
                            const isDragged = sortingState?.activeSourceId === sourceNode.id.value;
                            const isDropTarget =
                              isSortingGroup &&
                              sortingState?.overSourceId === sourceNode.id.value &&
                              sortingState?.activeSourceId !== sourceNode.id.value;

                            return (
                              <GroupedInputItemChrome
                                key={sourceNode.id.value}
                                className="ai-image-gen-node__group-input"
                                title={getReferenceTitle(sourceNode)}
                                draggable={canSortGroupInputs}
                                onDragStart={(event) => handleSortDragStart(group.id, sourceNode.id.value, event)}
                                onDragOver={(event) => handleSortDragOver(group.id, sourceNode.id.value, event)}
                                onDrop={(event) => handleSortDrop(group.id, sourceNode.id.value, event)}
                                onDragEnd={handleSortDragEnd}
                                badge={<span className="ai-image-gen-node__group-input-order">{index + 1}</span>}
                                actions={(
                                  <GroupedInputActionButton
                                    aria-label={`绉婚櫎 ${sourceNode.fileName}`}
                                    title="绉婚櫎杈撳叆"
                                    disabled={isInputInteractionDisabled}
                                    onMouseDown={stopPointerEvent}
                                    onClick={(event) => handleRemoveGroupInput(group.id, sourceNode.id.value, event)}
                                  />
                                )}
                                sortable={canSortGroupInputs}
                                disabled={isInputInteractionDisabled}
                                dragging={isDragged}
                                dropTarget={isDropTarget}
                              >
                                <NodeInputImagePreview
                                  sourceNode={sourceNode}
                                  alt={sourceNode.fileName}
                                  draggable={false}
                                  fallback={(
                                    <div className="ai-image-gen-node__group-input-fallback">
                                      {sourceNode.fileName.slice(0, 10)}
                                    </div>
                                  )}
                                />
                              </GroupedInputItemChrome>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="ai-image-gen-node__group-placeholder">
                          拖入图片到该输入                        </div>
                      )}
                    </div>

                    {execution?.status === 'processing' && (
                      <div className="ai-image-gen-node__group-progress">
                        <div
                          className="ai-image-gen-node__group-progress-bar"
                          style={{ width: `${execution.progress}%`, backgroundColor: nodeColor }}
                        />
                      </div>
                    )}

                    {execution?.message && execution.status !== 'skipped' && (
                      <div className="ai-image-gen-node__group-message">
                        {execution.message}
                      </div>
                    )}

                    {execution?.error && (
                      <div className="ai-image-gen-node__group-error">
                        {execution.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          toolbar={(
            <>
              <button
                className="ai-image-gen-node__add-group nodrag nopan"
                type="button"
                onMouseDown={stopPointerEvent}
                onClick={handleAddGroup}
                disabled={groups.length >= AI_IMAGE_GEN_MAX_GROUPS}
                title={groups.length >= AI_IMAGE_GEN_MAX_GROUPS ? '最多 10 个输入组' : '新增输入组'}
              >
                + 添加输入组
              </button>

              <div className="ai-image-gen-node__footer-meta">
                <span className="ai-image-gen-node__footer-count">{groups.length} 组</span>
              </div>
            </>
          )}
        />
      </div>

      <div
        ref={wrapperRef}
        className={wrapperClasses}
        style={{
          borderColor: nodeColor,
          width: '100%',
          height: compositeHeight,
        }}
      >
        {isProcessing && (
          <div className="ai-node__processing-overlay">
            <div className="ai-node__processing-spinner" style={{ borderTopColor: nodeColor }} />
            <div className="ai-node__processing-text">
              {executionState?.message ?? '处理中...'}
            </div>
          </div>
        )}

        {!data.locked && (
          <>
            <button
              className="ai-image-gen-node__delete-button node-control-btn node-control-btn--delete nodrag nopan"
              title="删除"
              onMouseDown={stopPointerEvent}
              onClick={handleDelete}
            >
              {'×'}
            </button>

            <button
              className="node-control-btn node-control-btn--rotate nodrag nopan"
              title={isProcessing ? '取消运行' : canRun ? '运行节点' : '当前节点暂不可运行'}
              onMouseDown={stopPointerEvent}
              onClick={isProcessing ? handleCancel : handleRun}
              disabled={!isProcessing && !canRun}
            >
              {isProcessing ? '×' : '▶'}
            </button>

            <button
              className="ai-image-gen-node__resize-handle node-resize-handle nodrag nopan"
              onMouseDown={stopPointerEvent}
              onPointerDown={handleResizeStart}
              title="缂╂斁"
            />
          </>
        )}

        <div className="node-header ai-image-gen-node__titlebar" style={{ backgroundColor: `${nodeColor}1f` }}>
          <span className="node-type-icon">{nodeIcon}</span>
          <span className="node-type-name">{nodeInfo?.displayName || 'AI 鐢熷浘'}</span>
          <span className="ai-image-gen-node__title-id">{data.id.display}</span>
        </div>

        <div
          className="node-content ai-image-gen-node__content nodrag nopan"
          data-node-dropzone="body"
          data-node-id={data.id.value}
        >
          <label className="ai-image-gen-node__field ai-image-gen-node__prompt-field">
            <span
              className="ai-image-gen-node__label"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
            >
              <span>提示词</span>
              <button
                type="button"
                className="btn btn--secondary btn--sm nodrag nopan"
                title={promptOptimizeButtonTitle}
                onMouseDown={stopPointerEvent}
                onClick={handleOptimizePrompt}
                disabled={promptOptimizeButtonDisabled}
              >
                {isOptimizingPrompt ? '优化中...' : 'AI 提示词优化'}
              </button>
            </span>
            <textarea
              ref={promptTextareaRef}
              className="ai-image-gen-node__textarea nodrag nopan"
              value={promptDraft}
              onChange={handlePromptChange}
              onFocus={handlePromptFocus}
              onBlur={handlePromptBlur}
              onCompositionStart={handlePromptCompositionStart}
              onCompositionEnd={handlePromptCompositionEnd}
              placeholder="输入所有输入组共用的提示词"
              rows={4}
            />
            <span
              className="ai-image-gen-node__label"
              style={{ color: promptOptimizeAvailability.enabled ? 'var(--color-text-tertiary)' : 'var(--color-text-muted)' }}
            >
              {promptOptimizeAvailability.enabled
                ? (
                  promptOptimizeAvailability.referenceCount > 0
                    ? `可结合 ${promptOptimizeAvailability.referenceCount} 张参考图优化提示词`
                    : '可根据当前文本优化提示词'
                )
                : promptOptimizeDisabledReason}
            </span>
          </label>

          <div className="ai-image-gen-node__parameter-panel">
            <div className="ai-image-gen-node__parameter-grid">
              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">模型</span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={normalizedImageConfig.model}
                  onChange={handleModelChange}
                >
                  {AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {usesParameterControls && (
                <>
              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">比例</span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={normalizedImageConfig.aspectRatio}
                  onChange={handleAspectRatioChange}
                >
                  {aspectRatioOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">分辨率</span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={normalizedImageConfig.imageSize}
                  onChange={handleResolutionChange}
                >
                  {AI_IMAGE_GEN_NODE_IMAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
                </>
              )}
              {isOfficialModel && (
                <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                  <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">质量</span>
                  <select
                    className="select ai-image-gen-node__select nodrag nopan"
                    value={normalizedImageConfig.quality}
                    onChange={handleQualityChange}
                  >
                    {AI_IMAGE_GEN_NODE_OFFICIAL_QUALITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="ai-image-gen-node__footer">
          <span className="node-id">{data.id.display}</span>
          {!data.locked && (
            <div className="ai-image-gen-node__footer-actions">
              <button
                type="button"
                className={[
                  'ai-image-gen-node__footer-run-button',
                  isProcessing
                    ? 'ai-image-gen-node__footer-run-button--cancel'
                    : 'ai-image-gen-node__footer-run-button--run',
                ].join(' ')}
                title={isProcessing ? '取消运行' : canRun ? '运行节点' : '当前节点暂不可运行'}
                onMouseDown={stopPointerEvent}
                onClick={isProcessing ? handleCancel : handleRun}
                disabled={!isProcessing && !canRun}
              >
                {isProcessing ? '取消' : '运行'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

AIImageGenNodeInner.displayName = 'AIImageGenNodeInner';

export const AIImageGenNode = memo((props: AINodeProps) => (
  <NodeErrorBoundary nodeId={props.data.id.value} nodeType={props.data.type}>
    <AIImageGenNodeInner {...props} />
  </NodeErrorBoundary>
));

AIImageGenNode.displayName = 'AIImageGenNode';
