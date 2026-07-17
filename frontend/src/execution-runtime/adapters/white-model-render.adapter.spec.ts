import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import type { Workflow, AINodeData } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import type { ExecutionRuntimeNodeAdapterContext } from '../node-execution-adapter.types';
import { whiteModelRenderExecutionRuntimeAdapter } from './white-model-render.adapter';
import {
  MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
  MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
} from '@/nodes/ai-model-render-transfer/constants';
import {
  getAIModelRenderTransferResultHandle,
  getAIModelRenderTransferStyleReferenceHandle,
  getAIModelRenderTransferWhiteModelHandle,
} from '@/nodes/ai-model-render-transfer/groups';

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
    id: 'workflow-white-model-render',
    projectId: 'project-white-model-render',
    name: 'White Model Render Workflow',
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
  whiteModelNode: ReturnType<typeof createImageNode>,
  styleReferenceNode: ReturnType<typeof createImageNode>,
): WorkflowResolvedNodeGroupState {
  return {
    group: {
      id: groupId,
      label: `Group ${order + 1}`,
      order,
    },
    ports: [
      {
        portId: MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
        label: 'White Model',
        handle: getAIModelRenderTransferWhiteModelHandle(groupId),
        inputs: [{
          groupId,
          portId: MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
          handle: getAIModelRenderTransferWhiteModelHandle(groupId),
          connection: {
            id: `connection-${groupId}-white-model`,
            type: 'file-reference',
            sourceId: whiteModelNode.id.value,
            targetId: '100',
            targetHandle: getAIModelRenderTransferWhiteModelHandle(groupId),
            order: 0,
          },
          sourceNode: whiteModelNode,
        }],
      },
      {
        portId: MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
        label: 'Style Reference',
        handle: getAIModelRenderTransferStyleReferenceHandle(groupId),
        inputs: [{
          groupId,
          portId: MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
          handle: getAIModelRenderTransferStyleReferenceHandle(groupId),
          connection: {
            id: `connection-${groupId}-style-reference`,
            type: 'file-reference',
            sourceId: styleReferenceNode.id.value,
            targetId: '100',
            targetHandle: getAIModelRenderTransferStyleReferenceHandle(groupId),
            order: 1,
          },
          sourceNode: styleReferenceNode,
        }],
      },
    ],
  };
}

function createContext(options: {
  model?: string;
  imageSize?: string;
  aspectRatio?: string;
  groups: WorkflowResolvedNodeGroupState[];
  services?: ExecutionRuntimeNodeAdapterContext['services'];
}): ExecutionRuntimeNodeAdapterContext {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiModelRenderTransfer',
  );

  node.config = {
    ...node.config,
    model: options.model ?? 'gpt-image-2-vip',
    imageSize: options.imageSize ?? '2K',
    aspectRatio: options.aspectRatio ?? '16:9',
  };

  const fileNodes = options.groups.flatMap((group) => group.ports.flatMap((port) => port.inputs.map((input) => input.sourceNode)));

  return {
    workflowId: 'workflow-white-model-render',
    workflow: createWorkflow(node, fileNodes),
    node,
    nodeTitle: 'White Model Render',
    inputs: [],
    resolvedInputGroups: options.groups,
    signal: undefined,
    services: options.services,
  };
}

test('white model render adapter forwards model and simplified size params without derived size', async () => {
  const whiteModelNode = createImageNode(1, 'white-model-file', 'white-model.png');
  const styleReferenceNode = createImageNode(2, 'style-reference-file', 'style-reference.png');
  const ensureCalls: string[] = [];

  const context = createContext({
    model: 'gpt-image-2-vip',
    imageSize: '4K',
    aspectRatio: '9:16',
    groups: [createResolvedGroup('group-1', 0, whiteModelNode, styleReferenceNode)],
    services: {
      ensureBackendFileId: async (node) => {
        ensureCalls.push(node.fileId);
        return `${node.fileId}-backend`;
      },
    },
  });

  const payload = await whiteModelRenderExecutionRuntimeAdapter.createExecutionPayload(context);
  const request = payload.request as Record<string, unknown>;

  assert.deepEqual(ensureCalls, ['white-model-file', 'style-reference-file']);
  assert.deepEqual(payload.request, {
    nodeType: 'aiModelRenderTransfer',
    taskType: 'model-render-transfer',
    executionMode: 'legacy-grouped-task',
    nodeId: '100',
    nodeTitle: 'White Model Render',
    model: 'gpt-image-2-vip',
    imageSize: '4K',
    aspectRatio: '9:16',
    groups: [{
      groupId: 'group-1',
      whiteModelFileId: 'white-model-file-backend',
      styleReferenceFileId: 'style-reference-file-backend',
    }],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'size'), false);
  assert.deepEqual(payload.targets, [{
    kind: 'group',
    nodeId: '100',
    nodeType: 'aiModelRenderTransfer',
    groupId: 'group-1',
    groupOrder: 0,
    groupLabel: 'Group 1',
    outputHandle: getAIModelRenderTransferResultHandle('group-1'),
  }]);
});

test('white model render adapter omits image params for GPT Image 2 default model', async () => {
  const whiteModelNode = createImageNode(1, 'white-model-file', 'white-model.png');
  const styleReferenceNode = createImageNode(2, 'style-reference-file', 'style-reference.png');

  const context = createContext({
    model: 'gpt-image-2',
    imageSize: '4K',
    aspectRatio: '9:16',
    groups: [createResolvedGroup('group-1', 0, whiteModelNode, styleReferenceNode)],
    services: {
      ensureBackendFileId: async (node) => `${node.fileId}-backend`,
    },
  });

  const payload = await whiteModelRenderExecutionRuntimeAdapter.createExecutionPayload(context);
  const request = payload.request as Record<string, unknown>;

  assert.equal(request.model, 'gpt-image-2');
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'imageSize'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'aspectRatio'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'size'), false);
});

test('white model render adapter rejects empty ensured backend file id', async () => {
  const whiteModelNode = createImageNode(1, 'white-model-file', 'white-model.png');
  const styleReferenceNode = createImageNode(2, 'style-reference-file', 'style-reference.png');

  const context = createContext({
    groups: [createResolvedGroup('group-1', 0, whiteModelNode, styleReferenceNode)],
    services: {
      ensureBackendFileId: async (node) => (
        node.fileId === 'white-model-file'
          ? '   '
          : `${node.fileId}-backend`
      ),
    },
  });

  await assert.rejects(
    Promise.resolve(whiteModelRenderExecutionRuntimeAdapter.createExecutionPayload(context)),
    (error: unknown) => {
      assert.equal(typeof error, 'object');
      assert.ok(error !== null);
      assert.equal((error as { code?: string }).code, 'FILE_REGISTER_FAILED');
      assert.equal((error as { context?: { fieldName?: string } }).context?.fieldName, 'whiteModelFileId');
      return true;
    },
  );
});
