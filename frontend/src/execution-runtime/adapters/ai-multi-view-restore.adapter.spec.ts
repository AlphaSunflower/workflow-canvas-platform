import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import type { Workflow, AINodeData } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import type { ExecutionRuntimeNodeAdapterContext } from '../node-execution-adapter.types';
import { aiMultiViewRestoreExecutionRuntimeAdapter } from './ai-multi-view-restore.adapter';
import {
  MULTI_VIEW_RESTORE_REFERENCE_PORT_ID,
  MULTI_VIEW_RESTORE_RENDER_PORT_ID,
} from '@/nodes/ai-multi-view-restore/constants';
import {
  getAIMultiViewRestoreReferenceHandle,
  getAIMultiViewRestoreRenderHandle,
  getAIMultiViewRestoreResultHandle,
} from '@/nodes/ai-multi-view-restore/groups';

function createImageNode(sequence: number, fileId: string, fileName: string) {
  return createDefaultFileNodeData(
    createSequentialNodeId(sequence),
    { x: sequence * 10, y: sequence * 10 },
    'image',
    fileId,
    fileName,
    1024,
    'image/png',
    {
      width: 1024,
      height: 768,
    },
  );
}

function createWorkflow(node: AINodeData, fileNodes: ReturnType<typeof createImageNode>[]): Workflow {
  const nodes: Workflow['nodes'] = {
    [node.id.value]: node,
  };

  fileNodes.forEach((fileNode) => {
    nodes[fileNode.id.value] = fileNode;
  });

  return {
    id: 'workflow-ai-multi-view-restore',
    projectId: 'project-ai-multi-view-restore',
    name: 'AI Multi View Restore Workflow',
    nodes,
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: Object.keys(nodes).length,
      connectionCount: 0,
      lastNodeId: Math.max(...Object.keys(nodes).map((value) => Number.parseInt(value, 10))),
      canvasSize: {
        width: 1920,
        height: 1080,
      },
      relatedTasks: [],
      usedNodeIds: Object.keys(nodes),
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createResolvedGroup(
  groupId: string,
  order: number,
  renderNode: ReturnType<typeof createImageNode>,
  referenceNode: ReturnType<typeof createImageNode>,
): WorkflowResolvedNodeGroupState {
  return {
    group: {
      id: groupId,
      label: `Group ${order + 1}`,
      order,
    },
    ports: [
      {
        portId: MULTI_VIEW_RESTORE_RENDER_PORT_ID,
        label: 'Render',
        handle: getAIMultiViewRestoreRenderHandle(groupId),
        inputs: [{
          groupId,
          portId: MULTI_VIEW_RESTORE_RENDER_PORT_ID,
          handle: getAIMultiViewRestoreRenderHandle(groupId),
          connection: {
            id: `render-connection-${groupId}`,
            type: 'file-reference',
            sourceId: renderNode.id.value,
            targetId: '100',
            targetHandle: getAIMultiViewRestoreRenderHandle(groupId),
            order,
          },
          sourceNode: renderNode,
        }],
      },
      {
        portId: MULTI_VIEW_RESTORE_REFERENCE_PORT_ID,
        label: 'Reference',
        handle: getAIMultiViewRestoreReferenceHandle(groupId),
        inputs: [{
          groupId,
          portId: MULTI_VIEW_RESTORE_REFERENCE_PORT_ID,
          handle: getAIMultiViewRestoreReferenceHandle(groupId),
          connection: {
            id: `reference-connection-${groupId}`,
            type: 'file-reference',
            sourceId: referenceNode.id.value,
            targetId: '100',
            targetHandle: getAIMultiViewRestoreReferenceHandle(groupId),
            order,
          },
          sourceNode: referenceNode,
        }],
      },
    ],
  };
}

function createContext(options: {
  groups: WorkflowResolvedNodeGroupState[];
  services?: ExecutionRuntimeNodeAdapterContext['services'];
}): ExecutionRuntimeNodeAdapterContext {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiMultiViewRestore',
  );

  const fileNodes = options.groups.flatMap((group) => group.ports.flatMap((port) => port.inputs.map((input) => input.sourceNode)));

  return {
    workflowId: 'workflow-ai-multi-view-restore',
    workflow: createWorkflow(node, fileNodes),
    node,
    nodeTitle: 'AI Multi View Restore',
    inputs: [],
    resolvedInputGroups: options.groups,
    signal: undefined,
    services: options.services,
  };
}

test('AI Multi View Restore adapter creates grouped payload with render and reference file ids', async () => {
  const render1 = createImageNode(1, 'render-local-1', 'render-1.png');
  const reference1 = createImageNode(2, 'reference-local-1', 'reference-1.png');
  const render2 = createImageNode(3, 'render-local-2', 'render-2.png');
  const reference2 = createImageNode(4, 'reference-local-2', 'reference-2.png');
  const ensureCalls: string[] = [];

  const context = createContext({
    groups: [
      createResolvedGroup('group-1', 0, render1, reference1),
      createResolvedGroup('group-2', 1, render2, reference2),
    ],
    services: {
      ensureBackendFileId: async (node) => {
        ensureCalls.push(node.fileId);
        return `backend-${node.fileId}`;
      },
    },
  });

  const payload = await aiMultiViewRestoreExecutionRuntimeAdapter.createExecutionPayload(context);

  assert.deepEqual(ensureCalls, [
    'render-local-1',
    'render-local-2',
    'reference-local-1',
    'reference-local-2',
  ]);
  assert.deepEqual(payload.request, {
    nodeType: 'aiMultiViewRestore',
    taskType: 'multi-view-restore',
    executionMode: 'legacy-grouped-task',
    nodeId: '100',
    nodeTitle: 'AI Multi View Restore',
    groups: [
      {
        groupId: 'group-1',
        renderFileId: 'backend-render-local-1',
        referenceFileId: 'backend-reference-local-1',
      },
      {
        groupId: 'group-2',
        renderFileId: 'backend-render-local-2',
        referenceFileId: 'backend-reference-local-2',
      },
    ],
  });
  assert.deepEqual(payload.targets, [
    {
      kind: 'group',
      nodeId: '100',
      nodeType: 'aiMultiViewRestore',
      groupId: 'group-1',
      groupOrder: 0,
      groupLabel: 'Group 1',
      outputHandle: getAIMultiViewRestoreResultHandle('group-1'),
    },
    {
      kind: 'group',
      nodeId: '100',
      nodeType: 'aiMultiViewRestore',
      groupId: 'group-2',
      groupOrder: 1,
      groupLabel: 'Group 2',
      outputHandle: getAIMultiViewRestoreResultHandle('group-2'),
    },
  ]);
});

test('AI Multi View Restore adapter rejects empty ensured backend file id', async () => {
  const render = createImageNode(1, 'render-local', 'render.png');
  const reference = createImageNode(2, 'reference-local', 'reference.png');

  const context = createContext({
    groups: [createResolvedGroup('group-1', 0, render, reference)],
    services: {
      ensureBackendFileId: async (node) => (
        node.fileId === 'reference-local'
          ? '   '
          : `backend-${node.fileId}`
      ),
    },
  });

  await assert.rejects(
    Promise.resolve(aiMultiViewRestoreExecutionRuntimeAdapter.createExecutionPayload(context)),
    (error: unknown) => {
      assert.equal(typeof error, 'object');
      assert.ok(error !== null);
      assert.equal((error as { code?: string }).code, 'FILE_REGISTER_FAILED');
      assert.equal((error as { context?: { fieldName?: string } }).context?.fieldName, 'referenceFileId');
      return true;
    },
  );
});
