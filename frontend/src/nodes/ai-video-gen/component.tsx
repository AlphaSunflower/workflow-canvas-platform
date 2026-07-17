import React, { memo, useCallback, useEffect, useMemo } from 'react';
import { Handle, Position, type NodeProps, useReactFlow, useUpdateNodeInternals } from 'reactflow';

import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import { NodeErrorBoundary } from '@/components/ui/ErrorBoundary';
import { NODE_TYPE_INFO } from '@/constants';
import {
  useNodeRuntimeBindings,
} from '@/nodes/runtime-bindings';
import {
  createWorkflowRuntimeSnapshot,
  ensureAIImageInputGroups,
} from '@/utils';
import { patchNodeConfigInGraph } from '../shared/node-config-updater';
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
import { getReactFlowEdgeConnectionType } from '../shared/connection';
import type { AIVideoGenDropSide } from './drop-config';
import {
  AI_VIDEO_GEN_INPUT_PORT_ID,
  AI_VIDEO_GEN_MAX_GROUPS,
  AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP,
  getAIVideoGenGroupInputHandle,
  getAIVideoGenGroupOutputHandle,
} from './groups';
import {
  AI_VIDEO_GEN_ASPECT_RATIO_OPTIONS,
  AI_VIDEO_GEN_MODEL_OPTIONS,
  AI_VIDEO_GEN_RESOLUTION_OPTIONS,
  normalizeAIVideoGenAspectRatio,
  normalizeAIVideoGenModel,
  normalizeAIVideoGenParameters,
  normalizeAIVideoGenResolution,
} from './constants';

interface AIVideoGenNodeProps extends NodeProps<AINodeData> {}

const VIDEO_DURATION_OPTIONS = [
  { value: 8, label: '8s' },
] as const;

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function getReferenceTitle(node: FileNodeData): string {
  return `${node.fileName} | ${node.id.display}`;
}

