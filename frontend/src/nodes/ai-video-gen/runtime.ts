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
  AI_VIDEO_GEN_INPUT_PORT_ID,
  AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP,
  getAIVideoGenGroupOutputHandle,
  resolveAIVideoGenInputGroups,
} from './groups';
export {
  AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO,
  AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
  AI_VIDEO_GEN_DEFAULT_MODEL,
  AI_VIDEO_GEN_DEFAULT_RESOLUTION,
  AI_VIDEO_GEN_DURATION_OPTIONS,
  AI_VIDEO_GEN_PROVIDER,
  AI_VIDEO_GEN_SUPPORTED_ASPECT_RATIOS,
  AI_VIDEO_GEN_SUPPORTED_DURATIONS_SECONDS,
  AI_VIDEO_GEN_SUPPORTED_MODELS,
  AI_VIDEO_GEN_SUPPORTED_RESOLUTIONS,
  isAIVideoGenSupportedModel,
  normalizeAIVideoGenAspectRatio,
  normalizeAIVideoGenDuration,
  normalizeAIVideoGenModel,
  normalizeAIVideoGenParameters,
  normalizeAIVideoGenResolution,
  resolveAIVideoGenSize,
  type AIVideoGenSupportedAspectRatio,
  type AIVideoGenSupportedDurationSeconds,
  type AIVideoGenSupportedModel,
  type AIVideoGenSupportedResolution,
} from './constants';
import {
  AI_VIDEO_GEN_DEFAULT_MODEL,
  AI_VIDEO_GEN_PROVIDER,
  normalizeAIVideoGenDuration,
  normalizeAIVideoGenModel,
  normalizeAIVideoGenParameters,
} from './constants';

export interface AIVideoGenValidationGroupState {
  groupId: string;
  groupLabel: string;
  inputCount: number;
}

export interface AIVideoGenExecutableGroupState {
  groupId: string;
  groupLabel: string;
  order: number;
  imageInputs: FileNodeData[];
}

function isImageFileNode(node: AnyNodeData): node is FileNodeData {
  return isFileNodeData(node) && node.type === 'image';
}

export function normalizeAIVideoGenPrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateAIVideoGenExecutionInput(input: {
  prompt: unknown;
  model: unknown;
  duration: unknown;
  groups: readonly AIVideoGenValidationGroupState[];
}): NodeValidationResult {
  const prompt = normalizeAIVideoGenPrompt(input.prompt);
  if (prompt.length === 0) {
    return {
      valid: false,
      reason: 'AI 视频生成节点的 Prompt 不能为空。',
    };
  }

  if (!normalizeAIVideoGenModel(input.model)) {
    return {
      valid: false,
      reason: 'AI 视频生成节点的模型不在支持范围内。',
    };
  }

  if (!normalizeAIVideoGenDuration(input.duration)) {
    return {
      valid: false,
      reason: 'AI 视频生成节点的时长不在支持范围内。',
    };
  }

  if (input.groups.length === 0) {
    return {
      valid: false,
      reason: 'AI 视频生成节点至少需要一组参考图。',
    };
  }

  const emptyGroup = input.groups.find((group) => group.inputCount === 0);
  if (emptyGroup) {
    return {
      valid: false,
      reason: `组 ${emptyGroup.groupLabel} 还没有接入参考图。`,
    };
  }

  const overflowGroup = input.groups.find((group) => (
    group.inputCount < 1 || group.inputCount > AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP
  ));
  if (overflowGroup) {
    return {
      valid: false,
      reason: `组 ${overflowGroup.groupLabel} 的参考图数量必须在 1 到 ${AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP} 张之间。`,
    };
  }

  return { valid: true };
}

