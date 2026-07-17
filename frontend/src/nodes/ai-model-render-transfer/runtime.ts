import type { WorkflowConnectionInput } from '@/contracts/workflow';
import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import { isFileNodeData } from '@/utils/node';
import { getNodeInputGroupsFromConnections, getPortInputsFromGroups } from '../shared/group-query';
import type {
  GroupedExecutionContext,
  NodeExecutionAdapter,
  NodeExecutionGroupPlan,
  NodeExecutionPlan,
  NodeValidationResult,
} from '../types';
import {
  getAIModelRenderTransferResultHandle,
  resolveAIModelRenderTransferInputGroups,
} from './groups';
import {
  MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
  MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
  isModelRenderTransferParameterlessModel,
  normalizeModelRenderTransferNodeConfig,
} from './constants';

function isImageFileNode(node: AnyNodeData): node is FileNodeData {
  return isFileNodeData(node) && node.type === 'image';
}

function buildAIModelRenderTransferGroupPlan(
  node: AINodeData,
  groupId: string,
  whiteModelNode: FileNodeData,
  styleReferenceNode: FileNodeData
): NodeExecutionPlan {
  const normalizedImageConfig = normalizeModelRenderTransferNodeConfig({
    model: node.config.model,
    imageSize: node.config.imageSize,
    aspectRatio: node.config.aspectRatio,
  });
  const usesParameters = !isModelRenderTransferParameterlessModel(normalizedImageConfig.model);
  const {
    imageSize: _imageSize,
    aspectRatio: _aspectRatio,
    ...baseConfig
  } = node.config;

  return {
    files: [whiteModelNode.fileId],
    references: [styleReferenceNode.fileId],
    config: {
      ...baseConfig,
      model: normalizedImageConfig.model,
      ...(usesParameters
        ? {
            imageSize: normalizedImageConfig.imageSize,
            aspectRatio: normalizedImageConfig.aspectRatio,
          }
        : {}),
      inputGroups: (Array.isArray(node.config.inputGroups) ? node.config.inputGroups : []).filter((group) => group.id === groupId),
    },
  };
}

export function buildAIModelRenderTransferGroupPlans(
  context: GroupedExecutionContext
): NodeExecutionGroupPlan[] {
  const groupDefinitions = resolveAIModelRenderTransferInputGroups(context.node);
  const nodeMap = new Map(Object.values(context.workflow.nodes).map((node) => [node.id.value, node]));
  const groupStates = getNodeInputGroupsFromConnections(
    context.node,
    groupDefinitions,
    context.workflow.connections.filter((connection) => connection.targetId === context.node.id.value),
    nodeMap
  );

  const plans: NodeExecutionGroupPlan[] = [];

  groupStates.forEach((groupState) => {
    const whiteModelInput = getPortInputsFromGroups(
      [groupState],
      groupState.group.id,
      MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID
    )
      .map((input) => input.sourceNode)
      .filter(isImageFileNode)[0];

    const styleReferenceInput = getPortInputsFromGroups(
      [groupState],
      groupState.group.id,
      MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID
    )
      .map((input) => input.sourceNode)
      .filter(isImageFileNode)[0];

    if (!whiteModelInput || !styleReferenceInput) {
      return;
    }

    plans.push({
      groupId: groupState.group.id,
      groupLabel: groupState.group.label,
      order: groupState.group.order,
      outputHandle: getAIModelRenderTransferResultHandle(groupState.group.id),
      plan: buildAIModelRenderTransferGroupPlan(
        context.node,
        groupState.group.id,
        whiteModelInput,
        styleReferenceInput
      ),
    });
  });

  return plans;
}

export function canRunAIModelRenderTransfer(
  node: AINodeData,
  inputs: WorkflowConnectionInput[]
): NodeValidationResult {
  if (inputs.length < 2) {
    return {
      valid: false,
      reason: '白模图迁移渲染至少需要一组完整输入。',
    };
  }

  const groupDefinitions = resolveAIModelRenderTransferInputGroups(node);
  const connectedPortsByGroup = new Map<string, Set<string>>();

  inputs.forEach((input) => {
    const targetHandle = input.connection.targetHandle;
    if (!targetHandle) {
      return;
    }

    const [groupId, portId] = targetHandle.split(':');
    if (!groupId || !portId) {
      return;
    }

    const currentPorts = connectedPortsByGroup.get(groupId) ?? new Set<string>();
    currentPorts.add(portId);
    connectedPortsByGroup.set(groupId, currentPorts);
  });

  const hasCompleteGroup = groupDefinitions.some((group) => {
    const connectedPorts = connectedPortsByGroup.get(group.id);
    if (!connectedPorts) {
      return false;
    }

    return connectedPorts.has(MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID)
      && connectedPorts.has(MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID);
  });

  if (!hasCompleteGroup) {
    return {
      valid: false,
      reason: '白模图迁移渲染至少需要一组完整输入。',
    };
  }

  return {
    valid: true,
  };
}

export const aiModelRenderTransferExecution: NodeExecutionAdapter = {
  mode: 'legacy-grouped-task',
  taskType: 'model-render-transfer',
  provider: 'stability',
  canRun: canRunAIModelRenderTransfer,
  buildGroupPlans: buildAIModelRenderTransferGroupPlans,
};
