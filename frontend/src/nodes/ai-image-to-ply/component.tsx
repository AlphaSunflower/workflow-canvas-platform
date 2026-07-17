import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Handle,
  Position,
  type Edge as ReactFlowEdge,
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
import {
  createAppendedInputGroups,
  removeInputGroupAndReorder,
} from '../shared/groups';
import { NodeInputImagePreview } from '../shared/NodeInputImagePreview';
import {
  GroupedInputActionButton,
  GroupedInputItemChrome,
  GroupedInputPanel,
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
import type { AIImageToPlyDropSide } from './drop-config';
import {
  AI_IMAGE_TO_PLY_INPUT_PORT_ID,
  AI_IMAGE_TO_PLY_MAX_GROUPS,
  AI_IMAGE_TO_PLY_MIN_GROUPS,
  AI_IMAGE_TO_PLY_RESULT_PORT_ID,
} from './groups';
import { buildAIImageToPlyInputLayoutVersion } from './layout';

interface AIImageToPlyNodeProps extends NodeProps<AINodeData> {}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 296;
const GROUP_STACK_GAP = 10;
const DEFAULT_GROUP_HEIGHT = 118;

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function getReferenceTitle(node: FileNodeData): string {
  return `${node.fileName} | ${node.id.display}`;
}

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

function getEdgeConnectionType(edge: ReactFlowEdge): 'file-reference' | 'output-link' {
  const connectionType = (edge.data as { connectionType?: 'file-reference' | 'output-link' } | undefined)?.connectionType;
  return connectionType ?? 'file-reference';
}

function getGroupInputHandle(groupId: string): string {
  return `${groupId}:${AI_IMAGE_TO_PLY_INPUT_PORT_ID}`;
}

function getGroupOutputHandle(groupId: string): string {
  return `${groupId}:${AI_IMAGE_TO_PLY_RESULT_PORT_ID}`;
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

const AIImageToPlyNodeInner: React.FC<AIImageToPlyNodeProps> = ({ data, selected }) => {
  const {
    actions,
    selectors,
    nodeExecutionRuntime,
    groupExecutionStates,
  } = useNodeRuntimeBindings();
  const updateNodeStructure = useNodeStructuralEditor(data.id.value);
  const { getNodes, getEdges, getViewport, setNodes, setEdges } = useReactFlow<AnyNodeData>();
  const updateNodeInternals = useUpdateNodeInternals();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const groupLayerRef = useRef<HTMLDivElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const { inputRegionProps, getPanelTargetProps, getSlotTargetProps } =
    useGroupedDropInteraction<AIImageToPlyDropSide>();

  const nodeInfo = NODE_TYPE_INFO[data.type];
  const nodeColor = nodeInfo?.color || '#14b8a6';
  const nodeIcon = nodeInfo?.icon || '3D';
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
    inputs: groupState.ports
      .find((port) => port.portId === AI_IMAGE_TO_PLY_INPUT_PORT_ID)
      ?.inputs ?? [],
    execution: groupExecutionStateMap.get(groupState.group.id) ?? null,
  })), [groupExecutionStateMap, resolvedGroupStates]);
  const inputLayoutVersion = useMemo(
    () => buildAIImageToPlyInputLayoutVersion(resolvedGroupStates),
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

  const handleAddGroup = useCallback(() => {
    if (groups.length >= AI_IMAGE_TO_PLY_MAX_GROUPS) {
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

    if (groups.length <= AI_IMAGE_TO_PLY_MIN_GROUPS) {
      return;
    }

    const stackOffset = getGroupStackOffset(event.currentTarget.closest('.ai-image-gen-node__group'));
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const nextInputGroups = removeInputGroupAndReorder(groups, groupId);

    const nextEdges = currentEdges.filter((edge) => !(
      (edge.target === data.id.value && edge.targetHandle === getGroupInputHandle(groupId)) ||
      (edge.source === data.id.value && edge.sourceHandle === getGroupOutputHandle(groupId))
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
    sourceId: string,
    event: React.MouseEvent<HTMLButtonElement>
  ): void => {
    stopPointerEvent(event);

    const { nextNodes, nextEdges } = removeGroupedPortInput(getNodes(), getEdges(), {
      nodeId: data.id.value,
      inputHandle: getGroupInputHandle(groupId),
      outputHandle: getGroupOutputHandle(groupId),
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
                panelLabel: '批量扩组投放区',
              })}
            />
          )}
          groups={(
            <div ref={groupLayerRef} className="ai-image-gen-node__groups">
              {groupsWithExecution.map(({ group, inputs, execution }) => {
                const input = inputs[0];
                const sourceNode = input?.sourceNode;
                const hasInput = Boolean(sourceNode);
                const canRemoveGroup = groups.length > AI_IMAGE_TO_PLY_MIN_GROUPS;
                const isInputInteractionDisabled = isGroupedInputInteractionDisabled({
                  locked: data.locked,
                  status: executionState?.status ?? null,
                });
                const groupClasses = [
                  'ai-image-gen-node__group',
                  hasInput ? 'ai-image-gen-node__group--filled' : 'ai-image-gen-node__group--empty',
                  execution?.status === 'processing' ? 'ai-image-gen-node__group--processing' : '',
                ].filter(Boolean).join(' ');
                const dropzoneClasses = [
                  'ai-image-gen-node__group-dropzone',
                  'grouped-drop-slot-target',
                  'grouped-drop-slot-surface',
                  hasInput ? 'ai-image-gen-node__group-dropzone--filled' : 'ai-image-gen-node__group-dropzone--empty',
                ].join(' ');

                return (
                  <div
                    key={group.id}
                    className={groupClasses}
                    data-group-state={hasInput ? 'filled' : 'empty'}
                  >
                    <Handle
                      id={getGroupInputHandle(group.id)}
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
                      id={getGroupOutputHandle(group.id)}
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
                        <span className="ai-image-gen-node__group-meta">{hasInput ? '1 / 1' : '0 / 1'}</span>
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
                        portId: AI_IMAGE_TO_PLY_INPUT_PORT_ID,
                        side: 'input',
                      })}
                    >
                      {sourceNode ? (
                        <GroupedInputItemChrome
                          className="ai-image-gen-node__group-input"
                          actions={(
                            <GroupedInputActionButton
                              aria-label={`Remove ${sourceNode.fileName}`}
                              title="移除输入"
                              disabled={isInputInteractionDisabled}
                              onMouseDown={stopPointerEvent}
                              onClick={(event) => handleRemoveGroupInput(group.id, sourceNode.id.value, event)}
                            />
                          )}
                          disabled={isInputInteractionDisabled}
                          title={getReferenceTitle(sourceNode)}
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
                      ) : (
                        <div className="ai-image-gen-node__group-placeholder">
                          拖入图片到该输入组
                        </div>
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
                disabled={groups.length >= AI_IMAGE_TO_PLY_MAX_GROUPS}
                title={groups.length >= AI_IMAGE_TO_PLY_MAX_GROUPS ? '最多 10 个输入组' : '新增输入组'}
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
          <span className="node-type-name">{nodeInfo?.displayName || '图转模型'}</span>
          <span className="ai-image-gen-node__title-id">{data.id.display}</span>
        </div>

        <div
          className="node-content ai-image-gen-node__content nodrag nopan"
          data-node-dropzone="body"
          data-node-id={data.id.value}
        >
          <div className="ai-image-gen-node__parameter-panel">
            <div className="ai-image-gen-node__parameter-grid">
              <div className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">输入规则</span>
                <div className="ai-image-gen-node__group-message">每组仅 1 张图片</div>
              </div>

              <div className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">输出规则</span>
                <div className="ai-image-gen-node__group-message">每组产出 1 个 PLY</div>
              </div>

              <div className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">组数范围</span>
                <div className="ai-image-gen-node__group-message">1 - 10 组</div>
              </div>
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

AIImageToPlyNodeInner.displayName = 'AIImageToPlyNodeInner';

export const AIImageToPlyNode = memo((props: AIImageToPlyNodeProps) => (
  <NodeErrorBoundary nodeId={props.data.id.value} nodeType={props.data.type}>
    <AIImageToPlyNodeInner {...props} />
  </NodeErrorBoundary>
));

AIImageToPlyNode.displayName = 'AIImageToPlyNode';
