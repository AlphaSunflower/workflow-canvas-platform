import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import {
  MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
  MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
  isModelRenderTransferParameterlessModel,
  normalizeModelRenderTransferNodeConfig,
} from '@/nodes/ai-model-render-transfer/constants';
import { getAIModelRenderTransferResultHandle } from '@/nodes/ai-model-render-transfer/groups';
import type { FileNodeData } from '@/types';
import { isFileNodeData } from '@/utils/common/guards';
import { createGroupedExecutionOutputAdapter } from '../execution-output-commit.adapters';
import { buildExecutionRuntimePatchesFromSnapshot } from '../execution-polling.utils';
import type { ExecutionRuntimeGroupedNodeAdapter, ExecutionRuntimeNodeAdapterContext } from '../node-execution-adapter.types';
import type { ExecutionRuntimeGroupedNodeExecutionTarget } from '../node-execution.types';
import { assertAdapterBackendFileId } from './backend-file-id';

interface WhiteModelRenderExecutableGroup {
  groupId: string;
  groupLabel: string;
  groupOrder: number;
  outputHandle: string;
  whiteModelNode: FileNodeData;
  styleReferenceNode: FileNodeData;
}

const groupedOutputAdapter = createGroupedExecutionOutputAdapter();

function getGroupPortSourceNode(
  groupState: WorkflowResolvedNodeGroupState,
  portId: string,
): FileNodeData | null {
  const sourceNode = groupState.ports.find((port) => port.portId === portId)?.inputs[0]?.sourceNode;
  return sourceNode && isFileNodeData(sourceNode) && sourceNode.type === 'image'
    ? sourceNode
    : null;
}

function getExecutableGroups(
  context: ExecutionRuntimeNodeAdapterContext,
): WhiteModelRenderExecutableGroup[] {
  return context.resolvedInputGroups
    .map((groupState) => {
      const whiteModelNode = getGroupPortSourceNode(groupState, MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID);
      const styleReferenceNode = getGroupPortSourceNode(groupState, MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID);
      if (!whiteModelNode || !styleReferenceNode) {
        return null;
      }

      return {
        groupId: groupState.group.id,
        groupLabel: groupState.group.label,
        groupOrder: groupState.group.order,
        outputHandle: getAIModelRenderTransferResultHandle(groupState.group.id),
        whiteModelNode,
        styleReferenceNode,
      } satisfies WhiteModelRenderExecutableGroup;
    })
    .filter((group): group is WhiteModelRenderExecutableGroup => Boolean(group))
    .sort((left, right) => left.groupOrder - right.groupOrder);
}

function requireEnsureBackendFileId(
  context: ExecutionRuntimeNodeAdapterContext,
): (node: FileNodeData, options?: { signal?: AbortSignal; workflowId?: string | null }) => Promise<string> {
  const ensureBackendFileId = context.services?.ensureBackendFileId;
  if (!ensureBackendFileId) {
    throw new Error('执行适配器缺少后端文件注册服务');
  }

  return ensureBackendFileId;
}

export const whiteModelRenderExecutionRuntimeAdapter: ExecutionRuntimeGroupedNodeAdapter = {
  nodeType: 'aiModelRenderTransfer',
  executionKind: 'grouped',
  taskType: 'model-render-transfer',
  outputCommitMode: groupedOutputAdapter.outputCommitMode,
  validateExecution: (context) => {
    const executableGroups = getExecutableGroups(context);
    if (executableGroups.length === 0) {
      return {
        valid: false,
        reason: '白模渲染至少需要一组完整输入',
      };
    }

    return { valid: true };
  },
  createExecutionPayload: async (context) => {
    const executableGroups = getExecutableGroups(context);
    const normalizedImageConfig = normalizeModelRenderTransferNodeConfig({
      model: context.node.config.model,
      imageSize: context.node.config.imageSize,
      aspectRatio: context.node.config.aspectRatio,
    });
    const usesParameters = !isModelRenderTransferParameterlessModel(normalizedImageConfig.model);
    if (executableGroups.length === 0) {
      throw new Error('白模渲染至少需要一组完整输入');
    }

    const ensureBackendFileId = requireEnsureBackendFileId(context);
    const groups = await Promise.all(executableGroups.map(async (group) => {
      const [rawWhiteModelFileId, rawStyleReferenceFileId] = await Promise.all([
        ensureBackendFileId(group.whiteModelNode, {
          signal: context.signal,
          workflowId: context.workflowId ?? context.workflow.id,
        }),
        ensureBackendFileId(group.styleReferenceNode, {
          signal: context.signal,
          workflowId: context.workflowId ?? context.workflow.id,
        }),
      ]);
      const whiteModelFileId = assertAdapterBackendFileId(rawWhiteModelFileId, group.whiteModelNode, {
        module: 'white-model-render.adapter',
        fieldName: 'whiteModelFileId',
      });
      const styleReferenceFileId = assertAdapterBackendFileId(rawStyleReferenceFileId, group.styleReferenceNode, {
        module: 'white-model-render.adapter',
        fieldName: 'styleReferenceFileId',
      });

      return {
        groupId: group.groupId,
        whiteModelFileId,
        styleReferenceFileId,
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
      nodeType: 'aiModelRenderTransfer',
      taskType: 'model-render-transfer',
      executionMode: 'legacy-grouped-task',
      nodeId: context.node.id.value,
      nodeTitle: context.nodeTitle,
      model: normalizedImageConfig.model,
      ...(usesParameters
        ? {
            imageSize: normalizedImageConfig.imageSize,
            aspectRatio: normalizedImageConfig.aspectRatio,
          }
        : {}),
      groups,
    };

    return {
      nodeId: context.node.id.value,
      nodeType: context.node.type,
      nodeTitle: context.nodeTitle,
      taskType: 'model-render-transfer',
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
