export type GroupedDropMode = 'normal' | 'ctrl' | 'shift' | 'invalid';

export type GroupedDropInteractionDisplayMode = 'normal' | 'batch' | 'invalid';

export type GroupedDropIntent = 'slot' | 'existing-capacity' | 'expand-capacity' | 'invalid';

export type GroupedDropPanelSide = 'left' | 'right';

export interface GroupedDropSlotTarget {
  kind: 'slot';
  groupId: string;
  portId: string;
}

export interface GroupedDropPanelTarget<TSide extends string = GroupedDropPanelSide> {
  kind: 'panel';
  side: TSide;
}

export type GroupedDropTarget<TSide extends string = GroupedDropPanelSide> =
  | GroupedDropSlotTarget
  | GroupedDropPanelTarget<TSide>;

export interface GroupedDropSidePortBinding<TSide extends string = GroupedDropPanelSide> {
  side: TSide;
  portId: string;
}

export type GroupedDropSidePortMap<TSide extends string = GroupedDropPanelSide> =
  Readonly<Partial<Record<TSide, string>>>;

export interface GroupedDropModeSemantics {
  mode: GroupedDropMode;
  displayMode: GroupedDropInteractionDisplayMode;
  intent: GroupedDropIntent;
  requiresPanelTarget: boolean;
  allowsExpansion: boolean;
}

export function resolveGroupedDropInteractionDisplayMode(
  mode: GroupedDropMode
): GroupedDropInteractionDisplayMode {
  if (mode === 'invalid') {
    return 'invalid';
  }

  if (mode === 'ctrl' || mode === 'shift') {
    return 'batch';
  }

  return 'normal';
}

export function getGroupedDropModeSemantics(mode: GroupedDropMode): GroupedDropModeSemantics {
  if (mode === 'invalid') {
    return {
      mode,
      displayMode: 'invalid',
      intent: 'invalid',
      requiresPanelTarget: false,
      allowsExpansion: false,
    };
  }

  if (mode === 'ctrl') {
    return {
      mode,
      displayMode: 'batch',
      intent: 'existing-capacity',
      requiresPanelTarget: true,
      allowsExpansion: false,
    };
  }

  if (mode === 'shift') {
    return {
      mode,
      displayMode: 'batch',
      intent: 'expand-capacity',
      requiresPanelTarget: true,
      allowsExpansion: true,
    };
  }

  return {
    mode,
    displayMode: 'normal',
    intent: 'slot',
    requiresPanelTarget: false,
    allowsExpansion: false,
  };
}

export function isGroupedDropBatchMode(mode: GroupedDropMode): boolean {
  return getGroupedDropModeSemantics(mode).displayMode === 'batch';
}
