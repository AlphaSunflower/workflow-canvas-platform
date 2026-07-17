import type { WorkflowConnectionInput } from '@/contracts/workflow';
import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import { isFileNodeData } from '@/utils/node';
import { getNodeInputGroupsFromConnections, getPortInputsFromGroups } from '../shared/group-query';
import type {
  GroupedExecutionContext,
  NodeDefinition,
  NodeExecutionGroupPlan,
  NodeExecutionPlan,
  NodeValidationResult,
} from '../types';
import {
  AI_IMAGE_HD_INPUT_PORT_ID,
  getAIImageHdGroupOutputHandle,
  resolveAIImageHdInputGroups,
} from './groups';
import {
  isAIImageHdNodeParameterlessModel,
  normalizeAIImageHdNodeConfig,
} from './constants';

function isImageFileNode(node: AnyNodeData): node is FileNodeData {
  return isFileNodeData(node) && node.type === 'image';
}

function canRunAIImageHd(node: AINodeData, inputs: WorkflowConnectionInput[]): NodeValidationResult {
  const groupDefinitions = resolveAIImageHdInputGroups(node);
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
    return Boolean(connectedPorts?.has(AI_IMAGE_HD_INPUT_PORT_ID));
  });

  return {
    valid: hasCompleteGroup,
    reason: '图片高清化至少需要一组有效图片输入。',
  };
}

function buildAIImageHdGroupPlan(
  node: AINodeData,
  groupId: string,
  sourceNode: FileNodeData,
): NodeExecutionPlan {
  const normalizedImageConfig = normalizeAIImageHdNodeConfig({
    model: node.config.model,
    imageSize: node.config.imageSize,
    aspectRatio: node.config.aspectRatio,
  });
  const usesParameters = !isAIImageHdNodeParameterlessModel(normalizedImageConfig.model);
  const {
    imageSize: _imageSize,
    aspectRatio: _aspectRatio,
    ...baseConfig
  } = node.config;

  return {
    files: [sourceNode.fileId],
    references: [sourceNode.fileId],
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

export function buildAIImageHdGroupPlans(
  context: GroupedExecutionContext,
): NodeExecutionGroupPlan[] {
  const groupDefinitions = resolveAIImageHdInputGroups(context.node);
  const nodeMap = new Map(Object.values(context.workflow.nodes).map((node) => [node.id.value, node]));
  const groupStates = getNodeInputGroupsFromConnections(
    context.node,
    groupDefinitions,
    context.workflow.connections.filter((connection) => connection.targetId === context.node.id.value),
    nodeMap,
  );

  const plans: NodeExecutionGroupPlan[] = [];

  groupStates.forEach((groupState) => {
    const sourceNode = getPortInputsFromGroups(
      [groupState],
      groupState.group.id,
      AI_IMAGE_HD_INPUT_PORT_ID,
    )
      .map((input) => input.sourceNode)
      .filter(isImageFileNode)[0];

    if (!sourceNode) {
      return;
    }

    plans.push({
      groupId: groupState.group.id,
      groupLabel: groupState.group.label,
      order: groupState.group.order,
      outputHandle: getAIImageHdGroupOutputHandle(groupState.group.id),
      plan: buildAIImageHdGroupPlan(context.node, groupState.group.id, sourceNode),
    });
  });

  return plans;
}

export const aiImageHdExecution: NodeDefinition['execution'] = {
  mode: 'legacy-grouped-task',
  taskType: 'image-hd',
  provider: 'stability',
  canRun: canRunAIImageHd,
  buildGroupPlans: buildAIImageHdGroupPlans,
};
