import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Handle,
  Position,
  type Edge as ReactFlowEdge,
  type NodeProps,
  useReactFlow,
  useUpdateNodeInternals,
} from 'reactflow';
import type { AINodeData, AnyNodeData } from '@/types';
import { NodeErrorBoundary } from '@/components/ui/ErrorBoundary';
import {
  NODE_TYPE_INFO,
  getExecutionDetailLines,
  getExecutionErrorMessage,
  getExecutionStatusLabel,
  getMissingInputMessage,
} from '@/constants';
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
import { NodeInputImagePreview } from '../shared/NodeInputImagePreview';
import {
  GroupedDualInputPanel,
  GroupedInputActionButton,
  GroupedInputItemChrome,
} from '../shared/GroupedInputPanel';
import {
  isGroupedInputInteractionDisabled,
  removeGroupedPortInput,
} from '../shared/grouped-input-edit';
import { useGroupedDropInteraction } from '../shared/grouped-drop/useGroupedDropInteraction';
import {
  resolveNodeResizeDimensions,
  useNodeResizeInteraction,
} from '../shared/useNodeResizeInteraction';
import {
  MODEL_RENDER_TRANSFER_DEFAULT_ASPECT_RATIO,
  MODEL_RENDER_TRANSFER_DEFAULT_IMAGE_SIZE,
  MODEL_RENDER_TRANSFER_DEFAULT_SIZE,
  MODEL_RENDER_TRANSFER_MAX_GROUPS,
  MODEL_RENDER_TRANSFER_MIN_GROUPS,
  MODEL_RENDER_TRANSFER_NODE_IMAGE_SIZE_OPTIONS,
  MODEL_RENDER_TRANSFER_NODE_MODEL_OPTIONS,
  getModelRenderTransferNodeAspectRatioOptions,
  isModelRenderTransferParameterlessModel,
  normalizeModelRenderTransferNodeConfig,
  normalizeModelRenderTransferNodeModel,
  MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
  MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
} from './constants';
import type { AIModelRenderTransferDropSide } from './drop-config';
import {
  getAIModelRenderTransferResultHandle,
  getAIModelRenderTransferStyleReferenceHandle,
  getAIModelRenderTransferWhiteModelHandle,
} from './groups';
import { buildAIModelRenderTransferInputLayoutVersion } from './layout';

interface AIModelRenderTransferNodeProps extends NodeProps<AINodeData> {}

const MIN_WIDTH = MODEL_RENDER_TRANSFER_DEFAULT_SIZE.width;
const MIN_HEIGHT = MODEL_RENDER_TRANSFER_DEFAULT_SIZE.height;
const GROUP_STACK_GAP = 10;
const DEFAULT_GROUP_HEIGHT = 152;

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function getGroupStatusLabel(status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped' | null | undefined): string | null {
  return getExecutionStatusLabel(status ?? null);
}

