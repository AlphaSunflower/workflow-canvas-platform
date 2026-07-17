import type { AutoSaveConfig, ConnectionStyle } from '@/types/workflow.types';

export const AUTO_SAVE_DEFAULTS: AutoSaveConfig = {
  enabled: true,
  idleSaveEnabled: true,
  fallbackIntervalMs: 10 * 60 * 1000,
  debounceMs: 1000,
  interval: 10 * 60 * 1000,
} as const;

export const CONNECTION_STYLE_DEFAULTS: ConnectionStyle = {
  type: 'bezier',
  animated: false,
  color: '#94a3b8',
  strokeWidth: 2,
} as const;
