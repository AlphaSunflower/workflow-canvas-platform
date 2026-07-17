import type { AINodeData } from '@/types';
import { ensureAIImageInputGroups } from '@/utils/node';
import type { NodeConnectionValidationContext, NodeDefinition } from '../types';
import {
  buildFixedGroups,
  validateDefinitionDrivenConnection,
} from '../shared/connection';
import { getGroupInputHandle, getGroupOutputHandle } from '../shared/groups';
import {
  MODEL_RENDER_TRANSFER_MAX_GROUPS,
  MODEL_RENDER_TRANSFER_MIN_GROUPS,
  MODEL_RENDER_TRANSFER_RESULT_PORT_ID,
  MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
  MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
} from './constants';

export const aiModelRenderTransferInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'dynamic',
  minGroups: MODEL_RENDER_TRANSFER_MIN_GROUPS,
  maxGroups: MODEL_RENDER_TRANSFER_MAX_GROUPS,
  ordered: true,
  supportsAdd: true,
  supportsRemove: true,
  handleStyle: 'group-port',
};

export const resolveAIModelRenderTransferInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> = (node) => {
  const normalizedNode: AINodeData = {
    ...node,
    config: {
      ...node.config,
      inputGroups: ensureAIImageInputGroups(node.config).slice(0, MODEL_RENDER_TRANSFER_MAX_GROUPS),
    },
  };

  return buildFixedGroups(normalizedNode, (groupId, label) => ({
    id: groupId,
    label,
    ports: [
      {
        id: MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID,
        label: '白模图',
        accepts: ['image'],
        required: true,
        maxConnections: 1,
      },
      {
        id: MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID,
        label: '风格参考图',
        accepts: ['image'],
        required: true,
        maxConnections: 1,
      },
      {
        id: MODEL_RENDER_TRANSFER_RESULT_PORT_ID,
        label: '结果输出',
        accepts: [],
        required: false,
        maxConnections: 1,
      },
    ],
  }));
};

export function getAIModelRenderTransferWhiteModelHandle(groupId: string): string {
  return getGroupInputHandle(groupId, MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID);
}

export function getAIModelRenderTransferStyleReferenceHandle(groupId: string): string {
  return getGroupInputHandle(groupId, MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID);
}

export function getAIModelRenderTransferResultHandle(groupId: string): string {
  return getGroupOutputHandle(groupId, MODEL_RENDER_TRANSFER_RESULT_PORT_ID);
}

export function validateAIModelRenderTransferConnection(
  context: NodeConnectionValidationContext
): ReturnType<typeof validateDefinitionDrivenConnection> {
  return validateDefinitionDrivenConnection(
    context,
    resolveAIModelRenderTransferInputGroups(context.targetNode as AINodeData)
  );
}
