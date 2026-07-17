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
  AI_IMAGE_TO_PLY_INPUT_PORT_ID,
  getAIImageToPlyGroupOutputHandle,
  resolveAIImageToPlyInputGroups,
} from './groups';

function isImageFileNode(node: AnyNodeData): node is FileNodeData {
  return isFileNodeData(node) && node.type === 'image';
}

function canRunAIImageToPly(
  node: AINodeData,
  inputs: WorkflowConnectionInput[],
): NodeValidationResult {
  const groupDefinitions = resolveAIImageToPlyInputGroups(node);
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
    return Boolean(connectedPorts?.has(AI_IMAGE_TO_PLY_INPUT_PORT_ID));
  });

  return {
    valid: hasCompleteGroup,
    reason: '图片转模型节点至少需要一组有效图片输入。',
  };
}

function buildAIImageToPlyGroupPlan(
  node: AINodeData,
  groupId: string,
  sourceNode: FileNodeData,
): NodeExecutionPlan {
  return {
    files: [sourceNode.fileId],
    references: [sourceNode.fileId],
    config: {
      ...node.config,
      inputGroups: (Array.isArray(node.config.inputGroups) ? node.config.inputGroups : []).filter((group) => group.id === groupId),
    },
  };
}

export function buildAIImageToPlyGroupPlans(
  context: GroupedExecutionContext,
): NodeExecutionGroupPlan[] {
  const groupDefinitions = resolveAIImageToPlyInputGroups(context.node);
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
      AI_IMAGE_TO_PLY_INPUT_PORT_ID,
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
      outputHandle: getAIImageToPlyGroupOutputHandle(groupState.group.id),
      plan: buildAIImageToPlyGroupPlan(context.node, groupState.group.id, sourceNode),
    });
  });

  return plans;
}

export const aiImageToPlyExecution: NodeDefinition['execution'] = {
  mode: 'legacy-grouped-task',
  taskType: 'image-to-ply',
  provider: 'meshy',
  canRun: canRunAIImageToPly,
  buildGroupPlans: buildAIImageToPlyGroupPlans,
};