function getGroupStatusLabel(
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped' | null | undefined,
): string | null {
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

const AIVideoGenNodeInner: React.FC<AIVideoGenNodeProps> = ({ data, selected }) => {
  const {
    actions,
    selectors,
    nodeExecutionRuntime,
    groupExecutionStates,
  } = useNodeRuntimeBindings();
  const { getNodes, getEdges, getViewport, setNodes, setEdges } = useReactFlow<AnyNodeData>();
  const updateNodeInternals = useUpdateNodeInternals();
  const updateNodeConfig = useNodeConfigEditor(data.id.value, data.type);
  const updateNodeStructure = useNodeStructuralEditor(data.id.value);
  const { inputRegionProps, getPanelTargetProps, getSlotTargetProps } =
    useGroupedDropInteraction<AIVideoGenDropSide>();

  const nodeInfo = NODE_TYPE_INFO[data.type];
  const nodeColor = nodeInfo?.color || '#06b6d4';
  const nodeIcon = nodeInfo?.icon || 'VID';
  const canRun = selectors.canRunNode(data.id.value);
  const executionState = nodeExecutionRuntime?.executionState ?? null;
  const isProcessing = nodeExecutionRuntime?.isProcessing ?? false;
  const groupExecutionStateMap = useMemo(
    () => new Map(groupExecutionStates.map((groupState) => [groupState.groupId, groupState] as const)),
    [groupExecutionStates],
  );
  const groups = useMemo(() => ensureAIImageInputGroups(data.config), [data.config]);
  const normalizedVideoParameters = useMemo(() => normalizeAIVideoGenParameters({
    aspectRatio: data.config.aspectRatio,
    resolution: data.config.resolutionPreset ?? data.config.resolution,
  }), [data.config.aspectRatio, data.config.resolution, data.config.resolutionPreset]);
  const resolvedGroupStates = useMemo(
    () => selectors.getResolvedNodeInputGroups(data.id.value),
    [data.id.value, selectors],
  );
  const groupsWithExecution = useMemo(() => resolvedGroupStates.map((groupState) => ({
    group: groupState.group,
    inputs: groupState.ports.find((port) => port.portId === AI_VIDEO_GEN_INPUT_PORT_ID)?.inputs ?? [],
    execution: groupExecutionStateMap.get(groupState.group.id) ?? null,
  })), [groupExecutionStateMap, resolvedGroupStates]);
  const groupLayoutVersion = useMemo(
    () => resolvedGroupStates
      .map((groupState) => {
        const inputCount = groupState.ports
          .find((port) => port.portId === AI_VIDEO_GEN_INPUT_PORT_ID)
          ?.inputs.length ?? 0;
        return `${groupState.group.id}:${inputCount}`;
      })
      .join('|'),
    [resolvedGroupStates],
  );

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      updateNodeInternals(data.id.value);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [data.id.value, groupLayoutVersion, updateNodeInternals]);

  const updateVideoConfig = useCallback((patch: Partial<AINodeData['config']>) => {
    updateNodeConfig(() => patch);
  }, [updateNodeConfig]);

  const handlePromptChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateVideoConfig({ prompt: event.target.value });
  }, [updateVideoConfig]);

  const handleModelChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateVideoConfig({ model: event.target.value });
  }, [updateVideoConfig]);

  const handleDurationChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateVideoConfig({ duration: Number(event.target.value) });
  }, [updateVideoConfig]);

  const handleAspectRatioChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextParameters = normalizeAIVideoGenParameters({
      aspectRatio: event.target.value,
      resolution: data.config.resolutionPreset ?? data.config.resolution,
    });

    updateVideoConfig({
      aspectRatio: nextParameters.aspectRatio,
      resolutionPreset: nextParameters.resolution,
      resolution: nextParameters.resolution,
      size: nextParameters.size,
    });
  }, [data.config.resolution, data.config.resolutionPreset, updateVideoConfig]);

  const handleResolutionChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextParameters = normalizeAIVideoGenParameters({
      aspectRatio: data.config.aspectRatio,
      resolution: event.target.value,
    });

    updateVideoConfig({
      aspectRatio: nextParameters.aspectRatio,
      resolutionPreset: nextParameters.resolution,
      resolution: nextParameters.resolution,
      size: nextParameters.size,
    });
  }, [data.config.aspectRatio, updateVideoConfig]);

  const handleAddGroup = useCallback(() => {
    if (groups.length >= AI_VIDEO_GEN_MAX_GROUPS) {
      return;
    }

    updateNodeStructure((currentNode) => ({
      ...currentNode,
      config: {
        ...currentNode.config,
        inputGroups: createAppendedInputGroups(currentNode.config, 1),
      },
      timestamp: {
        ...currentNode.timestamp,
        updated: Date.now(),
      },
    }));
  }, [groups.length, updateNodeStructure]);

  const handleRemoveGroup = useCallback((groupId: string, event: React.MouseEvent<HTMLButtonElement>): void => {
    stopPointerEvent(event);

    if (groups.length <= 1) {
      return;
    }

    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const nextInputGroups = removeInputGroupAndReorder(groups, groupId);

    const nextEdges = currentEdges.filter((edge) => !(
      (edge.target === data.id.value && edge.targetHandle === getAIVideoGenGroupInputHandle(groupId)) ||
      (edge.source === data.id.value && edge.sourceHandle === getAIVideoGenGroupOutputHandle(groupId))
    ));

    const remainingOutputFileIds = new Set(
      nextEdges
        .filter((edge) => edge.source === data.id.value && getReactFlowEdgeConnectionType(edge) === 'output-link')
        .flatMap((edge) => {
          const targetNode = currentNodes.find((node) => node.id === edge.target);
          const targetData = targetNode?.data;
          if (!targetData || targetData.type !== 'video') {
            return [];
          }

          return [targetData.fileId];
        }),
    );

    const nextNodes = currentNodes.map((node) => {
      if (node.id !== data.id.value) {
        return node;
      }

      const currentData = node.data as AINodeData;
      const nextData: AINodeData = {
        ...currentData,
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
        position: nextData.position,
      };
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, data.id.value, getEdges, getNodes, getViewport, groups, setEdges, setNodes]);

  const handleRemoveGroupInput = useCallback((
    groupId: string,
    sourceId: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    stopPointerEvent(event);

    const { nextNodes, nextEdges } = removeGroupedPortInput(getNodes(), getEdges(), {
      nodeId: data.id.value,
      inputHandle: getAIVideoGenGroupInputHandle(groupId),
      outputHandle: getAIVideoGenGroupOutputHandle(groupId),
      sourceId,
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
    actions.syncRuntimeSnapshot(createWorkflowRuntimeSnapshot(nextNodes, nextEdges, getViewport()));
  }, [actions, data.id.value, getEdges, getNodes, getViewport, setEdges, setNodes]);

  const handleRun = useCallback(() => {
    void actions.runAINode(data.id.value);
  }, [actions, data.id.value]);

  const handleCancel = useCallback(() => {
    void actions.cancelAINodeRun(data.id.value);
  }, [actions, data.id.value]);

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
  ].filter(Boolean).join(' ');

  return (
    <div
      className={shellClasses}
      style={{
        width: data.dimensions.width,
        minWidth: data.dimensions.width,
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
                panelLabel: '视频参考图投放区',
              })}
            />
          )}
          groups={(
            <div className="ai-image-gen-node__groups">
              {groupsWithExecution.map(({ group, inputs, execution }) => {
                const hasInputs = inputs.length > 0;
                const canRemoveGroup = groups.length > 1;
                const isInputInteractionDisabled = isGroupedInputInteractionDisabled({
                  locked: data.locked,
                  status: executionState?.status ?? null,
                });
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
                const statusLabel = getGroupStatusLabel(execution?.status);

                return (
                  <div
                    key={group.id}
                    className={groupClasses}
                    data-group-state={hasInputs ? 'filled' : 'empty'}
                  >
                    <Handle
                      id={getAIVideoGenGroupInputHandle(group.id)}
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
                      id={getAIVideoGenGroupOutputHandle(group.id)}
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
                        {statusLabel ? (
                          <span className={`ai-image-gen-node__group-status ai-image-gen-node__group-status--${execution?.status}`}>
                            {statusLabel}
                          </span>
                        ) : null}
                      </div>
                      <div className="ai-image-gen-node__group-header-actions">
                        <span className="ai-image-gen-node__group-meta">{inputs.length} / {AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP}</span>
                        <button
                          type="button"
                          className="ai-image-gen-node__group-delete-button nodrag nopan"
                          onMouseDown={stopPointerEvent}
                          onClick={(event) => handleRemoveGroup(group.id, event)}
                          disabled={!canRemoveGroup}
                          title={canRemoveGroup ? '删除该组' : '至少保留一组'}
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
                        portId: AI_VIDEO_GEN_INPUT_PORT_ID,
                        side: 'input',
                      })}
                    >
                      {inputs.length > 0 ? (
                        <div className="ai-image-gen-node__group-inputs">
                          {inputs.map(({ sourceNode }, index) => (
                            <GroupedInputItemChrome
                              key={sourceNode.id.value}
                              className="ai-image-gen-node__group-input"
                              title={getReferenceTitle(sourceNode)}
                              badge={<span className="ai-image-gen-node__group-input-order">{index + 1}</span>}
                              actions={(
                                <GroupedInputActionButton
                                  aria-label={`移除 ${sourceNode.fileName}`}
                                  title="移除参考图"
                                  disabled={isInputInteractionDisabled}
                                  onMouseDown={stopPointerEvent}
                                  onClick={(event) => handleRemoveGroupInput(group.id, sourceNode.id.value, event)}
                                />
                              )}
                              disabled={isInputInteractionDisabled}
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
                          ))}
                        </div>
                      ) : (
                        <div className="ai-image-gen-node__group-placeholder">
                          拖入 1-2 张图片作为本组参考图
                        </div>
                      )}
                    </div>

                    {execution?.message && execution.status !== 'skipped' ? (
                      <div className="ai-image-gen-node__group-message">
                        {execution.message}
                      </div>
                    ) : (
                      <div className="ai-image-gen-node__group-message">
                        同组最多 2 张参考图，按顺序发送给后端生成视频。
                      </div>
                    )}

                    {execution?.error ? (
                      <div className="ai-image-gen-node__group-error">
                        {execution.error}
                      </div>
                    ) : null}
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
                disabled={groups.length >= AI_VIDEO_GEN_MAX_GROUPS}
                title={groups.length >= AI_VIDEO_GEN_MAX_GROUPS ? '最多 10 组' : '新增参考图分组'}
              >
                + 添加分组
              </button>

              <div className="ai-image-gen-node__footer-meta">
                <span className="ai-image-gen-node__footer-count">{groups.length} 组</span>
              </div>
            </>
          )}
        />
      </div>

      <div
        className={wrapperClasses}
        style={{
          borderColor: nodeColor,
          width: '100%',
          height: data.dimensions.height,
        }}
      >
        <div className="node-header ai-image-gen-node__titlebar" style={{ backgroundColor: `${nodeColor}1f` }}>
          <span className="node-type-icon">{nodeIcon}</span>
          <span className="node-type-name">{nodeInfo?.displayName || 'AI 生成视频'}</span>
          <span className="ai-image-gen-node__title-id">{data.id.display}</span>
        </div>

        <div className="node-content ai-image-gen-node__content nodrag nopan" data-node-dropzone="body" data-node-id={data.id.value}>
          <label className="ai-image-gen-node__field ai-image-gen-node__prompt-field">
            <span className="ai-image-gen-node__label">Prompt</span>
            <textarea
              className="ai-image-gen-node__textarea nodrag nopan"
              value={typeof data.config.prompt === 'string' ? data.config.prompt : ''}
              onChange={handlePromptChange}
              placeholder="描述视频中的主体、动作、镜头和期望氛围"
              rows={4}
            />
          </label>

          <div className="ai-image-gen-node__parameter-panel">
            <div className="ai-image-gen-node__parameter-grid">
              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">模型</span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={normalizeAIVideoGenModel(data.config.model) ?? AI_VIDEO_GEN_MODEL_OPTIONS[0].value}
                  onChange={handleModelChange}
                >
                  {AI_VIDEO_GEN_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">时长</span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={typeof data.config.duration === 'number' ? String(data.config.duration) : String(VIDEO_DURATION_OPTIONS[0].value)}
                  onChange={handleDurationChange}
                >
                  {VIDEO_DURATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">Aspect</span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={normalizeAIVideoGenAspectRatio(normalizedVideoParameters.aspectRatio) ?? AI_VIDEO_GEN_ASPECT_RATIO_OPTIONS[0].value}
                  onChange={handleAspectRatioChange}
                >
                  {AI_VIDEO_GEN_ASPECT_RATIO_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} disabled={normalizedVideoParameters.resolution === '4k' && option.value !== '16:9'}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ai-image-gen-node__field ai-image-gen-node__field--compact">
                <span className="ai-image-gen-node__label ai-image-gen-node__label--compact">Resolution</span>
                <select
                  className="select ai-image-gen-node__select nodrag nopan"
                  value={normalizeAIVideoGenResolution(normalizedVideoParameters.resolution) ?? AI_VIDEO_GEN_RESOLUTION_OPTIONS[0].value}
                  onChange={handleResolutionChange}
                >
                  {AI_VIDEO_GEN_RESOLUTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} disabled={normalizedVideoParameters.aspectRatio === '9:16' && option.value === '4k'}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
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
                title={isProcessing ? '取消运行' : canRun ? '运行节点' : '当前节点缺少输入'}
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

AIVideoGenNodeInner.displayName = 'AIVideoGenNodeInner';

export const AIVideoGenNode = memo((props: AIVideoGenNodeProps) => (
  <NodeErrorBoundary nodeId={props.data.id.value} nodeType={props.data.type}>
    <AIVideoGenNodeInner {...props} />
  </NodeErrorBoundary>
));

AIVideoGenNode.displayName = 'AIVideoGenNode';
