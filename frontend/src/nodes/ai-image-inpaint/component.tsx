import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Handle,
  Position,
  type NodeProps,
  useReactFlow,
  useUpdateNodeInternals,
} from 'reactflow';
import type {
  AIImageInpaintMaskDraftState,
  AIImageInpaintMaskSnapshot,
  AINodeData,
  AnyNodeData,
  FileNodeData,
} from '@/types';
import { NodeErrorBoundary } from '@/components/ui/ErrorBoundary';
import { NODE_TYPE_INFO } from '@/constants';
import { createWorkflowRuntimeSnapshot } from '@/utils';
import { removeGroupedPortInput } from '../shared/grouped-input-edit';
import { patchNodeConfigInGraph } from '../shared/node-config-updater';
import {
  resolveNodeResizeDimensions,
  useNodeResizeInteraction,
} from '../shared/useNodeResizeInteraction';
import {
  handleNodePromptBlur as reducePromptBlur,
  handleNodePromptChange as reducePromptChange,
  handleNodePromptCompositionEnd as reducePromptCompositionEnd,
  handleNodePromptCompositionStart as reducePromptCompositionStart,
  handleNodePromptFocus as reducePromptFocus,
  handleNodePromptRun as reducePromptRun,
  settleNodePromptRun as reducePromptRunSettle,
  syncNodePromptControllerFromExternal as reducePromptExternalSync,
  type NodePromptControllerState,
} from '../shared/prompt-controller';
import { useNodeRuntimeBindings } from '../runtime-bindings';
import {
  AI_IMAGE_INPAINT_COLOR,
  AI_IMAGE_INPAINT_DISPLAY_NAME,
  AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP,
  AI_IMAGE_INPAINT_ICON,
  AI_IMAGE_INPAINT_MASK_MODE_OPTIONS,
  AI_IMAGE_INPAINT_BODY_MIN_HEIGHT,
  AI_IMAGE_INPAINT_MIN_HEIGHT,
  AI_IMAGE_INPAINT_MIN_EDITOR_HEIGHT,
  AI_IMAGE_INPAINT_MIN_WIDTH,
  AI_IMAGE_INPAINT_NODE_IMAGE_SIZE_OPTIONS,
  AI_IMAGE_INPAINT_NODE_MODEL_OPTIONS,
  getAIImageInpaintNodeAspectRatioOptions,
  isAIImageInpaintNodeParameterlessModel,
  normalizeAIImageInpaintEditorHeight,
  normalizeAIImageInpaintMaskMode,
  normalizeAIImageInpaintNodeConfig,
  normalizeAIImageInpaintNodeModel,
  resolveAIImageInpaintEditorSize,
} from './constants';
import {
  createAIImageInpaintInputGroup,
  getAIImageInpaintInputHandle,
  getAIImageInpaintOutputHandle,
} from './groups';
import {
  InpaintCanvasEditor,
  type InpaintCanvasEditorState,
} from './InpaintCanvasEditor';
import { InpaintXIcon } from './icons';
import { registerAIImageInpaintMaskExporter } from './export-registry';
import { normalizeAIImageInpaintMaskStrokes } from './mask-strokes';

interface AIImageInpaintNodeProps extends NodeProps<AINodeData> {}

const PROMPT_COMMIT_DEBOUNCE_MS = 300;
const NODE_CHROME_HEIGHT = 78;

function areMaskDraftStatesEqual(
  left: AIImageInpaintMaskDraftState | null,
  right: AIImageInpaintMaskDraftState | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  const leftSource = left.sourceInfo;
  const rightSource = right.sourceInfo;
  const sourceEqual = leftSource === rightSource || (
    Boolean(leftSource) &&
    Boolean(rightSource) &&
    leftSource?.fileId === rightSource?.fileId &&
    leftSource?.width === rightSource?.width &&
    leftSource?.height === rightSource?.height
  );

  return left.hasMarks === right.hasMarks
    && left.dirty === right.dirty
    && sourceEqual;
}

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function getNormalizedEditorHeight(value: unknown): number {
  return normalizeAIImageInpaintEditorHeight(value);
}

function getMinimumNodeHeight(): number {
  return Math.max(
    AI_IMAGE_INPAINT_MIN_HEIGHT,
    AI_IMAGE_INPAINT_BODY_MIN_HEIGHT + NODE_CHROME_HEIGHT,
  );
}

function getPositiveDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function resolveSourceEditorDimensions(
  sourceNode: FileNodeData | null,
  draftState: AIImageInpaintMaskDraftState | null,
): { width?: number; height?: number } {
  const draftSource = draftState?.sourceInfo;
  if (draftSource && draftSource.width > 0 && draftSource.height > 0) {
    return {
      width: draftSource.width,
      height: draftSource.height,
    };
  }

  if (!sourceNode) {
    return {};
  }

  const candidates = [
    sourceNode.imageAsset?.intrinsicSize,
    sourceNode.imageAsset?.variants.original,
    sourceNode.metadata,
    sourceNode.dimensions,
  ];
  for (const candidate of candidates) {
    const width = getPositiveDimension(candidate?.width);
    const height = getPositiveDimension(candidate?.height);
    if (width && height) {
      return { width, height };
    }
  }

  return {};
}

function getGroupStatusLabel(
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped' | null | undefined,
): string | null {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'processing':
      return '处理中';
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

const AIImageInpaintNodeInner: React.FC<AIImageInpaintNodeProps> = ({
  data,
  selected,
}) => {
  const {
    workflowId,
    actions,
    selectors,
    nodeExecutionRuntime,
    groupExecutionStates,
  } = useNodeRuntimeBindings();
  const updateNodeConfig = useNodeConfigEditor(data.id.value, data.type);
  const { getNodes, getEdges, getViewport, setNodes, setEdges } = useReactFlow<AnyNodeData>();
  const updateNodeInternals = useUpdateNodeInternals();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const editorResizeRef = useRef<HTMLButtonElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isPromptFocusedRef = useRef(false);
  const isPromptComposingRef = useRef(false);
  const promptCommitTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pendingPromptRunRef = useRef<string | null>(null);
  const shouldRunAfterPromptCompositionRef = useRef(false);
  const maskEditorStateRef = useRef<InpaintCanvasEditorState | null>(null);
  const maskDraftStateRef = useRef<AIImageInpaintMaskDraftState | null>(null);
  const maskSnapshotRef = useRef<AIImageInpaintMaskSnapshot | null>(null);
  const [isNodeResizing, setIsNodeResizing] = useState(false);
  const [isEditorResizing, setIsEditorResizing] = useState(false);
  const [resizingEditorHeight, setResizingEditorHeight] = useState<number | null>(null);
  const [promptDraft, setPromptDraft] = useState(data.config.prompt ?? '');
  const [maskDraftState, setMaskDraftState] = useState<AIImageInpaintMaskDraftState | null>(null);
  const actionsRef = useRef(actions);

  const nodeInfo = NODE_TYPE_INFO[data.type];
  const nodeColor = nodeInfo?.color || AI_IMAGE_INPAINT_COLOR;
  const nodeIcon = nodeInfo?.icon || AI_IMAGE_INPAINT_ICON;
  const executionState = nodeExecutionRuntime?.executionState ?? null;
  const isProcessing = nodeExecutionRuntime?.isProcessing ?? false;
  const canRun = selectors.canRunNode(data.id.value);
  const groupExecutionStateMap = useMemo(
    () => new Map(groupExecutionStates.map((groupState) => [groupState.groupId, groupState] as const)),
    [groupExecutionStates],
  );
  const resolvedGroupState = selectors.getResolvedNodeInputGroups(data.id.value)[0] ?? null;
  const sourceInput = resolvedGroupState?.ports
    .find((port) => port.portId === 'image')
    ?.inputs[0] ?? null;
  const sourceNode: FileNodeData | null = sourceInput?.sourceNode.type === 'image'
    ? sourceInput.sourceNode
    : null;
  const committedEditorHeight = getNormalizedEditorHeight(data.config.editorHeight);
  const editorHeight = resizingEditorHeight ?? committedEditorHeight;
  const sourceEditorDimensions = resolveSourceEditorDimensions(sourceNode, maskDraftState);
  const editorSize = resolveAIImageInpaintEditorSize({
    editorHeight,
    sourceWidth: sourceEditorDimensions.width,
    sourceHeight: sourceEditorDimensions.height,
  });
  const minimumNodeHeight = getMinimumNodeHeight();
  const groupExecution = resolvedGroupState
    ? groupExecutionStateMap.get(resolvedGroupState.group.id) ?? null
    : null;
  const normalizedImageConfig = useMemo(() => normalizeAIImageInpaintNodeConfig({
    model: data.config.model,
    imageSize: data.config.imageSize,
    aspectRatio: data.config.aspectRatio,
  }), [data.config.aspectRatio, data.config.imageSize, data.config.model]);
  const aspectRatioOptions = useMemo(
    () => getAIImageInpaintNodeAspectRatioOptions(normalizedImageConfig.model),
    [normalizedImageConfig.model],
  );
  const usesParameterControls = !isAIImageInpaintNodeParameterlessModel(normalizedImageConfig.model);
  const normalizedMaskMode = normalizeAIImageInpaintMaskMode(data.config.maskMode);
  const maskStrokes = useMemo(
    () => normalizeAIImageInpaintMaskStrokes(data.config.maskStrokes),
    [data.config.maskStrokes],
  );
  const hasRuntimeMaskMarks = maskDraftState?.hasMarks ?? data.config.hasMaskMarks === true;
  const canRunFromDraftState = maskDraftState
    ? (
      hasRuntimeMaskMarks &&
      Boolean(sourceNode) &&
      promptDraft.trim().length > 0
    )
    : canRun;
  const runButtonTitle = isProcessing
    ? '取消运行'
    : canRunFromDraftState
      ? '运行节点'
      : '当前节点缺少有效输入';
  const inputLayoutVersion = [
    sourceNode?.id.value ?? '',
    groupExecution?.status ?? '',
    groupExecution?.progress ?? '',
    groupExecution?.message ?? '',
    groupExecution?.error ?? '',
    isEditorResizing ? committedEditorHeight : editorSize.height,
    isEditorResizing ? 'resizing' : editorSize.height,
    isEditorResizing ? 'resizing' : editorSize.width,
    isEditorResizing ? 'resizing' : editorSize.totalHeight,
    minimumNodeHeight,
  ].join(':');

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      updateNodeInternals(data.id.value);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    data.dimensions.height,
    data.dimensions.width,
    data.id.value,
    inputLayoutVersion,
    updateNodeInternals,
  ]);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  const getPromptControllerState = useCallback((): NodePromptControllerState => ({
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

    const snapshot = maskEditorStateRef.current?.commitMaskSnapshot() ?? null;
    const canRunAfterSnapshot = Boolean(snapshot) || canRunFromDraftState;

    window.setTimeout(() => {
      if (canRunAfterSnapshot) {
        void actionsRef.current.runAINode(data.id.value);
      }
    }, 0);
  }, [canRunFromDraftState, data.config.prompt, data.id.value, getPromptControllerState]);

  const syncRuntimeSnapshot = useCallback((nextNodes = getNodes(), nextEdges = getEdges()): void => {
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
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

  const commitNodeLocal = useCallback((updates: Partial<AINodeData>): void => {
    const nextNodes = getNodes().map((node) => {
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
    });

    setNodes(nextNodes);
    syncRuntimeSnapshot(nextNodes);
  }, [data.id.value, getNodes, setNodes, syncRuntimeSnapshot]);

  const handleResizeStart = useNodeResizeInteraction<Partial<AINodeData>>({
    captureElementRef: wrapperRef,
    getViewportZoom: () => getViewport().zoom,
    resolveUpdate: ({ screenDelta, zoom }) => ({
      dimensions: resolveNodeResizeDimensions({
        startDimensions: data.dimensions,
        minDimensions: {
          width: AI_IMAGE_INPAINT_MIN_WIDTH,
          height: minimumNodeHeight,
        },
        screenDelta,
        zoom,
      }),
    }),
    applyUpdate: updateNodeLocal,
    onResizeStart: () => setIsNodeResizing(true),
    onResizeEnd: () => setIsNodeResizing(false),
    onCommit: () => syncRuntimeSnapshot(),
  });

  const handleEditorResizeStart = useNodeResizeInteraction<Partial<AINodeData>>({
    captureElementRef: editorResizeRef,
    getViewportZoom: () => getViewport().zoom,
    resolveUpdate: ({ canvasDelta }) => {
      const dominantDelta = Math.abs(canvasDelta.x) > Math.abs(canvasDelta.y)
        ? canvasDelta.x
        : -canvasDelta.y;
      const nextEditorHeight = Math.max(
        AI_IMAGE_INPAINT_MIN_EDITOR_HEIGHT,
        Math.round(committedEditorHeight + dominantDelta),
      );

      return {
        config: {
          ...data.config,
          editorHeight: nextEditorHeight,
        },
      };
    },
    applyUpdate: (update) => {
      const nextHeight = getNormalizedEditorHeight(update.config?.editorHeight);
      setResizingEditorHeight((current) => (current === nextHeight ? current : nextHeight));
    },
    onResizeStart: () => {
      setResizingEditorHeight(committedEditorHeight);
      setIsEditorResizing(true);
    },
    onResizeEnd: () => setIsEditorResizing(false),
    onCommit: (update) => {
      setResizingEditorHeight(null);
      if (!update) {
        return;
      }
      commitNodeLocal(update);
    },
  });

  const updateImageConfig = useCallback((patch: Partial<AINodeData['config']>) => {
    updateNodeConfig(() => patch);
  }, [updateNodeConfig]);

  const syncLightweightMaskConfig = useCallback((state: AIImageInpaintMaskDraftState): void => {
    const patch: Partial<AINodeData['config']> = {};
    const nextHasMaskMarks = state.hasMarks;
    if (data.config.hasMaskMarks !== nextHasMaskMarks) {
      patch.hasMaskMarks = nextHasMaskMarks;
    }

    const source = state.sourceInfo;
    if (source) {
      if (data.config.maskSourceFileId !== source.fileId) {
        patch.maskSourceFileId = source.fileId;
      }
      if (data.config.maskSourceWidth !== source.width) {
        patch.maskSourceWidth = source.width;
      }
      if (data.config.maskSourceHeight !== source.height) {
        patch.maskSourceHeight = source.height;
      }
    }

    if (Object.keys(patch).length > 0) {
      updateImageConfig(patch);
    }
  }, [
    data.config.hasMaskMarks,
    data.config.maskSourceFileId,
    data.config.maskSourceHeight,
    data.config.maskSourceWidth,
    updateImageConfig,
  ]);

  useEffect(() => {
    const modelChanged = normalizedImageConfig.model !== data.config.model;
    const imageSizeChanged = usesParameterControls && normalizedImageConfig.imageSize !== data.config.imageSize;
    const aspectRatioChanged = usesParameterControls && normalizedImageConfig.aspectRatio !== data.config.aspectRatio;
    const maskModeChanged = normalizedMaskMode !== data.config.maskMode;

    if (!modelChanged && !imageSizeChanged && !aspectRatioChanged && !maskModeChanged) {
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
      maskMode: normalizedMaskMode,
      inputGroups: createAIImageInpaintInputGroup(),
    });
  }, [
    data.config.aspectRatio,
    data.config.imageSize,
    data.config.maskMode,
    data.config.model,
    normalizedImageConfig.aspectRatio,
    normalizedImageConfig.imageSize,
    normalizedImageConfig.model,
    normalizedMaskMode,
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
        const snapshot = maskEditorStateRef.current?.commitMaskSnapshot() ?? null;
        const canRunAfterSnapshot = Boolean(snapshot) || canRunFromDraftState;

        if (canRunAfterSnapshot) {
          void actionsRef.current.runAINode(data.id.value);
        }
      }
    }, 0);
  }, [
    canRunFromDraftState,
    clearPromptCommitTimer,
    commitPromptDraft,
    data.id.value,
    getPromptControllerState,
  ]);

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

  const handleModelChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextModel = normalizeAIImageInpaintNodeModel(event.target.value);
    const nextConfig = normalizeAIImageInpaintNodeConfig({
      model: nextModel,
      imageSize: normalizedImageConfig.imageSize,
      aspectRatio: normalizedImageConfig.aspectRatio,
    });

    updateImageConfig({
      model: nextConfig.model,
      ...(!isAIImageInpaintNodeParameterlessModel(nextConfig.model)
        ? {
            imageSize: nextConfig.imageSize,
            aspectRatio: nextConfig.aspectRatio,
          }
        : {}),
    });
  }, [
    normalizedImageConfig.aspectRatio,
    normalizedImageConfig.imageSize,
    updateImageConfig,
  ]);

  const handleAspectRatioChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateImageConfig({ aspectRatio: event.target.value });
  }, [updateImageConfig]);

  const handleImageSizeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateImageConfig({ imageSize: event.target.value });
  }, [updateImageConfig]);

  const handleMaskModeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateImageConfig({ maskMode: normalizeAIImageInpaintMaskMode(event.target.value) });
  }, [updateImageConfig]);

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

    if (!runResult.shouldRunNode) {
      return;
    }

    pendingPromptRunRef.current = null;
    const snapshot = maskEditorStateRef.current?.commitMaskSnapshot() ?? null;
    const canRunAfterSnapshot = Boolean(snapshot) || canRunFromDraftState;

    window.setTimeout(() => {
      if (canRunAfterSnapshot) {
        void actionsRef.current.runAINode(data.id.value);
      }
    }, 0);
  }, [
    canRunFromDraftState,
    commitPromptDraft,
    data.id.value,
    getPromptControllerState,
  ]);

  const handleCancel = useCallback(() => {
    void actions.cancelAINodeRun(data.id.value);
  }, [actions, data.id.value]);

  const handleDelete = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    stopPointerEvent(event);

    const currentEdges = getEdges();
    const relatedConnections = currentEdges.filter((edge) =>
      edge.source === data.id.value || edge.target === data.id.value
    );

    if (relatedConnections.length > 0) {
      const confirmed = window.confirm(`璇ヨ妭鐐瑰瓨鍦?${relatedConnections.length} 鏉¤繛鎺ワ紝纭鍒犻櫎鍚楋紵`);
      if (!confirmed) {
        return;
      }
    }

    const nextNodes = getNodes().filter((node) => node.id !== data.id.value);
    const nextEdges = currentEdges.filter((edge) =>
      edge.source !== data.id.value && edge.target !== data.id.value
    );
    setNodes(nextNodes);
    setEdges(nextEdges);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, data.id.value, getEdges, getNodes, getViewport, setEdges, setNodes]);

  const handleRemoveSource = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    stopPointerEvent(event);
    if (!sourceNode) {
      return;
    }

    const { nextNodes, nextEdges } = removeGroupedPortInput(getNodes(), getEdges(), {
      nodeId: data.id.value,
      inputHandle: getAIImageInpaintInputHandle(),
      outputHandle: getAIImageInpaintOutputHandle(),
      sourceId: sourceNode.id.value,
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
    updateImageConfig({
      hasMaskMarks: false,
      maskStrokes: [],
      maskSourceFileId: undefined,
      maskSourceWidth: undefined,
      maskSourceHeight: undefined,
    });
  }, [
    actions,
    data.id.value,
    getEdges,
    getNodes,
    getViewport,
    setEdges,
    setNodes,
    sourceNode,
    updateImageConfig,
  ]);

  const shellClasses = [
    'ai-image-gen-node-shell',
    'ai-image-inpaint-node-shell',
    selected ? 'ai-image-gen-node-shell--selected' : '',
    data.locked ? 'ai-image-gen-node-shell--locked' : '',
    isProcessing ? 'ai-image-gen-node-shell--processing' : '',
    isEditorResizing ? 'ai-image-inpaint-node-shell--editor-resizing' : '',
  ].filter(Boolean).join(' ');

  const wrapperClasses = [
    'node-wrapper',
    'ai-node',
    'ai-image-gen-node',
    'ai-image-inpaint-node',
    selected ? 'selected' : '',
    data.locked ? 'locked' : '',
    isProcessing ? 'processing' : '',
    (isNodeResizing || isEditorResizing) ? 'ai-image-gen-node--active' : '',
  ].filter(Boolean).join(' ');

  const compositeWidth = Math.max(AI_IMAGE_INPAINT_MIN_WIDTH, data.dimensions.width);
  const compositeHeight = Math.max(minimumNodeHeight, data.dimensions.height);
  const outputHandleTop = Math.round(compositeHeight / 2);
  const groupStatusLabel = getGroupStatusLabel(groupExecution?.status ?? null);
  useEffect(() => registerAIImageInpaintMaskExporter(
    data.id.value,
    {
      commitSnapshot: () => maskEditorStateRef.current?.commitMaskSnapshot() ?? null,
      exportMask: ({ mode }) => {
        const editorState = maskEditorStateRef.current;
        editorState?.flushMaskDraft();
        const exporter = editorState?.exportMaskBlob;
        if (!exporter) {
          return Promise.reject(new Error('Inpaint editor is not ready'));
        }

        return exporter(mode);
      },
    },
  ), [data.id.value]);

  const handleMaskEditorStateChange = useCallback((state: InpaintCanvasEditorState) => {
    maskEditorStateRef.current = state;
    maskDraftStateRef.current = state.draftState;
    setMaskDraftState((current) => (
      areMaskDraftStatesEqual(current, state.draftState) ? current : state.draftState
    ));
  }, []);

  const handleMaskDraftStateChange = useCallback((state: AIImageInpaintMaskDraftState) => {
    maskDraftStateRef.current = state;
    setMaskDraftState((current) => (
      areMaskDraftStatesEqual(current, state) ? current : state
    ));
    syncLightweightMaskConfig(state);
  }, [syncLightweightMaskConfig]);

  const handleMaskSnapshotCommit = useCallback((snapshot: AIImageInpaintMaskSnapshot | null): void => {
    maskSnapshotRef.current = snapshot;
    if (!snapshot) {
      return;
    }

    updateImageConfig({
      hasMaskMarks: snapshot.hasMarks,
      maskStrokes: snapshot.strokes,
      maskSourceFileId: snapshot.sourceInfo.fileId,
      maskSourceWidth: snapshot.sourceInfo.width,
      maskSourceHeight: snapshot.sourceInfo.height,
    });
  }, [updateImageConfig]);

  const floatingEditor = (
    <div
      className="ai-image-inpaint-node__editor-shell nodrag nopan"
      data-node-dropzone="body"
      data-node-id={data.id.value}
      style={{
        '--inpaint-editor-height': `${editorSize.totalHeight}px`,
        '--inpaint-editor-width': `${editorSize.width}px`,
        '--inpaint-editor-gap': `${AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP}px`,
      } as React.CSSProperties}
    >
      {sourceNode && (
        <div
          className="ai-image-inpaint-node__editor-titlebar nodrag nopan"
          data-node-dropzone="body"
          data-node-id={data.id.value}
        >
          <span className="ai-image-inpaint-node__editor-source-title" title={getReferenceTitle(sourceNode)}>
            {sourceNode.fileName}
          </span>
          {groupStatusLabel ? (
            <span className={`ai-image-gen-node__group-status ai-image-gen-node__group-status--${groupExecution?.status}`}>
              {groupStatusLabel}
            </span>
          ) : null}
          <button
            type="button"
            className="ai-image-inpaint-editor__icon-button nodrag nopan"
            aria-label="移除原图"
            title="移除原图"
            onMouseDown={stopPointerEvent}
            onClick={handleRemoveSource}
            disabled={isProcessing || data.locked}
          >
            <InpaintXIcon className="ai-image-inpaint-editor__button-icon" />
          </button>
        </div>
      )}

      <div
        className={[
          'ai-image-inpaint-node__editor',
          sourceNode ? 'ai-image-inpaint-node__editor--filled' : 'ai-image-inpaint-node__editor--empty',
        ].join(' ')}
        data-node-dropzone="body"
        data-node-id={data.id.value}
      >
        <InpaintCanvasEditor
          nodeId={data.id.value}
          sourceNode={sourceNode}
          maskMode={normalizedMaskMode}
          maskStrokes={maskStrokes}
          maskSourceFileId={typeof data.config.maskSourceFileId === 'string' ? data.config.maskSourceFileId : undefined}
          maskSourceWidth={typeof data.config.maskSourceWidth === 'number' ? data.config.maskSourceWidth : undefined}
          maskSourceHeight={typeof data.config.maskSourceHeight === 'number' ? data.config.maskSourceHeight : undefined}
          disabled={isProcessing || data.locked}
          deferPreviewResize={isEditorResizing}
          workflowId={workflowId}
          onStateChange={handleMaskEditorStateChange}
          onMaskDraftStateChange={handleMaskDraftStateChange}
          onMaskSnapshotCommit={handleMaskSnapshotCommit}
        />

        {groupExecution?.status === 'processing' && (
          <div className="ai-image-gen-node__group-progress ai-image-inpaint-node__editor-progress">
            <div
              className="ai-image-gen-node__group-progress-bar"
              style={{ width: `${groupExecution.progress}%`, backgroundColor: nodeColor }}
            />
          </div>
        )}
      </div>

      {!data.locked && (
        <button
          ref={editorResizeRef}
          type="button"
          className="ai-image-inpaint-node__editor-resize-handle nodrag nopan"
          aria-label="Resize image editor"
          title="Resize image editor"
          onMouseDown={stopPointerEvent}
          onPointerDown={handleEditorResizeStart}
        />
      )}

      <Handle
        id={getAIImageInpaintInputHandle()}
        type="target"
        position={Position.Left}
        className="react-flow__handle ai-image-gen-node__group-handle ai-image-inpaint-node__editor-input-handle nodrag nopan"
        style={{
          background: nodeColor,
          top: '50%',
          left: -7,
          transform: 'translateY(-50%)',
        }}
      />
    </div>

  );

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
      {floatingEditor}
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
              title="Delete node"
              onMouseDown={stopPointerEvent}
              onClick={handleDelete}
            >
              X
            </button>

            <button
              className="node-control-btn node-control-btn--rotate nodrag nopan"
              title={runButtonTitle}
              onMouseDown={stopPointerEvent}
              onClick={isProcessing ? handleCancel : handleRun}
              disabled={!isProcessing && !canRunFromDraftState}
            >
              {isProcessing ? 'X' : '>'}
            </button>

            <button
              className="ai-image-gen-node__resize-handle node-resize-handle nodrag nopan"
              onMouseDown={stopPointerEvent}
              onPointerDown={handleResizeStart}
              title="Resize node"
            />
          </>
        )}

        <div
          className="node-header ai-image-gen-node__titlebar"
          style={{ backgroundColor: `${nodeColor}1f` }}
        >
          <span className="node-type-icon">{nodeIcon}</span>
          <span className="node-type-name">
            {nodeInfo?.displayName || AI_IMAGE_INPAINT_DISPLAY_NAME}
          </span>
          <span className="ai-image-gen-node__title-id">{data.id.display}</span>
        </div>

        <Handle
          id={getAIImageInpaintOutputHandle()}
          type="source"
          position={Position.Right}
          className="react-flow__handle ai-image-gen-node__group-output-handle nodrag nopan"
          style={{
            background: nodeColor,
            top: outputHandleTop,
            right: -7,
            transform: 'translateY(-50%)',
          }}
        />

        <div
          className="node-content ai-image-gen-node__content ai-image-inpaint-node__content nodrag nopan"
          data-node-dropzone="body"
          data-node-id={data.id.value}
        >
          {(groupExecution?.message || groupExecution?.error) && (
            <div className="ai-image-inpaint-node__execution-messages">
              {groupExecution?.message && groupExecution.status !== 'skipped' && (
                <div className="ai-image-gen-node__group-message">
                  {groupExecution.message}
                </div>
              )}

              {groupExecution?.error && (
                <div className="ai-image-gen-node__group-error">
                  {groupExecution.error}
                </div>
              )}
            </div>
          )}

          <label className="ai-image-gen-node__field ai-image-gen-node__prompt-field">
            <span className="ai-image-gen-node__label">提示词</span>
            <textarea
              ref={promptTextareaRef}
              className="ai-image-gen-node__textarea nodrag nopan"
              value={promptDraft}
              onChange={handlePromptChange}
              onFocus={handlePromptFocus}
              onBlur={handlePromptBlur}
              onCompositionStart={handlePromptCompositionStart}
              onCompositionEnd={handlePromptCompositionEnd}
              placeholder="描述希望局部重绘得到的效果"
              rows={3}
            />
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
                  {AI_IMAGE_INPAINT_NODE_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">遮罩模式</span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={normalizedMaskMode}
                  onChange={handleMaskModeChange}
                >
                  {AI_IMAGE_INPAINT_MASK_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {usesParameterControls && (
                <>
              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">画面比例</span>
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
                </>
              )}

              {usesParameterControls && (
              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">图片尺寸</span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={normalizedImageConfig.imageSize}
                  onChange={handleImageSizeChange}
                >
                  {AI_IMAGE_INPAINT_NODE_IMAGE_SIZE_OPTIONS.map((option) => (
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
                title={runButtonTitle}
                onMouseDown={stopPointerEvent}
                onClick={isProcessing ? handleCancel : handleRun}
                disabled={!isProcessing && !canRunFromDraftState}
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

AIImageInpaintNodeInner.displayName = 'AIImageInpaintNodeInner';

export const AIImageInpaintNode = memo((props: AIImageInpaintNodeProps) => (
  <NodeErrorBoundary nodeId={props.data.id.value} nodeType={props.data.type}>
    <AIImageInpaintNodeInner {...props} />
  </NodeErrorBoundary>
));

AIImageInpaintNode.displayName = 'AIImageInpaintNode';
