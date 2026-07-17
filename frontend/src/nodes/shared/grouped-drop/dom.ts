import type { NodeDropTarget } from '../../types';
import { createGroupedPanelDropToken, createGroupedSlotDropToken } from './tokens';
import {
  resolveGroupedDropInteractionDisplayMode,
  type GroupedDropInteractionDisplayMode,
  type GroupedDropMode,
} from './types';

export interface GroupedDropRegionDataset {
  'data-drag-mode': GroupedDropInteractionDisplayMode;
}

export interface GroupedDropPanelTargetDataset {
  'data-node-dropzone': 'group';
  'data-node-id': string;
  'data-group-id': string;
  'data-drop-scope': 'panel';
  'data-drop-side': string;
  'data-panel-label'?: string;
}

export interface GroupedDropSlotTargetDataset {
  'data-node-dropzone': 'group';
  'data-node-id': string;
  'data-group-id': string;
  'data-drop-scope': 'slot';
  'data-drop-port-id': string;
}

export interface GroupedPanelTargetOptions<TSide extends string> {
  nodeId: string;
  side: TSide;
  panelLabel?: string;
}

export interface GroupedSlotTargetOptions {
  nodeId: string;
  groupId: string;
  portId: string;
}

export function createGroupedDropRegionDataset(
  mode: GroupedDropMode
): GroupedDropRegionDataset {
  return {
    'data-drag-mode': resolveGroupedDropInteractionDisplayMode(mode),
  };
}

export function createGroupedPanelTargetDataset<TSide extends string>(
  options: GroupedPanelTargetOptions<TSide>
): GroupedDropPanelTargetDataset {
  return {
    'data-node-dropzone': 'group',
    'data-node-id': options.nodeId,
    'data-group-id': createGroupedPanelDropToken(options.side),
    'data-drop-scope': 'panel',
    'data-drop-side': options.side,
    'data-panel-label': options.panelLabel,
  };
}

export function createGroupedSlotTargetDataset(
  options: GroupedSlotTargetOptions
): GroupedDropSlotTargetDataset {
  return {
    'data-node-dropzone': 'group',
    'data-node-id': options.nodeId,
    'data-group-id': createGroupedSlotDropToken(options.groupId, options.portId),
    'data-drop-scope': 'slot',
    'data-drop-port-id': options.portId,
  };
}

export function isGroupedPanelDropTarget(target: NodeDropTarget | null | undefined): boolean {
  return target?.nodeType === 'group' && typeof target.groupId === 'string' && target.groupId.startsWith('panel|');
}
