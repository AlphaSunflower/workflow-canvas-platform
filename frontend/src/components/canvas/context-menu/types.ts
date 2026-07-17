import type { RegisteredAINodeType } from '@/nodes/types';
import type { AnyNodeData, Position } from '@/types';

export interface ContextMenuActionHandlers {
  onImportFiles: (position: Position) => void;
  onCreateNode: (type: RegisteredAINodeType, position: Position) => void;
  onDeleteNode: (nodeId: string) => void;
  onOpenFileProperties: (nodeId: string) => void;
  onExportFileNode: (nodeId: string, options?: { forceDirectoryPicker?: boolean }) => void;
  onSplitImageNode: (nodeId: string, grid: ImageGridSplitMenuSelection) => void;
}

export type ImageGridSplitMenuSelection =
  | { kind: 'preset'; rows: number; cols: number }
  | { kind: 'custom' };

export interface CanvasContextMenuTarget {
  kind: 'canvas';
  position: Position;
}

export interface NodeContextMenuTarget {
  kind: 'node';
  nodeId: string;
  nodeType: AnyNodeData['type'];
  nodeData: AnyNodeData;
}

export type CanvasContextMenuTargetContext =
  | CanvasContextMenuTarget
  | NodeContextMenuTarget;
