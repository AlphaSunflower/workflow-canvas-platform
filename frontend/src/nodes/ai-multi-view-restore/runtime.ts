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
  getAIMultiViewRestoreResultHandle,
  resolveAIMultiViewRestoreInputGroups,
} from './groups';
import {
  MULTI_VIEW_RESTORE_REFERENCE_PORT_ID,
  MULTI_VIEW_RESTORE_RENDER_PORT_ID,
} from './constants';

function isImageFileNode(node: AnyNodeData): node is FileNodeData {
  return isFileNodeData(node) && node.type === 'image';
}

function buildAIMultiViewRestoreGroupPlan(
  node: AINodeData,
  groupId: string,
  renderNode: FileNodeData,
  referenceNode: FileNodeData
): NodeExecutionPlan {
  return {
    files: [renderNode.fileId],
    references: [referenceNode.fileId],
    config: {
      ...node.config,
      inputGroups: (Array.isArray(node.config.inputGroups) ? node.config.inputGroups : []).filter((group) => group.id === groupId),
    },
  };
}

export function buildAIMultiViewRestoreGroupPlans(
  context: GroupedExecutionContext
): NodeExecutionGroupPlan[] {
  const groupDefinitions = resolveAIMultiViewRestoreInputGroups(context.node);
  const nodeMap = new Map(Object.values(context.workflow.nodes).map((node) => [node.id.value, node]));
  const groupStates = getNodeInputGroupsFromConnections(
    context.node,
    groupDefinitions,
    context.workflow.connections.filter((connection) => connection.targetId === context.node.id.value),
    nodeMap
  );

  const plans: NodeExecutionGroupPlan[] = [];

  groupStates.forEach((groupState) => {
    const renderInput = getPortInputsFromGroups(
      [groupState],
      groupState.group.id,
      MULTI_VIEW_RESTORE_RENDER_PORT_ID
    )
      .map((input) => input.sourceNode)
      .filter(isImageFileNode)[0];

    const referenceInput = getPortInputsFromGroups(
      [groupState],
      groupState.group.id,
      MULTI_VIEW_RESTORE_REFERENCE_PORT_ID
    )
      .map((input) => input.sourceNode)
      .filter(isImageFileNode)[0];

    if (!renderInput || !referenceInput) {
      return;
    }

    plans.push({
      groupId: groupState.group.id,
      groupLabel: groupState.group.label,
      order: groupState.group.order,
      outputHandle: getAIMultiViewRestoreResultHandle(groupState.group.id),
      plan: buildAIMultiViewRestoreGroupPlan(
        context.node,
        groupState.group.id,
        renderInput,
        referenceInput
      ),
    });
  });

  return plans;
}

export function canRunAIMultiViewRestore(
  node: AINodeData,
  inputs: WorkflowConnectionInput[]
): NodeValidationResult {
  if (inputs.length < 2) {
    return {
      valid: false,
      reason: '多视角修复至少需要一组完整输入。',
    };
  }

  const groupDefinitions = resolveAIMultiViewRestoreInputGroups(node);
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

    return connectedPorts.has(MULTI_VIEW_RESTORE_RENDER_PORT_ID)
      && connectedPorts.has(MULTI_VIEW_RESTORE_REFERENCE_PORT_ID);
  });

  if (!hasCompleteGroup) {
    return {
      valid: false,
      reason: '多视角修复至少需要一组完整输入。',
    };
  }

  return {
    valid: true,
  };
}

export const aiMultiViewRestoreExecution: NodeExecutionAdapter = {
  mode: 'legacy-grouped-task',
  taskType: 'multi-view-restore',
  provider: 'stability',
  canRun: canRunAIMultiViewRestore,
  buildGroupPlans: buildAIMultiViewRestoreGroupPlans,
};
