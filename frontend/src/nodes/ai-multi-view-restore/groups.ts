import type { AINodeData } from '@/types';
import type {
  NodeConnectionValidationContext,
  NodeDefinition,
  NodeValidationResult,
} from '../types';
import {
  buildFixedGroups,
  parseGroupPortHandle,
  validateGroupedSingleInput,
} from '../shared/connection';
import { getGroupInputHandle, getGroupOutputHandle } from '../shared/groups';
import {
  MULTI_VIEW_RESTORE_MAX_GROUPS,
  MULTI_VIEW_RESTORE_MIN_GROUPS,
  MULTI_VIEW_RESTORE_REFERENCE_PORT_ID,
  MULTI_VIEW_RESTORE_RENDER_PORT_ID,
  MULTI_VIEW_RESTORE_RESULT_PORT_ID,
} from './constants';

export const aiMultiViewRestoreInputGroups: NonNullable<NodeDefinition['inputGroups']> = {
  mode: 'dynamic',
  minGroups: MULTI_VIEW_RESTORE_MIN_GROUPS,
  maxGroups: MULTI_VIEW_RESTORE_MAX_GROUPS,
  ordered: true,
  supportsAdd: true,
  supportsRemove: true,
  handleStyle: 'group-port',
};

export const resolveAIMultiViewRestoreInputGroups: NonNullable<NodeDefinition['resolveInputGroups']> = (node) => buildFixedGroups(
  node,
  (groupId, label) => ({
    id: groupId,
    label,
    ports: [
      {
        id: MULTI_VIEW_RESTORE_RENDER_PORT_ID,
        label: '渲染图',
        accepts: ['image'],
        required: true,
        maxConnections: 1,
      },
      {
        id: MULTI_VIEW_RESTORE_REFERENCE_PORT_ID,
        label: '原视角参考图',
        accepts: ['image'],
        required: true,
        maxConnections: 1,
      },
      {
        id: MULTI_VIEW_RESTORE_RESULT_PORT_ID,
        label: '结果输出',
        accepts: [],
        required: false,
        maxConnections: 1,
      },
    ],
  })
);

export function getAIMultiViewRestoreRenderHandle(groupId: string): string {
  return getGroupInputHandle(groupId, MULTI_VIEW_RESTORE_RENDER_PORT_ID);
}

export function getAIMultiViewRestoreReferenceHandle(groupId: string): string {
  return getGroupInputHandle(groupId, MULTI_VIEW_RESTORE_REFERENCE_PORT_ID);
}

export function getAIMultiViewRestoreResultHandle(groupId: string): string {
  return getGroupOutputHandle(groupId, MULTI_VIEW_RESTORE_RESULT_PORT_ID);
}

function hasDuplicateSourceInSameGroupAcrossPorts(
  context: NodeConnectionValidationContext,
  groupId: string,
  portId: string
): boolean {
  return context.existingInputs.some((input) => {
    const parsedHandle = parseGroupPortHandle(input.connection.targetHandle);
    if (!parsedHandle) {
      return false;
    }

    return parsedHandle.groupId === groupId
      && parsedHandle.portId !== portId
      && input.sourceNode.id.value === context.sourceNode.id.value;
  });
}

export function validateAIMultiViewRestoreConnection(
  context: NodeConnectionValidationContext
): NodeValidationResult {
  const parsedHandle = parseGroupPortHandle(context.targetHandle);
  if (!parsedHandle) {
    return {
      valid: false,
      reason: '请连接到具体输入槽。',
    };
  }

  if (
    parsedHandle.portId !== MULTI_VIEW_RESTORE_RENDER_PORT_ID
    && parsedHandle.portId !== MULTI_VIEW_RESTORE_REFERENCE_PORT_ID
  ) {
    return {
      valid: false,
      reason: '请连接到渲染图或原视角参考图槽位。',
    };
  }

  const validationResult = validateGroupedSingleInput(
    context,
    resolveAIMultiViewRestoreInputGroups(context.targetNode as AINodeData)
  );

  if (!validationResult.valid) {
    return validationResult;
  }

  if (hasDuplicateSourceInSameGroupAcrossPorts(context, parsedHandle.groupId, parsedHandle.portId)) {
    return {
      valid: false,
      reason: '同一张图片不能同时作为同组的渲染图和原视角参考图。',
    };
  }

  return {
    valid: true,
  };
}
