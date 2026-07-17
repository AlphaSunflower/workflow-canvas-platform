import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import {
  AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP,
  AI_IMAGE_INPUT_PORT_ID,
  getAIImageGenGroupOutputHandle,
} from '@/nodes/ai-image-gen/groups';
import {
  AI_IMAGE_GEN_NODE_OFFICIAL_MODEL,
  isAIImageGenNodeParameterlessModel,
  normalizeAIImageGenNodeConfig,
  normalizeAIImageGenNodeModel,
  normalizeAIImageGenNodeOfficialQuality,
} from '@/nodes/ai-image-gen/constants';
import type { FileNodeData } from '@/types';
import { isFileNodeData } from '@/utils/common/guards';
import { createGroupedExecutionOutputAdapter } from '../execution-output-commit.adapters';
import { buildExecutionRuntimePatchesFromSnapshot } from '../execution-polling.utils';
import type {
  ExecutionRuntimeGroupedNodeAdapter,
  ExecutionRuntimeNodeAdapterContext,
} from '../node-execution-adapter.types';
import type { ExecutionRuntimeGroupedNodeExecutionTarget } from '../node-execution.types';
import { assertAdapterBackendFileId } from './backend-file-id';

interface AIImageGenExecutableGroup {
  groupId: string;
  groupLabel: string;
  groupOrder: number;
  outputHandle: string;
  inputNodes: FileNodeData[];
}

const groupedOutputAdapter = createGroupedExecutionOutputAdapter();
const OFFICIAL_TEXT_TO_IMAGE_GROUP_ID = 'group-1';
const OFFICIAL_TEXT_TO_IMAGE_GROUP_LABEL = 'Group 1';

function normalizePrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getImageInputNodes(groupState: WorkflowResolvedNodeGroupState): FileNodeData[] {
  const port = groupState.ports.find((item) => item.portId === AI_IMAGE_INPUT_PORT_ID);
  if (!port) {
    return [];
  }

  return port.inputs
    .map((input) => input.sourceNode)
    .filter((node): node is FileNodeData => isFileNodeData(node) && node.type === 'image');
}

function getExecutableGroups(
  context: ExecutionRuntimeNodeAdapterContext,
): AIImageGenExecutableGroup[] {
  const resolvedGroups = context.resolvedInputGroups
    .map((groupState) => {
      const inputNodes = getImageInputNodes(groupState);
      if (inputNodes.length === 0) {
        return null;
      }

      return {
        groupId: groupState.group.id,
        groupLabel: groupState.group.label,
        groupOrder: groupState.group.order,
        outputHandle: getAIImageGenGroupOutputHandle(groupState.group.id),
        inputNodes,
      } satisfies AIImageGenExecutableGroup;
    })
    .filter((group): group is AIImageGenExecutableGroup => Boolean(group))
    .sort((left, right) => left.groupOrder - right.groupOrder);

  if (resolvedGroups.length === 0) {
    const fallbackGroup = context.resolvedInputGroups[0]?.group;
    const groupId = fallbackGroup?.id ?? OFFICIAL_TEXT_TO_IMAGE_GROUP_ID;

    return [{
      groupId,
      groupLabel: fallbackGroup?.label ?? OFFICIAL_TEXT_TO_IMAGE_GROUP_LABEL,
      groupOrder: fallbackGroup?.order ?? 0,
      outputHandle: getAIImageGenGroupOutputHandle(groupId),
      inputNodes: [],
    }];
  }

  return resolvedGroups;
}

function requireEnsureBackendFileId(
  context: ExecutionRuntimeNodeAdapterContext,
): (node: FileNodeData, options?: { signal?: AbortSignal; workflowId?: string | null }) => Promise<string> {
  const ensureBackendFileId = context.services?.ensureBackendFileId;
  if (!ensureBackendFileId) {
    throw new Error('执行适配器缺少后端文件注册服务。');
  }

  return ensureBackendFileId;
}

