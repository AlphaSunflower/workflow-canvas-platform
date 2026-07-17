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
  isAIFloorplanColorizeParameterlessModel,
  normalizeAIFloorplanColorizeConfig,
  normalizeAIFloorplanColorizeStylePreset,
} from './constants';
import {
  AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID,
  getAIFloorplanColorizeOutputHandle,
  resolveAIFloorplanColorizeInputGroups,
} from './groups';

export interface AIFloorplanColorizeBackendGroupPayloadInput {
  groupId: string;
  sourceFileId: string;
  config: Pick<AINodeData['config'], 'model' | 'stylePreset' | 'imageSize' | 'aspectRatio'>;
}

export interface AIFloorplanColorizeBackendGroupPayload {
  groupId: string;
  sourceFileId: string;
  model: string;
  stylePreset: string;
  imageSize?: string;
  aspectRatio?: string;
}

export function buildAIFloorplanColorizeBackendGroupPayload(
  input: AIFloorplanColorizeBackendGroupPayloadInput,
): AIFloorplanColorizeBackendGroupPayload {
  const sourceFileId = input.sourceFileId.trim();
  if (sourceFileId.length === 0) {
    throw new Error('Failed to resolve backend sourceFileId.');
  }

  const normalizedConfig = normalizeAIFloorplanColorizeConfig({
    model: input.config.model,
    imageSize: input.config.imageSize,
    aspectRatio: input.config.aspectRatio,
  });
  const usesParameters = !isAIFloorplanColorizeParameterlessModel(normalizedConfig.model);

  return {
    groupId: input.groupId,
    sourceFileId,
    model: normalizedConfig.model,
    stylePreset: normalizeAIFloorplanColorizeStylePreset(input.config.stylePreset),
    ...(usesParameters
      ? {
          imageSize: normalizedConfig.imageSize,
          aspectRatio: normalizedConfig.aspectRatio,
        }
      : {}),
  };
}

function isImageFileNode(node: AnyNodeData): node is FileNodeData {
  return isFileNodeData(node) && node.type === 'image';
}

function canRunAIFloorplanColorize(
  node: AINodeData,
  inputs: WorkflowConnectionInput[],
): NodeValidationResult {
  const groupDefinitions = resolveAIFloorplanColorizeInputGroups(node);
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
    return Boolean(connectedPorts?.has(AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID));
  });

  return {
    valid: hasCompleteGroup,
    reason: '平面图转彩平至少需要一组有效图片输入。',
  };
}

function buildAIFloorplanColorizeGroupPlan(
  node: AINodeData,
  groupId: string,
  sourceNode: FileNodeData,
): NodeExecutionPlan {
  const normalizedImageConfig = normalizeAIFloorplanColorizeConfig({
    model: node.config.model,
    imageSize: node.config.imageSize,
    aspectRatio: node.config.aspectRatio,
  });
  const usesParameters = !isAIFloorplanColorizeParameterlessModel(normalizedImageConfig.model);
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

export function buildAIFloorplanColorizeGroupPlans(
  context: GroupedExecutionContext,
): NodeExecutionGroupPlan[] {
  const groupDefinitions = resolveAIFloorplanColorizeInputGroups(context.node);
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
      AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID,
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
      outputHandle: getAIFloorplanColorizeOutputHandle(groupState.group.id),
      plan: buildAIFloorplanColorizeGroupPlan(context.node, groupState.group.id, sourceNode),
    });
  });

  return plans;
}

export const aiFloorplanColorizeExecution: NodeDefinition['execution'] = {
  mode: 'legacy-grouped-task',
  taskType: 'floorplan-colorize',
  provider: 'laozhang',
  canRun: canRunAIFloorplanColorize,
  buildGroupPlans: buildAIFloorplanColorizeGroupPlans,
};
