import type { FileNodeData } from '@/types';
import { isFileNodeData } from '@/utils/common/guards';
import {
  MULTI_VIEW_RESTORE_REFERENCE_PORT_ID,
  MULTI_VIEW_RESTORE_RENDER_PORT_ID,
} from '@/nodes/ai-multi-view-restore/constants';
import {
  getAIMultiViewRestoreResultHandle,
} from '@/nodes/ai-multi-view-restore/groups';
import { createGroupedExecutionOutputAdapter } from '../execution-output-commit.adapters';
import { buildExecutionRuntimePatchesFromSnapshot } from '../execution-polling.utils';
import type {
  ExecutionRuntimeGroupedNodeAdapter,
  ExecutionRuntimeNodeAdapterContext,
} from '../node-execution-adapter.types';
import type { ExecutionRuntimeGroupedNodeExecutionTarget } from '../node-execution.types';
import { assertAdapterBackendFileId } from './backend-file-id';

interface AIMultiViewRestoreExecutableGroup {
  groupId: string;
  groupLabel: string;
  groupOrder: number;
  outputHandle: string;
  renderNode: FileNodeData;
  referenceNode: FileNodeData;
}

const groupedOutputAdapter = createGroupedExecutionOutputAdapter();

function getGroupInputNode(
  groupState: ExecutionRuntimeNodeAdapterContext['resolvedInputGroups'][number],
  portId: string,
): FileNodeData | null {
  const sourceNode = groupState.ports.find((port) => port.portId === portId)?.inputs[0]?.sourceNode;
  if (!sourceNode || !isFileNodeData(sourceNode) || sourceNode.type !== 'image') {
    return null;
  }

  return sourceNode;
}

function getExecutableGroups(
  context: ExecutionRuntimeNodeAdapterContext,
): AIMultiViewRestoreExecutableGroup[] {
  return context.resolvedInputGroups
    .map((groupState) => {
      const renderNode = getGroupInputNode(groupState, MULTI_VIEW_RESTORE_RENDER_PORT_ID);
      const referenceNode = getGroupInputNode(groupState, MULTI_VIEW_RESTORE_REFERENCE_PORT_ID);
      if (!renderNode || !referenceNode) {
        return null;
      }

      return {
        groupId: groupState.group.id,
        groupLabel: groupState.group.label,
        groupOrder: groupState.group.order,
        outputHandle: getAIMultiViewRestoreResultHandle(groupState.group.id),
        renderNode,
        referenceNode,
      } satisfies AIMultiViewRestoreExecutableGroup;
    })
    .filter((group): group is AIMultiViewRestoreExecutableGroup => Boolean(group))
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
  fieldName: 'renderFileId' | 'referenceFileId',
): string {
  const trimmed = typeof backendFileId === 'string' ? backendFileId.trim() : '';
  if (trimmed.length > 0) {
    return trimmed;
  }

  throw new Error(`Failed to resolve backend ${fieldName} for node ${sourceNode.id.value}.`);
}

export const aiMultiViewRestoreExecutionRuntimeAdapter: ExecutionRuntimeGroupedNodeAdapter = {
  nodeType: 'aiMultiViewRestore',
  executionKind: 'grouped',
  taskType: 'multi-view-restore',
  outputCommitMode: groupedOutputAdapter.outputCommitMode,
  validateExecution: (context) => {
    const executableGroups = getExecutableGroups(context);
    if (executableGroups.length === 0) {
      return {
        valid: false,
        reason: '多视角修复节点至少需要一组完整的渲染图和原视角参考图输入。',
      };
    }

    return { valid: true };
  },
  createExecutionPayload: async (context) => {
    const executableGroups = getExecutableGroups(context);
    if (executableGroups.length === 0) {
      throw new Error('多视角修复节点至少需要一组完整的渲染图和原视角参考图输入。');
    }

    const ensureBackendFileId = requireEnsureBackendFileId(context);
    const groups = await Promise.all(executableGroups.map(async (group) => {
      const renderFileId = assertBackendFileId(
        assertAdapterBackendFileId(
          await ensureBackendFileId(group.renderNode, {
            signal: context.signal,
            workflowId: context.workflowId ?? context.workflow.id,
          }),
          group.renderNode,
          {
            module: 'ai-multi-view-restore.adapter',
            fieldName: 'renderFileId',
          },
        ),
        group.renderNode,
        'renderFileId',
      );
      const referenceFileId = assertBackendFileId(
        assertAdapterBackendFileId(
          await ensureBackendFileId(group.referenceNode, {
            signal: context.signal,
            workflowId: context.workflowId ?? context.workflow.id,
          }),
          group.referenceNode,
          {
            module: 'ai-multi-view-restore.adapter',
            fieldName: 'referenceFileId',
          },
        ),
        group.referenceNode,
        'referenceFileId',
      );

      return {
        groupId: group.groupId,
        renderFileId,
        referenceFileId,
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
      nodeType: 'aiMultiViewRestore',
      taskType: 'multi-view-restore',
      executionMode: 'legacy-grouped-task',
      nodeId: context.node.id.value,
      nodeTitle: context.nodeTitle,
      groups,
    };

    return {
      nodeId: context.node.id.value,
      nodeType: context.node.type,
      nodeTitle: context.nodeTitle,
      taskType: 'multi-view-restore',
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
