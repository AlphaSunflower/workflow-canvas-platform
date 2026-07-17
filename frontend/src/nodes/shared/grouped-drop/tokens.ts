import type {
  GroupedDropPanelSide,
  GroupedDropTarget,
} from './types';

const GROUPED_DROP_TOKEN_SEPARATOR = '|';
const GROUPED_DROP_SLOT_SCOPE = 'slot';
const GROUPED_DROP_PANEL_SCOPE = 'panel';

export function createGroupedSlotDropToken(groupId: string, portId: string): string {
  return [
    GROUPED_DROP_SLOT_SCOPE,
    groupId,
    portId,
  ].join(GROUPED_DROP_TOKEN_SEPARATOR);
}

export function createGroupedPanelDropToken<TSide extends string = GroupedDropPanelSide>(side: TSide): string {
  return [
    GROUPED_DROP_PANEL_SCOPE,
    side,
  ].join(GROUPED_DROP_TOKEN_SEPARATOR);
}

export function parseGroupedDropToken<TSide extends string = GroupedDropPanelSide>(
  token: string | undefined
): GroupedDropTarget<TSide> | null {
  if (!token) {
    return null;
  }

  const [scope, value, portId] = token.split(GROUPED_DROP_TOKEN_SEPARATOR);

  if (scope === GROUPED_DROP_SLOT_SCOPE && value && portId) {
    return {
      kind: 'slot',
      groupId: value,
      portId,
    };
  }

  if (scope === GROUPED_DROP_PANEL_SCOPE && value) {
    return {
      kind: 'panel',
      side: value as TSide,
    };
  }

  return null;
}

export function isGroupedPanelDropToken(token: string | undefined): boolean {
  return parseGroupedDropToken(token)?.kind === 'panel';
}

export function isGroupedSlotDropToken(token: string | undefined): boolean {
  return parseGroupedDropToken(token)?.kind === 'slot';
}
