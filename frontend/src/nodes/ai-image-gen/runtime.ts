import type { WorkflowConnectionInput } from '@/contracts/workflow';
import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import { isFileNodeData } from '@/utils/node';
import {
  AI_IMAGE_GEN_NODE_OFFICIAL_MODEL,
  normalizeAIImageGenNodeConfig,
  normalizeAIImageGenNodeModel,
} from './constants';
import { getNodeInputGroupsFromConnections, getPortInputsFromGroups } from '../shared/group-query';
import type {
  GroupedExecutionContext,
  NodeExecutionAdapter,
  NodeExecutionGroupPlan,
  NodeExecutionPlan,
  NodeValidationResult,
} from '../types';
import {
  AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP,
  AI_IMAGE_INPUT_PORT_ID,
  getAIImageGenGroupOutputHandle,
  resolveAIImageGenInputGroups,
} from './groups';

function isImageFileNode(node: AnyNodeData): node is FileNodeData {
  return isFileNodeData(node) && node.type === 'image';
}

function getNormalizedPrompt(node: AINodeData): string {
  return typeof node.config.prompt === 'string' ? node.config.prompt.trim() : '';
}

function getImageInputGroups(
  context: GroupedExecutionContext,
): Array<{
  groupId: string;
  groupLabel: string;
  order: number;
  imageInputs: FileNodeData[];
}> {
  const groupDefinitions = resolveAIImageGenInputGroups(context.node);
  const nodeMap = new Map(Object.values(context.workflow.nodes).map((node) => [node.id.value, node]));
  const groupStates = getNodeInputGroupsFromConnections(
    context.node,
    groupDefinitions,
    context.workflow.connections.filter((connection) => connection.targetId === context.node.id.value),
    nodeMap,
  );

  return groupStates
    .map((groupState) => {
      const imageInputs = getPortInputsFromGroups(
        [groupState],
        groupState.group.id,
        AI_IMAGE_INPUT_PORT_ID,
      )
        .map((input) => input.sourceNode)
        .filter(isImageFileNode);

      return {
        groupId: groupState.group.id,
        groupLabel: groupState.group.label,
        order: groupState.group.order,
        imageInputs,
      };
    });
}

function getFirstConfiguredGroup(node: AINodeData): {
  id: string;
  label: string;
  order: number;
} {
  const configuredGroups = Array.isArray(node.config.inputGroups)
    ? node.config.inputGroups
    : [];

  return configuredGroups[0] ?? {
    id: 'group-1',
    label: 'Group 1',
    order: 0,
  };
}

export function canRunAIImageGen(
  node: AINodeData,
  inputs: WorkflowConnectionInput[],
): NodeValidationResult {
  const prompt = getNormalizedPrompt(node);
  const model = normalizeAIImageGenNodeModel(node.config.model);
  if (prompt.length === 0) {
    return {
      valid: false,
      reason: 'Prompt 不能为空。',
    };
  }

  if (model === AI_IMAGE_GEN_NODE_OFFICIAL_MODEL && inputs.length > 0) {
    return {
      valid: false,
      reason: 'GPT Image 2 Official currently supports text-to-image only.',
    };
  }

  return {
    valid: true,
  };
}

function buildAIImageGenGroupPlan(
  node: AINodeData,
  groupId: string,
  imageInputs: FileNodeData[],
): NodeExecutionPlan {
  const normalizedImageConfig = normalizeAIImageGenNodeConfig({
    model: node.config.model,
    imageSize: node.config.imageSize,
    aspectRatio: node.config.aspectRatio,
    quality: node.config.quality,
  });
  const usesParameters = normalizedImageConfig.model !== 'gpt-image-2';
  const {
    imageSize: _imageSize,
    aspectRatio: _aspectRatio,
    quality: _quality,
    ...baseConfig
  } = node.config;

  return {
    files: imageInputs.map((sourceNode) => sourceNode.fileId),
    references: imageInputs.map((sourceNode) => sourceNode.fileId),
  config: {
    ...baseConfig,
    model: normalizedImageConfig.model,
    ...(usesParameters
      ? {
          imageSize: normalizedImageConfig.imageSize,
          aspectRatio: normalizedImageConfig.aspectRatio,
        }
      : {}),
    ...(typeof normalizedImageConfig.quality === 'string' ? { quality: normalizedImageConfig.quality } : {}),
    inputGroups: (Array.isArray(node.config.inputGroups) ? node.config.inputGroups : []).filter(
      (group) => group.id === groupId,
    ),
    },
    prompt: getNormalizedPrompt(node) || undefined,
  };
}

export function buildAIImageGenGroupPlans(
  context: GroupedExecutionContext,
): NodeExecutionGroupPlan[] {
  const imageInputGroups = getImageInputGroups(context);
  const hasAnyImageInputs = imageInputGroups.some((group) => group.imageInputs.length > 0);
  const executableGroups = imageInputGroups.filter(
    (group) => group.imageInputs.length > 0 && group.imageInputs.length <= AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP,
  );

  if (executableGroups.length === 0) {
    if (hasAnyImageInputs) {
      return [];
    }

    const fallbackGroup = getFirstConfiguredGroup(context.node);

    return [{
      groupId: fallbackGroup.id,
      groupLabel: fallbackGroup.label,
      order: fallbackGroup.order,
      outputHandle: getAIImageGenGroupOutputHandle(fallbackGroup.id),
      plan: buildAIImageGenGroupPlan(context.node, fallbackGroup.id, []),
    }];
  }

  return executableGroups
    .map((group) => ({
      groupId: group.groupId,
      groupLabel: group.groupLabel,
      order: group.order,
      outputHandle: getAIImageGenGroupOutputHandle(group.groupId),
      plan: buildAIImageGenGroupPlan(context.node, group.groupId, group.imageInputs),
    }));
}

export const aiImageGenExecution: NodeExecutionAdapter = {
  mode: 'legacy-grouped-task',
  taskType: 'image-gen',
  provider: 'openai',
  canRun: canRunAIImageGen,
  buildGroupPlans: buildAIImageGenGroupPlans,
};