export const aiImageGenExecutionRuntimeAdapter: ExecutionRuntimeGroupedNodeAdapter = {
  nodeType: 'aiImageGen',
  executionKind: 'grouped',
  taskType: 'image-gen',
  outputCommitMode: groupedOutputAdapter.outputCommitMode,
  validateExecution: (context) => {
    const prompt = normalizePrompt(context.node.config.prompt);
    const model = normalizeAIImageGenNodeModel(context.node.config.model);
    if (prompt.length === 0) {
      return {
        valid: false,
        reason: 'AI 生图节点的 Prompt 不能为空。',
    };
  }

    const executableGroups = getExecutableGroups(context);
    if (executableGroups.length === 0) {
      return {
        valid: false,
        reason: 'AI 生图节点缺少可执行分组。',
      };
    }

    if (model === AI_IMAGE_GEN_NODE_OFFICIAL_MODEL) {
      const groupWithReferences = executableGroups.find((group) => group.inputNodes.length > 0);
      if (groupWithReferences) {
        return {
          valid: false,
          reason: 'GPT Image 2 Official currently supports text-to-image only.',
        };
      }
    }

    const invalidGroup = executableGroups.find((group) => (
      group.inputNodes.length > AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP
    ));
    if (invalidGroup) {
      return {
        valid: false,
        reason: `组 ${invalidGroup.groupLabel} 的输入数量不能超过 ${AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP} 张。`,
      };
    }

    return { valid: true };
  },
  createExecutionPayload: async (context) => {
    const prompt = normalizePrompt(context.node.config.prompt);
    const normalizedImageConfig = normalizeAIImageGenNodeConfig({
      model: context.node.config.model,
      imageSize: context.node.config.imageSize,
      aspectRatio: context.node.config.aspectRatio,
      quality: context.node.config.quality,
    });
    const model = normalizedImageConfig.model;
    const usesParameters = !isAIImageGenNodeParameterlessModel(model);
    const quality = model === AI_IMAGE_GEN_NODE_OFFICIAL_MODEL
      ? normalizeAIImageGenNodeOfficialQuality(normalizedImageConfig.quality)
      : undefined;
    if (prompt.length === 0) {
      throw new Error('AI 生图节点的 Prompt 不能为空。');
    }

    const executableGroups = getExecutableGroups(context);
    if (executableGroups.length === 0) {
      throw new Error('AI 生图节点缺少可执行分组。');
    }

    if (model === AI_IMAGE_GEN_NODE_OFFICIAL_MODEL) {
      const groupWithReferences = executableGroups.find((group) => group.inputNodes.length > 0);
      if (groupWithReferences) {
        throw new Error('GPT Image 2 Official currently supports text-to-image only.');
      }
    }

    const invalidGroup = executableGroups.find((group) => (
      group.inputNodes.length > AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP
    ));
    if (invalidGroup) {
      throw new Error(`组 ${invalidGroup.groupLabel} 的输入数量不能超过 ${AI_IMAGE_GEN_MAX_INPUTS_PER_GROUP} 张。`);
    }

    const hasReferenceInputs = executableGroups.some((group) => group.inputNodes.length > 0);
    const ensureBackendFileId = hasReferenceInputs
      ? requireEnsureBackendFileId(context)
      : null;
    const groups = await Promise.all(executableGroups.map(async (group) => {
      const referenceFileIds = await Promise.all(
        group.inputNodes.map(async (node) => assertAdapterBackendFileId(
          await ensureBackendFileId!(node, {
            signal: context.signal,
            workflowId: context.workflowId ?? context.workflow.id,
          }),
          node,
          {
            module: 'ai-image-gen.adapter',
            fieldName: 'referenceFileId',
          },
        )),
      );

      return {
        groupId: group.groupId,
        referenceFileIds,
      };
    }));

    const targets = executableGroups.map((group) => ({
      kind: 'group',
      nodeId: context.node.id.value,
      nodeType: context.node.type,
      groupId: group.groupId,
      groupOrder: group.groupOrder,
      groupLabel: group.groupLabel,
      outputHandle: group.outputHandle,
    } satisfies ExecutionRuntimeGroupedNodeExecutionTarget));

    const request = {
      nodeType: 'aiImageGen',
      taskType: 'image-gen',
      executionMode: 'legacy-grouped-task',
      nodeId: context.node.id.value,
      nodeTitle: context.nodeTitle,
      prompt,
      model,
      ...(usesParameters
        ? {
            imageSize: normalizedImageConfig.imageSize,
            aspectRatio: normalizedImageConfig.aspectRatio,
          }
        : {}),
      ...(quality ? { quality } : {}),
      groups,
    };

    return {
      nodeId: context.node.id.value,
      nodeType: context.node.type,
      nodeTitle: context.nodeTitle,
      taskType: 'image-gen',
      executionKind: 'grouped',
      request,
      targets,
    };
  },
  mapSnapshotToRuntimePatch: (snapshot, context) => buildExecutionRuntimePatchesFromSnapshot(
    context.previousSnapshot,
    snapshot,
    {
      workflowId: context.workflowId ?? snapshot.workflowId ?? null,
      nodeId: context.nodeId,
    },
  ),
  extractExecutionOutputs: (snapshot, context) => groupedOutputAdapter.extractExecutionOutputs(snapshot, context),
};
