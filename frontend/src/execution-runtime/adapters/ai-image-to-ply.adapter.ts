import type { FileNodeData } from '@/types';
import { createError } from '@/utils';
import { isFileNodeData } from '@/utils/common/guards';
import {
  AI_IMAGE_TO_PLY_INPUT_PORT_ID,
  getAIImageToPlyGroupOutputHandle,
} from '@/nodes/ai-image-to-ply/groups';
import { createGroupedExecutionOutputAdapter } from '../execution-output-commit.adapters';
import { buildExecutionRuntimePatchesFromSnapshot } from '../execution-polling.utils';
import type {
  ExecutionRuntimeGroupedNodeAdapter,
  ExecutionRuntimeNodeAdapterContext,
} from '../node-execution-adapter.types';
import type { ExecutionRuntimeGroupedNodeExecutionTarget } from '../node-execution.types';

interface AIImageToPlyExecutableGroup {
  groupId: string;
  groupLabel: string;
  groupOrder: number;
  outputHandle: string;
  sourceNode: FileNodeData;
}

const groupedOutputAdapter = createGroupedExecutionOutputAdapter();

function getGroupInputNode(
  groupState: ExecutionRuntimeNodeAdapterContext['resolvedInputGroups'][number],
): FileNodeData | null {
  const sourceNode = groupState.ports.find((port) => port.portId === AI_IMAGE_TO_PLY_INPUT_PORT_ID)?.inputs[0]?.sourceNode;
  if (!sourceNode || !isFileNodeData(sourceNode) || sourceNode.type !== 'image') {
    return null;
  }

  return sourceNode;
}

function getExecutableGroups(
  context: ExecutionRuntimeNodeAdapterContext,
): AIImageToPlyExecutableGroup[] {
  return context.resolvedInputGroups
    .map((groupState) => {
      const sourceNode = getGroupInputNode(groupState);
      if (!sourceNode) {
        return null;
      }

      return {
        groupId: groupState.group.id,
        groupLabel: groupState.group.label,
        groupOrder: groupState.group.order,
        outputHandle: getAIImageToPlyGroupOutputHandle(groupState.group.id),
        sourceNode,
      } satisfies AIImageToPlyExecutableGroup;
    })
    .filter((group): group is AIImageToPlyExecutableGroup => Boolean(group))
    .sort((left, right) => left.groupOrder - right.groupOrder);
}

function requireEnsureBackendFileId(
  context: ExecutionRuntimeNodeAdapterContext,
): (node: FileNodeData, options?: { signal?: AbortSignal; workflowId?: string | null }) => Promise<string> {
  const ensureBackendFileId = context.services?.ensureBackendFileId;
  if (!ensureBackendFileId) {
    throw new Error('Execution adapter is missing backend file registration service.');
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

  throw createError('FILE_REGISTER_FAILED', '未获取到有效的后端 sourceFileId。', {
    module: 'ai-image-to-ply.adapter',
    operation: 'createExecutionPayload',
    timestamp: Date.now(),
    context: {
      nodeId: sourceNode.id.value,
      localFileId: sourceNode.fileId,
      backendFileId,
    },
  });
}

export const aiImageToPlyExecutionRuntimeAdapter: ExecutionRuntimeGroupedNodeAdapter = {
  nodeType: 'aiImageToPly',
  executionKind: 'grouped',
  taskType: 'image-to-ply',
  outputCommitMode: groupedOutputAdapter.outputCommitMode,
  validateExecution: (context) => {
    const executableGroups = getExecutableGroups(context);
    if (executableGroups.length === 0) {
      return {
        valid: false,
        reason: 'Image to PLY node requires at least one valid input group.',
      };
    }

    return { valid: true };
  },
  createExecutionPayload: async (context) => {
    const executableGroups = getExecutableGroups(context);
    if (executableGroups.length === 0) {
      throw new Error('Image to PLY node requires at least one valid input group.');
    }

    const ensureBackendFileId = requireEnsureBackendFileId(context);
    const groups = await Promise.all(executableGroups.map(async (group) => {
      const backendFileId = await ensureBackendFileId(group.sourceNode, {
        signal: context.signal,
        workflowId: context.workflowId ?? context.workflow.id,
      });
      const sourceFileId = assertBackendFileId(backendFileId, group.sourceNode);

      return {
        groupId: group.groupId,
        sourceFileId,
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
      nodeType: 'aiImageToPly',
      taskType: 'image-to-ply',
      executionMode: 'legacy-grouped-task',
      nodeId: context.node.id.value,
      nodeTitle: context.nodeTitle,
      groups,
    };

    return {
      nodeId: context.node.id.value,
      nodeType: context.node.type,
      nodeTitle: context.nodeTitle,
      taskType: 'image-to-ply',
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