export function getAIVideoGenExecutableGroups(
  context: GroupedExecutionContext,
): AIVideoGenExecutableGroupState[] {
  const groupDefinitions = resolveAIVideoGenInputGroups(context.node);
  const nodeMap = new Map(Object.values(context.workflow.nodes).map((node) => [node.id.value, node]));
  const groupStates = getNodeInputGroupsFromConnections(
    context.node,
    groupDefinitions,
    context.workflow.connections.filter((connection) => connection.targetId === context.node.id.value),
    nodeMap,
  );

  return groupStates
    .map((groupState) => ({
      groupId: groupState.group.id,
      groupLabel: groupState.group.label,
      order: groupState.group.order,
      imageInputs: getPortInputsFromGroups(
        [groupState],
        groupState.group.id,
        AI_VIDEO_GEN_INPUT_PORT_ID,
      )
        .map((inputGroup) => inputGroup.sourceNode)
        .filter(isImageFileNode),
    }))
    .sort((left, right) => left.order - right.order);
}

export function canRunAIVideoGen(
  node: AINodeData,
  inputs: WorkflowConnectionInput[],
): NodeValidationResult {
  const countsByGroupId = new Map<string, { groupLabel: string; inputCount: number }>();
  const configuredGroups = Array.isArray(node.config.inputGroups) ? node.config.inputGroups : [];

  configuredGroups.forEach((group) => {
    countsByGroupId.set(group.id, {
      groupLabel: group.label,
      inputCount: 0,
    });
  });

  inputs.forEach((input) => {
    const targetHandle = input.connection.targetHandle;
    if (!targetHandle) {
      return;
    }

    const separatorIndex = targetHandle.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex >= targetHandle.length - 1) {
      return;
    }

    const groupId = targetHandle.slice(0, separatorIndex);
    const portId = targetHandle.slice(separatorIndex + 1);
    if (portId !== AI_VIDEO_GEN_INPUT_PORT_ID || !isImageFileNode(input.sourceNode)) {
      return;
    }

    const existing = countsByGroupId.get(groupId);
    if (!existing) {
      return;
    }

    existing.inputCount += 1;
  });

  return validateAIVideoGenExecutionInput({
    prompt: node.config.prompt,
    model: node.config.model,
    duration: node.config.duration,
    groups: Array.from(countsByGroupId.entries()).map(([groupId, group]) => ({
      groupId,
      groupLabel: group.groupLabel,
      inputCount: group.inputCount,
    })),
  });
}

function buildAIVideoGenGroupPlan(
  node: AINodeData,
  groupId: string,
  imageInputs: FileNodeData[],
): NodeExecutionPlan {
  const model = normalizeAIVideoGenModel(node.config.model) ?? AI_VIDEO_GEN_DEFAULT_MODEL;
  const videoParameters = normalizeAIVideoGenParameters({
    aspectRatio: node.config.aspectRatio,
    resolution: node.config.resolutionPreset ?? node.config.resolution,
  });

  return {
    files: imageInputs.map((sourceNode) => sourceNode.fileId),
    references: imageInputs.map((sourceNode) => sourceNode.fileId),
    config: {
      ...node.config,
      model,
      duration: videoParameters.duration,
      inputGroups: (Array.isArray(node.config.inputGroups) ? node.config.inputGroups : []).filter(
        (group) => group.id === groupId,
      ),
      aspectRatio: videoParameters.aspectRatio,
      imageSize: undefined,
      resolutionPreset: videoParameters.resolution,
      resolution: videoParameters.resolution,
      size: videoParameters.size,
      fps: undefined,
      camera: undefined,
      lighting: undefined,
    },
    prompt: normalizeAIVideoGenPrompt(node.config.prompt) || undefined,
  };
}

export function buildAIVideoGenGroupPlans(
  context: GroupedExecutionContext,
): NodeExecutionGroupPlan[] {
  return getAIVideoGenExecutableGroups(context)
    .filter((group) => (
      group.imageInputs.length >= 1
      && group.imageInputs.length <= AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP
    ))
    .map((group) => ({
      groupId: group.groupId,
      groupLabel: group.groupLabel,
      order: group.order,
      outputHandle: getAIVideoGenGroupOutputHandle(group.groupId),
      plan: buildAIVideoGenGroupPlan(context.node, group.groupId, group.imageInputs),
    }));
}

export const aiVideoGenExecution: NodeDefinition['execution'] = {
  mode: 'legacy-grouped-task',
  taskType: 'video-gen',
  provider: AI_VIDEO_GEN_PROVIDER,
  canRun: canRunAIVideoGen,
  buildGroupPlans: buildAIVideoGenGroupPlans,
};
