import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import type { Workflow, AINodeData } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import type { ExecutionRuntimeNodeAdapterContext } from '../node-execution-adapter.types';
import { aiImageToPlyExecutionRuntimeAdapter } from './ai-image-to-ply.adapter';
import {
  AI_IMAGE_TO_PLY_INPUT_PORT_ID,
  getAIImageToPlyGroupInputHandle,
  getAIImageToPlyGroupOutputHandle,
} from '@/nodes/ai-image-to-ply/groups';

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
    id: 'workflow-ai-image-to-ply',
    projectId: 'project-ai-image-to-ply',
    name: 'AI Image To PLY Workflow',
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
  inputNode: ReturnType<typeof createImageNode>,
): WorkflowResolvedNodeGroupState {
  return {
    group: {
      id: groupId,
      label: `Group ${order + 1}`,
      order,
    },
    ports: [{
      portId: AI_IMAGE_TO_PLY_INPUT_PORT_ID,
      label: 'Input Image',
      handle: getAIImageToPlyGroupInputHandle(groupId),
      inputs: [{
        groupId,
        portId: AI_IMAGE_TO_PLY_INPUT_PORT_ID,
        handle: getAIImageToPlyGroupInputHandle(groupId),
        connection: {
          id: `connection-${groupId}`,
          type: 'file-reference',
          sourceId: inputNode.id.value,
          targetId: '100',
          targetHandle: getAIImageToPlyGroupInputHandle(groupId),
          order,
        },
        sourceNode: inputNode,
      }],
    }],
  };
}

function createContext(options: {
  groups: WorkflowResolvedNodeGroupState[];
  services?: ExecutionRuntimeNodeAdapterContext['services'];
}): ExecutionRuntimeNodeAdapterContext {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiImageToPly',
  );

  const fileNodes = options.groups.flatMap((group) => group.ports.flatMap((port) => port.inputs.map((input) => input.sourceNode)));

  return {
    workflowId: 'workflow-ai-image-to-ply',
    workflow: createWorkflow(node, fileNodes),
    node,
    nodeTitle: 'AI Image To PLY',
    inputs: [],
    resolvedInputGroups: options.groups,
    signal: undefined,
    services: options.services,
  };
}

test('AI Image To PLY adapter creates grouped payload with non-empty sourceFileId', async () => {
  const image1 = createImageNode(1, 'local-file-1', 'image-1.png');
  const image2 = createImageNode(2, 'local-file-2', 'image-2.png');
  const ensureCalls: string[] = [];

  const context = createContext({
    groups: [
      createResolvedGroup('group-1', 0, image1),
      createResolvedGroup('group-2', 1, image2),
    ],
    services: {
      ensureBackendFileId: async (node) => {
        ensureCalls.push(node.fileId);
        return `backend-${node.fileId}`;
      },
    },
  });

  const payload = await aiImageToPlyExecutionRuntimeAdapter.createExecutionPayload(context);

  assert.deepEqual(ensureCalls, ['local-file-1', 'local-file-2']);
  assert.deepEqual(payload.request, {
    nodeType: 'aiImageToPly',
    taskType: 'image-to-ply',
    executionMode: 'legacy-grouped-task',
    nodeId: '100',
    nodeTitle: 'AI Image To PLY',
    groups: [
      {
        groupId: 'group-1',
        sourceFileId: 'backend-local-file-1',
      },
      {
        groupId: 'group-2',
        sourceFileId: 'backend-local-file-2',
      },
    ],
  });
  assert.deepEqual(payload.targets, [
    {
      kind: 'group',
      nodeId: '100',
      nodeType: 'aiImageToPly',
      groupId: 'group-1',
      groupOrder: 0,
      groupLabel: 'Group 1',
      outputHandle: getAIImageToPlyGroupOutputHandle('group-1'),
    },
    {
      kind: 'group',
      nodeId: '100',
      nodeType: 'aiImageToPly',
      groupId: 'group-2',
      groupOrder: 1,
      groupLabel: 'Group 2',
      outputHandle: getAIImageToPlyGroupOutputHandle('group-2'),
    },
  ]);
});

test('AI Image To PLY adapter always resolves backend file ids for local uuid-like file ids', async () => {
  const image = createImageNode(1, '96539eae-3295-4fb9-803e-26ef11658027', 'image-1.png');
  const ensureCalls: string[] = [];

  const context = createContext({
    groups: [createResolvedGroup('group-1', 0, image)],
    services: {
      ensureBackendFileId: async (node) => {
        ensureCalls.push(node.fileId);
        return 'backend-file-123';
      },
    },
  });

  const payload = await aiImageToPlyExecutionRuntimeAdapter.createExecutionPayload(context);
  const request = payload.request as {
    groups: Array<{
      groupId: string;
      sourceFileId: string;
    }>;
  };

  assert.deepEqual(ensureCalls, ['96539eae-3295-4fb9-803e-26ef11658027']);
  assert.equal(request.groups.length, 1);
  assert.equal(request.groups[0]?.sourceFileId, 'backend-file-123');
});

test('AI Image To PLY adapter fails early when ensureBackendFileId returns empty value', async () => {
  const image = createImageNode(1, 'local-file-1', 'image-1.png');
  const context = createContext({
    groups: [createResolvedGroup('group-1', 0, image)],
    services: {
      ensureBackendFileId: async () => '   ',
    },
  });

  await assert.rejects(
    Promise.resolve(aiImageToPlyExecutionRuntimeAdapter.createExecutionPayload(context)),
    (error: unknown) => {
      assert.equal(typeof error, 'object');
      assert.ok(error !== null);
      assert.equal((error as { code?: string }).code, 'FILE_REGISTER_FAILED');
      assert.ok(((error as { message?: string }).message ?? '').includes('后端 sourceFileId'));
      return true;
    },
  );
});
