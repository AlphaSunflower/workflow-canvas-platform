import type { CanvasConfig } from '@/types/base.types';

export const CANVAS_DEFAULTS: CanvasConfig = {
  width: 20000,
  height: 20000,
  minZoom: 0.05,
  maxZoom: 5,
  simplifyThreshold: 0.3,
} as const;
