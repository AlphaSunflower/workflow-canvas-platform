import type { AnyNodeData, Connection, Workflow } from '@/types';
import type {
  NodeCustomDropCapability,
  NodeDropKeyboardState,
  NodeDropCapability,
  NodeDropPreview,
  NodeDropTarget,
  NodeDropTargetContext,
  NodeDropTargetType,
} from '../types';
import type {
  GroupedDropMode,
  GroupedDropPanelSide,
  GroupedDropSidePortBinding,
  GroupedDropSidePortMap,
  GroupedDropTarget,
} from './grouped-drop/types';
import { parseGroupedDropToken } from './grouped-drop/tokens';

export interface DropzoneDataset {
  nodeId: string;
  nodeType: NodeDropTargetType;
  groupId?: string;
}

export const NODE_DROPZONE_SELECTOR = '[data-node-dropzone]';

function isHTMLElement(value: unknown): value is HTMLElement {
  if (typeof HTMLElement === 'undefined') {
    return typeof value === 'object' && value !== null && 'dataset' in value;
  }

  return value instanceof HTMLElement;
}

export function findDropzoneElementFromElement(
  element: Element | null
): HTMLElement | null {
  if (!isHTMLElement(element)) {
    return null;
  }

  const dropzone = element.closest<HTMLElement>(NODE_DROPZONE_SELECTOR);
  return isHTMLElement(dropzone) ? dropzone : null;
}

export function findDropTargetFromElement(
  element: Element | null
): NodeDropTarget | null {
  return findDropTargetFromDropzoneElement(findDropzoneElementFromElement(element));
}

export function findDropTargetFromDropzoneElement(
  dropzone: HTMLElement | null
): NodeDropTarget | null {
  if (!dropzone) {
    return null;
  }

  if (!isHTMLElement(dropzone)) {
    return null;
  }

  const nodeId = dropzone.dataset.nodeId;
  const nodeType = dropzone.dataset.nodeDropzone as NodeDropTargetType | undefined;
  if (!nodeId || !nodeType) {
    return null;
  }

  if (nodeType === 'group') {
    const groupId = dropzone.dataset.groupId;
    if (!groupId) {
      return null;
    }

    return {
      nodeId,
      nodeType,
      groupId,
    };
  }

  return {
    nodeId,
    nodeType: 'body',
  };
}

export function createDropKeyboardState(
  keyboardState?: Partial<NodeDropKeyboardState>
): NodeDropKeyboardState {
  return {
    shiftKey: Boolean(keyboardState?.shiftKey),
    ctrlKey: Boolean(keyboardState?.ctrlKey),
    metaKey: Boolean(keyboardState?.metaKey),
  };
}

export function resolveGroupedDropMode(
  keyboardState?: Partial<NodeDropKeyboardState>
): GroupedDropMode {
  const keyboard = createDropKeyboardState(keyboardState);
  const useShift = keyboard.shiftKey;
  const useCtrl = keyboard.ctrlKey || keyboard.metaKey;

  if (useShift && useCtrl) {
    return 'invalid';
  }

  if (useCtrl) {
    return 'ctrl';
  }

  if (useShift) {
    return 'shift';
  }

  return 'normal';
}

export function resolveGroupedDropTarget<TSide extends string = GroupedDropPanelSide>(
  target: NodeDropTarget | null | undefined
): GroupedDropTarget<TSide> | null {
  if (!target || target.nodeType !== 'group') {
    return null;
  }

  return parseGroupedDropToken<TSide>(target.groupId);
}

export function createGroupedDropSidePortMap<TSide extends string = GroupedDropPanelSide>(
  bindings: readonly GroupedDropSidePortBinding<TSide>[]
): GroupedDropSidePortMap<TSide> {
  return Object.freeze(bindings.reduce<Partial<Record<TSide, string>>>((result, binding) => {
    result[binding.side] = binding.portId;
    return result;
  }, {}));
}

export function resolveGroupedDropPortId<TSide extends string = GroupedDropPanelSide>(
  target: GroupedDropTarget<TSide>,
  sidePortMap: GroupedDropSidePortMap<TSide>
): string | null {
  if (target.kind === 'slot') {
    return target.portId;
  }

  return sidePortMap[target.side] ?? null;
}

export function createDropTargetContext(
  workflow: Workflow,
  target: NodeDropTarget,
  draggedNodes: AnyNodeData[],
  keyboardState?: Partial<NodeDropKeyboardState>
): NodeDropTargetContext {
  return {
    workflow,
    target,
    draggedNodes,
    keyboard: createDropKeyboardState(keyboardState),
  };
}

export function createInvalidDropPreview(reason: string): NodeDropPreview {
  return {
    valid: false,
    reason,
  };
}

export function createValidDropPreview(): NodeDropPreview {
  return {
    valid: true,
  };
}

export function isCustomNodeDropCapability(
  capability: NodeDropCapability | null | undefined
): capability is NodeCustomDropCapability {
  return capability?.mode === 'custom';
}

export function replaceNodeConnections(
  workflow: Workflow,
  nodeId: string,
  nextConnections: Connection[]
): Connection[] {
  const remainingConnections = workflow.connections.filter((connection) =>
    connection.targetId !== nodeId
  );

  return [...remainingConnections, ...nextConnections];
}