function getEdgeConnectionType(edge: ReactFlowEdge): 'file-reference' | 'output-link' {
  const connectionType = (edge.data as { connectionType?: 'file-reference' | 'output-link' } | undefined)?.connectionType;
  return connectionType ?? 'file-reference';
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
    const nextNodes = getNodes().map((node) => {
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

const AIModelRenderTransferNodeInner: React.FC<AIModelRenderTransferNodeProps> = ({ data, selected }) => {
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
  const [isResizing, setIsResizing] = useState(false);
  const { inputRegionProps, getPanelTargetProps, getSlotTargetProps } =
    useGroupedDropInteraction<AIModelRenderTransferDropSide>();

  const nodeInfo = NODE_TYPE_INFO[data.type];
  const nodeColor = nodeInfo?.color || '#f59e0b';
  const nodeIcon = nodeInfo?.icon || 'WMR';
  const executionState = nodeExecutionRuntime?.executionState ?? null;
  const isProcessing = nodeExecutionRuntime?.isProcessing ?? false;
  const groupExecutionStateMap = useMemo(
    () => new Map(groupExecutionStates.map((groupState) => [groupState.groupId, groupState] as const)),
    [groupExecutionStates],
  );
  const canRun = selectors.canRunNode(data.id.value);
  const groups = useMemo(() => ensureAIImageInputGroups(data.config), [data.config]);
  const normalizedImageConfig = useMemo(() => normalizeModelRenderTransferNodeConfig({
    model: data.config.model,
    imageSize: data.config.imageSize,
    aspectRatio: data.config.aspectRatio,
  }), [data.config.aspectRatio, data.config.imageSize, data.config.model]);
  const aspectRatioOptions = useMemo(
    () => getModelRenderTransferNodeAspectRatioOptions(normalizedImageConfig.model),
    [normalizedImageConfig.model],
  );
  const usesParameterControls = !isModelRenderTransferParameterlessModel(normalizedImageConfig.model);
  const resolvedGroupStates = useMemo(
    () => selectors.getResolvedNodeInputGroups(data.id.value),
    [data.id.value, selectors]
  );
  const groupsWithExecution = useMemo(() => resolvedGroupStates.map((groupState) => ({
    ...groupState,
    execution: groupExecutionStateMap.get(groupState.group.id) ?? null,
  })), [groupExecutionStateMap, resolvedGroupStates]);
  const inputLayoutVersion = useMemo(
    () => buildAIModelRenderTransferInputLayoutVersion(resolvedGroupStates),
    [resolvedGroupStates]
  );

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      updateNodeInternals(data.id.value);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [data.dimensions.height, data.dimensions.width, data.id.value, inputLayoutVersion, updateNodeInternals]);

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

  const handleRun = useCallback(() => {
    void actions.runAINode(data.id.value);
  }, [actions, data.id.value]);

  const handleCancel = useCallback(() => {
    void actions.cancelAINodeRun(data.id.value);
  }, [actions, data.id.value]);

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

    if (!modelChanged && !imageSizeChanged && !aspectRatioChanged) {
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
    });
  }, [
    data.config.aspectRatio,
    data.config.imageSize,
    data.config.model,
    normalizedImageConfig.aspectRatio,
    normalizedImageConfig.imageSize,
    normalizedImageConfig.model,
    usesParameterControls,
    updateImageConfig,
  ]);

  const handleModelChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextModel = normalizeModelRenderTransferNodeModel(event.target.value);
    const nextConfig = normalizeModelRenderTransferNodeConfig({
      model: nextModel,
      imageSize: normalizedImageConfig.imageSize,
      aspectRatio: normalizedImageConfig.aspectRatio,
    });

    updateImageConfig({
      model: nextConfig.model,
      ...(!isModelRenderTransferParameterlessModel(nextConfig.model)
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

  const handleAddGroup = useCallback(() => {
    if (groups.length >= MODEL_RENDER_TRANSFER_MAX_GROUPS) {
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

    if (groups.length <= MODEL_RENDER_TRANSFER_MIN_GROUPS) {
      return;
    }

    const stackOffset = getGroupStackOffset(event.currentTarget.closest('.ai-image-gen-node__group'));
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const nextInputGroups = removeInputGroupAndReorder(groups, groupId);

    const nextEdges = currentEdges.filter((edge) => !(
      (edge.target === data.id.value && (
        edge.targetHandle === getAIModelRenderTransferWhiteModelHandle(groupId) ||
        edge.targetHandle === getAIModelRenderTransferStyleReferenceHandle(groupId)
      )) ||
      (edge.source === data.id.value && edge.sourceHandle === getAIModelRenderTransferResultHandle(groupId))
    ));

    const remainingOutputFileIds = new Set(
      nextEdges
        .filter((edge) =>
          edge.source === data.id.value &&
          getEdgeConnectionType(edge) === 'output-link'
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

  const handleRemoveGroupInput = useCallback((
    groupId: string,
    inputHandle: string,
    sourceId: string,
    event: React.MouseEvent<HTMLButtonElement>
  ): void => {
    stopPointerEvent(event);

    const { nextNodes, nextEdges } = removeGroupedPortInput(getNodes(), getEdges(), {
      nodeId: data.id.value,
      inputHandle,
      outputHandle: getAIModelRenderTransferResultHandle(groupId),
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
  const nodeDetailLines = executionState ? getExecutionDetailLines(executionState) : [];
  const nodeErrorMessage = executionState ? getExecutionErrorMessage(executionState) : null;

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
        <GroupedDualInputPanel
          nodeId={data.id.value}
          className="ai-model-render-transfer-node__input-region grouped-drop-input-region"
          regionProps={inputRegionProps}
          panelLayerClassName="ai-model-render-transfer-node__panel-layer"
          groupsWrapperClassName="ai-image-gen-node__groups"
          groupLayerRef={groupLayerRef}
          panelTargetClassName="ai-model-render-transfer-node__panel-target"
          slotGridClassName="ai-image-gen-node__group-dropzone ai-image-gen-node__group-dropzone--filled"
          slotContainerClassName="ai-model-render-transfer-node__input-side"
          slotTargetClassName="ai-model-render-transfer-node__slot-target ai-model-render-transfer-node__slot-surface"
          filledSlotClassName="ai-image-gen-node__group-input"
          emptySlotClassName="ai-image-gen-node__group-placeholder"
          sides={[
            {
              side: MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
              panelLabel: '白模图批量区',
              slotLabel: '白模图',
              panelClassName: 'ai-model-render-transfer-node__panel-target--left',
              emptyAriaLabel: '白模图输入区',
            },
            {
              side: MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
              panelLabel: '风格参考图批量区',
              slotLabel: '风格参考图',
              panelClassName: 'ai-model-render-transfer-node__panel-target--right',
              emptyAriaLabel: '风格参考图输入区',
            },
          ]}
          groups={groupsWithExecution.map(({ group, ports, execution }) => {
            const whiteModelNode = ports
              .find((port) => port.portId === MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID)
              ?.inputs[0]?.sourceNode;
            const styleReferenceNode = ports
              .find((port) => port.portId === MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID)
              ?.inputs[0]?.sourceNode;
            const hasInputs = Boolean(whiteModelNode || styleReferenceNode);
            const canRemoveGroup = groups.length > MODEL_RENDER_TRANSFER_MIN_GROUPS;
            const isInputInteractionDisabled = isGroupedInputInteractionDisabled({
              locked: data.locked,
              status: executionState?.status ?? null,
            });
            const groupDetailLines = execution ? getExecutionDetailLines(execution) : [];
            const groupErrorMessage = execution ? getExecutionErrorMessage(execution) : null;
            const missingInputMessage = getMissingInputMessage(Boolean(whiteModelNode), Boolean(styleReferenceNode));
            const groupClasses = [
              'ai-image-gen-node__group',
              hasInputs ? 'ai-image-gen-node__group--filled' : 'ai-image-gen-node__group--empty',
              execution?.status === 'processing' ? 'ai-image-gen-node__group--processing' : '',
            ].filter(Boolean).join(' ');

            return {
              key: group.id,
              slots: {
                [MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID]: {
                  groupId: group.id,
                  portId: MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
                  content: whiteModelNode ? (
                    <GroupedInputItemChrome
                      className="ai-image-gen-node__group-input"
                      actions={(
                        <GroupedInputActionButton
                          aria-label={`移除 ${whiteModelNode.fileName}`}
                          title="移除输入"
                          disabled={isInputInteractionDisabled}
                          onMouseDown={stopPointerEvent}
                          onClick={(event) => handleRemoveGroupInput(
                            group.id,
                            getAIModelRenderTransferWhiteModelHandle(group.id),
                            whiteModelNode.id.value,
                            event
                          )}
                        />
                      )}
                      disabled={isInputInteractionDisabled}
                      title={`${whiteModelNode.fileName} | ${whiteModelNode.id.display}`}
                    >
                      <NodeInputImagePreview
                        sourceNode={whiteModelNode}
                        alt={whiteModelNode.fileName}
                        draggable={false}
                        fallback={(
                          <div className="ai-image-gen-node__group-input-fallback">
                            {whiteModelNode.fileName.slice(0, 10)}
                          </div>
                        )}
                      />
                    </GroupedInputItemChrome>
                  ) : null,
                },
                [MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID]: {
                  groupId: group.id,
                  portId: MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
                  content: styleReferenceNode ? (
                    <GroupedInputItemChrome
                      className="ai-image-gen-node__group-input"
                      actions={(
                        <GroupedInputActionButton
                          aria-label={`移除 ${styleReferenceNode.fileName}`}
                          title="移除输入"
                          disabled={isInputInteractionDisabled}
                          onMouseDown={stopPointerEvent}
                          onClick={(event) => handleRemoveGroupInput(
                            group.id,
                            getAIModelRenderTransferStyleReferenceHandle(group.id),
                            styleReferenceNode.id.value,
                            event
                          )}
                        />
                      )}
                      disabled={isInputInteractionDisabled}
                      title={`${styleReferenceNode.fileName} | ${styleReferenceNode.id.display}`}
                    >
                      <NodeInputImagePreview
                        sourceNode={styleReferenceNode}
                        alt={styleReferenceNode.fileName}
                        draggable={false}
                        fallback={(
                          <div className="ai-image-gen-node__group-input-fallback">
                            {styleReferenceNode.fileName.slice(0, 10)}
                          </div>
                        )}
                      />
                    </GroupedInputItemChrome>
                  ) : null,
                },
              },
              render: (slotGrid: React.ReactNode) => (
                <div
                  className={groupClasses}
                  data-group-state={hasInputs ? 'filled' : 'empty'}
                >
                  <Handle
                    id={getAIModelRenderTransferWhiteModelHandle(group.id)}
                    type="target"
                    position={Position.Left}
                    className="react-flow__handle ai-image-gen-node__group-handle nodrag nopan"
                    style={{
                      background: nodeColor,
                      top: '35%',
                      left: -7,
                      transform: 'translateY(-50%)',
                    }}
                  />

                  <Handle
                    id={getAIModelRenderTransferStyleReferenceHandle(group.id)}
                    type="target"
                    position={Position.Left}
                    className="react-flow__handle ai-image-gen-node__group-handle nodrag nopan"
                    style={{
                      background: nodeColor,
                      top: '72%',
                      left: -7,
                      transform: 'translateY(-50%)',
                    }}
                  />

                  <Handle
                    id={getAIModelRenderTransferResultHandle(group.id)}
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
                      <span className="ai-image-gen-node__group-meta">
                        {(whiteModelNode ? 1 : 0) + (styleReferenceNode ? 1 : 0)} / 2
                      </span>
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

                  {slotGrid}

                  {(execution?.status === 'processing' || execution?.status === 'queued') && (
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

                  {!execution && missingInputMessage && (
                    <div className="ai-image-gen-node__group-message">
                      {missingInputMessage}
                    </div>
                  )}

                  {groupDetailLines.length > 0 && (
                    <div className="ai-image-gen-node__group-message">
                      {groupDetailLines.join(' · ')}
                    </div>
                  )}

                  {groupErrorMessage && (
                    <div className="ai-image-gen-node__group-error">
                      {groupErrorMessage}
                    </div>
                  )}
                </div>
              ),
            };
          })}
          getPanelTargetProps={getPanelTargetProps}
          getSlotTargetProps={getSlotTargetProps}
        />

        <div className="ai-image-gen-node__group-toolbar">
          <button
            className="ai-image-gen-node__add-group nodrag nopan"
            type="button"
            onMouseDown={stopPointerEvent}
            onClick={handleAddGroup}
            disabled={groups.length >= MODEL_RENDER_TRANSFER_MAX_GROUPS}
            title={groups.length >= MODEL_RENDER_TRANSFER_MAX_GROUPS ? '最多 10 个输入组' : '新增输入组'}
          >
            + 添加输入组
          </button>

          <div className="ai-image-gen-node__footer-meta">
            <span className="ai-image-gen-node__footer-count">{groups.length} 组</span>
          </div>
        </div>
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
            {nodeDetailLines.length > 0 && (
              <div className="ai-node__processing-text">
                {nodeDetailLines.join(' · ')}
              </div>
            )}
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
              {'脳'}
            </button>

            <button
              className="node-control-btn node-control-btn--rotate nodrag nopan"
              title={isProcessing ? '取消运行' : canRun ? '运行节点' : '当前节点缺少输入'}
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
              title="缩放"
            />
          </>
        )}

        <div className="node-header ai-image-gen-node__titlebar" style={{ backgroundColor: `${nodeColor}1f` }}>
          <span className="node-type-icon">{nodeIcon}</span>
          <span className="node-type-name">{nodeInfo?.displayName || '白模图迁移渲染'}</span>
          <span className="ai-image-gen-node__title-id">{data.id.display}</span>
        </div>

        <div
          className="node-content ai-image-gen-node__content nodrag nopan"
          data-node-dropzone="body"
          data-node-id={data.id.value}
        >
          <div className="ai-image-gen-node__parameter-panel ai-model-render-transfer-node__parameter-panel">
            <div className="ai-image-gen-node__parameter-grid">
              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">
                  模型
                </span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={normalizedImageConfig.model}
                  onChange={handleModelChange}
                >
                  {MODEL_RENDER_TRANSFER_NODE_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {usesParameterControls && (
                <>
              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">
                  画面比例
                </span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={
                    typeof normalizedImageConfig.aspectRatio === 'string'
                      ? normalizedImageConfig.aspectRatio
                      : MODEL_RENDER_TRANSFER_DEFAULT_ASPECT_RATIO
                  }
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
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">
                  分辨率
                </span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={
                    typeof normalizedImageConfig.imageSize === 'string'
                      ? normalizedImageConfig.imageSize
                      : MODEL_RENDER_TRANSFER_DEFAULT_IMAGE_SIZE
                  }
                  onChange={handleImageSizeChange}
                >
                  {MODEL_RENDER_TRANSFER_NODE_IMAGE_SIZE_OPTIONS.map((option) => (
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
          {(nodeDetailLines.length > 0 || nodeErrorMessage) && (
            <div className="ai-image-gen-node__footer-meta">
              {nodeDetailLines.length > 0 && (
                <span className="ai-image-gen-node__footer-count">{nodeDetailLines.join(' · ')}</span>
              )}
              {nodeErrorMessage && (
                <span className="ai-image-gen-node__footer-count" style={{ color: '#dc2626' }}>
                  {nodeErrorMessage}
                </span>
              )}
            </div>
          )}
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
                title={isProcessing ? '停止等待' : canRun ? '运行节点' : '当前节点缺少输入'}
                onMouseDown={stopPointerEvent}
                onClick={isProcessing ? handleCancel : handleRun}
                disabled={!isProcessing && !canRun}
              >
                {isProcessing ? '停止等待' : '运行'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

AIModelRenderTransferNodeInner.displayName = 'AIModelRenderTransferNodeInner';

export const AIModelRenderTransferNode = memo((props: AIModelRenderTransferNodeProps) => (
  <NodeErrorBoundary nodeId={props.data.id.value} nodeType={props.data.type}>
    <AIModelRenderTransferNodeInner {...props} />
  </NodeErrorBoundary>
));

AIModelRenderTransferNode.displayName = 'AIModelRenderTransferNode';

