import type { NodeDefinition, RegisteredAINodeType } from '@/nodes/types';
import type { ContextMenuItem } from '@/components/ui';
import { isFileNodeData } from '@/utils';
import type {
  CanvasContextMenuTargetContext,
  ContextMenuActionHandlers,
} from './types';

export interface BuildContextMenuItemsOptions {
  target: CanvasContextMenuTargetContext;
  aiNodeDefinitions: NodeDefinition[];
  handlers: ContextMenuActionHandlers;
}

function isDefinitionVisibleInCanvasMenu(definition: NodeDefinition): boolean {
  if (definition.menu.visible === false) {
    return false;
  }

  if (Array.isArray(definition.menu.contexts) && definition.menu.contexts.length > 0) {
    return definition.menu.contexts.includes('canvas');
  }

  return true;
}

function buildCanvasMenuItems(
  position: Parameters<ContextMenuActionHandlers['onImportFiles']>[0],
  aiNodeDefinitions: NodeDefinition[],
  handlers: ContextMenuActionHandlers
): ContextMenuItem[] {
  const {
    onImportFiles,
    onCreateNode,
  } = handlers;

  const items: ContextMenuItem[] = [
    {
      id: 'import-files',
      label: '\u5bfc\u5165\u6587\u4ef6',
      icon: '+',
      onClick: () => onImportFiles(position),
    },
    { id: 'divider-1', divider: true, label: '' },
  ];

  aiNodeDefinitions
    .slice()
    .filter(isDefinitionVisibleInCanvasMenu)
    .sort((left, right) => left.menu.order - right.menu.order)
    .forEach((definition) => {
      items.push({
        id: `create-${definition.type}`,
        label: `\u521b\u5efa${definition.displayName}\u8282\u70b9`,
        icon: definition.icon,
        onClick: () => onCreateNode(definition.type, position),
      });
    });

  return items;
}

function buildNodeMenuItems(
  target: Extract<CanvasContextMenuTargetContext, { kind: 'node' }>,
  handlers: ContextMenuActionHandlers
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (isFileNodeData(target.nodeData)) {
    if (target.nodeData.type === 'image') {
      items.push({
        id: 'split-image-node',
        label: '拆分图片',
        icon: '▦',
        children: [
          {
            id: 'split-image-node-2x2',
            label: '2*2',
            onClick: () => handlers.onSplitImageNode(target.nodeId, { kind: 'preset', rows: 2, cols: 2 }),
          },
          {
            id: 'split-image-node-3x3',
            label: '3*3',
            onClick: () => handlers.onSplitImageNode(target.nodeId, { kind: 'preset', rows: 3, cols: 3 }),
          },
          {
            id: 'split-image-node-4x4',
            label: '4*4',
            onClick: () => handlers.onSplitImageNode(target.nodeId, { kind: 'preset', rows: 4, cols: 4 }),
          },
          {
            id: 'split-image-node-custom',
            label: '自定义...',
            onClick: () => handlers.onSplitImageNode(target.nodeId, { kind: 'custom' }),
          },
        ],
      });
    }
    items.push({
      id: 'save-file-node',
      label: '\u4fdd\u5b58\u5230\u76ee\u5f55',
      icon: '\u2b07',
      onClick: () => handlers.onExportFileNode(target.nodeId, { forceDirectoryPicker: true }),
    });
    items.push({
      id: 'file-properties',
      label: '\u5c5e\u6027',
      icon: 'i',
      onClick: () => handlers.onOpenFileProperties(target.nodeId),
    });
    items.push({ id: 'divider-1', divider: true, label: '' });
  }

  items.push({
    id: 'delete-node',
    label: '\u5220\u9664\u8282\u70b9',
    icon: 'X',
    danger: true,
    onClick: () => handlers.onDeleteNode(target.nodeId),
  });

  return items;
}

export function buildContextMenuItems(
  options: BuildContextMenuItemsOptions
): ContextMenuItem[] {
  const { target, aiNodeDefinitions, handlers } = options;

  switch (target.kind) {
    case 'canvas':
      return buildCanvasMenuItems(target.position, aiNodeDefinitions, handlers);
    case 'node':
      return buildNodeMenuItems(target, handlers);
    default:
      return [];
  }
}

export type { CanvasContextMenuTargetContext } from './types';
export type { RegisteredAINodeType };
