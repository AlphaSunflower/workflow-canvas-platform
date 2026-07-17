export interface ParsedGroupHandle {
  groupId: string;
  portId: string;
}

export function createGroupPortHandle(groupId: string, portId: string): string {
  return `${groupId}:${portId}`;
}

export function parseGroupPortHandle(handle?: string | null): ParsedGroupHandle | null {
  if (typeof handle !== 'string' || handle.length === 0) {
    return null;
  }

  const separatorIndex = handle.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= handle.length - 1) {
    return null;
  }

  return {
    groupId: handle.slice(0, separatorIndex),
    portId: handle.slice(separatorIndex + 1),
  };
}
