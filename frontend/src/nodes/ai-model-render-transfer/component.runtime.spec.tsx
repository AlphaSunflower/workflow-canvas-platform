import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import { createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import { buildAIModelRenderTransferInputLayoutVersion } from './layout';
import {
  getAIModelRenderTransferStyleReferenceHandle,
  getAIModelRenderTransferWhiteModelHandle,
} from './groups';
import {
  MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
  MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
} from './constants';

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

function createResolvedGroupState(): WorkflowResolvedNodeGroupState[] {
  const whiteModelNode = createImageNode(1, 'white-model-file', 'white-model.png');
  const styleReferenceNode = createImageNode(2, 'style-reference-file', 'style-reference.png');

  return [{
    group: {
      id: 'group-1',
      label: 'Group 1',
      order: 0,
    },
    ports: [
      {
        portId: MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
        label: '白模图',
        handle: getAIModelRenderTransferWhiteModelHandle('group-1'),
        inputs: [{
          groupId: 'group-1',
          portId: MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
          handle: getAIModelRenderTransferWhiteModelHandle('group-1'),
          connection: {
            id: 'connection-white-model',
            type: 'file-reference',
            sourceId: whiteModelNode.id.value,
            targetId: '100',
            targetHandle: getAIModelRenderTransferWhiteModelHandle('group-1'),
            order: 0,
          },
          sourceNode: whiteModelNode,
        }],
      },
      {
        portId: MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
        label: '风格参考图',
        handle: getAIModelRenderTransferStyleReferenceHandle('group-1'),
        inputs: [{
          groupId: 'group-1',
          portId: MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
          handle: getAIModelRenderTransferStyleReferenceHandle('group-1'),
          connection: {
            id: 'connection-style-reference',
            type: 'file-reference',
            sourceId: styleReferenceNode.id.value,
            targetId: '100',
            targetHandle: getAIModelRenderTransferStyleReferenceHandle('group-1'),
            order: 1,
          },
          sourceNode: styleReferenceNode,
        }],
      },
    ],
  }];
}

test('白模节点布局版本键只取决于输入结构，不受执行态变化影响', () => {
  const resolvedGroups = createResolvedGroupState();

  const before = buildAIModelRenderTransferInputLayoutVersion(resolvedGroups);
  const after = buildAIModelRenderTransferInputLayoutVersion(resolvedGroups.map((groupState) => ({
    ...groupState,
    ports: groupState.ports.map((port) => ({
      ...port,
      inputs: port.inputs.map((input) => ({
        ...input,
      })),
    })),
  })));

  assert.equal(before, after);
});

test('白模节点输入结构变化会改变布局版本键', () => {
  const resolvedGroups = createResolvedGroupState();
  const changedGroups = createResolvedGroupState();
  changedGroups[0] = {
    ...changedGroups[0],
    ports: changedGroups[0].ports.map((port) => {
      if (port.portId !== MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID) {
        return port;
      }

      return {
        ...port,
        inputs: [{
          ...port.inputs[0],
          connection: {
            ...port.inputs[0].connection,
            id: 'connection-white-model-updated',
          },
        }],
      };
    }),
  };

  const before = buildAIModelRenderTransferInputLayoutVersion(resolvedGroups);
  const after = buildAIModelRenderTransferInputLayoutVersion(changedGroups);

  assert.notStrictEqual(before, after);
});
