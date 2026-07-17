import type { CanvasTraceData, CanvasTraceDataValue } from './schema';

const SENSITIVE_KEY_PATTERN = /(fileName|filename|url|src|path|token|authorization|cookie|raw|dataUrl)/i;

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function sanitizeValue(key: string, value: CanvasTraceDataValue): CanvasTraceDataValue {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === 'string') {
    if (key === 'nodeId' || key.endsWith('NodeId') || key === 'batchId' || key.endsWith('Id')) {
      return hashString(value);
    }

    if (SENSITIVE_KEY_PATTERN.test(key)) {
      return value.length > 0 ? '[redacted]' : value;
    }
  }

  return value;
}

export function sanitizeCanvasTraceData(data: CanvasTraceData | undefined): CanvasTraceData | undefined {
  if (!data) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, sanitizeValue(key, value)]),
  );
}
