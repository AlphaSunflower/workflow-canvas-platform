import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import {
  AI_VIDEO_GEN_INPUT_PORT_ID,
  AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP,
  getAIVideoGenGroupOutputHandle,
} from '@/nodes/ai-video-gen/groups';
import {
  AI_VIDEO_GEN_DEFAULT_MODEL,
  normalizeAIVideoGenParameters,
  normalizeAIVideoGenModel,
  normalizeAIVideoGenPrompt,
  validateAIVideoGenExecutionInput,
} from '@/nodes/ai-video-gen/runtime';
import type { FileNodeData } from '@/types';
import { createError } from '@/utils';
import { isFileNodeData } from '@/utils/common/guards';
import { createGroupedExecutionOutputAdapter } from '../execution-output-commit.adapters';
import { buildExecutionRuntimePatchesFromSnapshot } from '../execution-polling.utils';
import type {
  ExecutionRuntimeGroupedNodeAdapter,
  ExecutionRuntimeNodeAdapterContext,
} from '../node-execution-adapter.types';
import type { ExecutionRuntimeGroupedNodeExecutionTarget } from '../node-execution.types';

interface AIVideoGenExecutableGroup {
  groupId: string;
  groupLabel: string;
  groupOrder: number;
  outputHandle: string;
  inputNodes: FileNodeData[];
}

const groupedOutputAdapter = createGroupedExecutionOutputAdapter();

function getGroupInputNodes(groupState: WorkflowResolvedNodeGroupState): FileNodeData[] {
  const port = groupState.ports.find((item) => item.portId === AI_VIDEO_GEN_INPUT_PORT_ID);
  if (!port) {
    return [];
  }

  return port.inputs
    .map((input) => input.sourceNode)
    .filter((node): node is FileNodeData => isFileNodeData(node) && node.type === 'image');
}

function getExecutableGroups(
  context: ExecutionRuntimeNodeAdapterContext,
): AIVideoGenExecutableGroup[] {
  return context.resolvedInputGroups
    .map((groupState) => {
      const inputNodes = getGroupInputNodes(groupState);
      if (inputNodes.length === 0) {
        return null;
      }

      return {
        groupId: groupState.group.id,
        groupLabel: groupState.group.label,
        groupOrder: groupState.group.order,
        outputHandle: getAIVideoGenGroupOutputHandle(groupState.group.id),
        inputNodes,
      } satisfies AIVideoGenExecutableGroup;
    })
    .filter((group): group is AIVideoGenExecutableGroup => Boolean(group))
    .sort((left, right) => left.groupOrder - right.groupOrder);
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

function assertBackendFileId(
  backendFileId: string,
  sourceNode: FileNodeData,
): string {
  const trimmed = typeof backendFileId === 'string' ? backendFileId.trim() : '';
  if (trimmed.length > 0) {
    return trimmed;
  }

  throw createError('FILE_REGISTER_FAILED', '未获取到有效的后端 referenceFileId。', {
    module: 'ai-video-gen.adapter',
    operation: 'createExecutionPayload',
    timestamp: Date.now(),
    context: {
      nodeId: sourceNode.id.value,
      localFileId: sourceNode.fileId,
      backendFileId,
    },
  });
}

export const aiVideoGenExecutionRuntimeAdapter: ExecutionRuntimeGroupedNodeAdapter = {
  nodeType: 'aiVideoGen',
  executionKind: 'grouped',
  taskType: 'video-gen',
  outputCommitMode: groupedOutputAdapter.outputCommitMode,
  validateExecution: (context) => {
    const executableGroups = getExecutableGroups(context);
    const validation = validateAIVideoGenExecutionInput({
      prompt: context.node.config.prompt,
      model: context.node.config.model,
      duration: context.node.config.duration,
      groups: context.resolvedInputGroups.map((groupState) => ({
        groupId: groupState.group.id,
        groupLabel: groupState.group.label,
        inputCount: getGroupInputNodes(groupState).length,
      })),
    });

    if (!validation.valid) {
      return {
        valid: false,
        reason: validation.reason ?? 'AI 视频生成节点输入无效。',
      };
    }

    if (executableGroups.length === 0) {
      return {
        valid: false,
        reason: 'AI 视频生成节点至少需要一组有效参考图。',
      };
    }

    const invalidGroup = executableGroups.find((group) => (
      group.inputNodes.length < 1 || group.inputNodes.length > AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP
    ));
    if (invalidGroup) {
      return {
        valid: false,
        reason: `组 ${invalidGroup.groupLabel} 的参考图数量必须在 1 到 ${AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP} 张之间。`,
      };
    }

    return { valid: true };
  },
  createExecutionPayload: async (context) => {
    const prompt = normalizeAIVideoGenPrompt(context.node.config.prompt);
    const model = normalizeAIVideoGenModel(context.node.config.model) ?? AI_VIDEO_GEN_DEFAULT_MODEL;
    const videoParameters = normalizeAIVideoGenParameters({
      aspectRatio: context.node.config.aspectRatio,
      resolution: context.node.config.resolutionPreset ?? context.node.config.resolution,
      duration: context.node.config.duration,
    });
    const executableGroups = getExecutableGroups(context);
    const validation = validateAIVideoGenExecutionInput({
      prompt,
      model,
      duration: context.node.config.duration,
      groups: context.resolvedInputGroups.map((groupState) => ({
        groupId: groupState.group.id,
        groupLabel: groupState.group.label,
        inputCount: getGroupInputNodes(groupState).length,
      })),
    });

    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    if (executableGroups.length === 0) {
      throw new Error('AI 视频生成节点至少需要一组有效参考图。');
    }

    const invalidGroup = executableGroups.find((group) => (
      group.inputNodes.length < 1 || group.inputNodes.length > AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP
    ));
    if (invalidGroup) {
      throw new Error(`组 ${invalidGroup.groupLabel} 的参考图数量必须在 1 到 ${AI_VIDEO_GEN_MAX_INPUTS_PER_GROUP} 张之间。`);
    }

    const ensureBackendFileId = requireEnsureBackendFileId(context);
    const groups = await Promise.all(executableGroups.map(async (group) => {
      const referenceFileIds = await Promise.all(
        group.inputNodes.map(async (node) => (
          assertBackendFileId(
            await ensureBackendFileId(node, {
              signal: context.signal,
              workflowId: context.workflowId ?? context.workflow.id,
            }),
            node,
          )
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
      nodeType: 'aiVideoGen',
      taskType: 'video-gen',
      executionMode: 'legacy-grouped-task',
      nodeId: context.node.id.value,
      nodeTitle: context.nodeTitle,
      prompt,
      model,
      duration: videoParameters.duration,
      aspectRatio: videoParameters.aspectRatio,
      resolution: videoParameters.resolution,
      size: videoParameters.size,
      groups,
    };

    return {
      nodeId: context.node.id.value,
      nodeType: context.node.type,
      nodeTitle: context.nodeTitle,
      taskType: 'video-gen',
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
