import type { AIConfig } from '@/types';

export const MULTI_VIEW_RESTORE_MIN_GROUPS = 1;
export const MULTI_VIEW_RESTORE_MAX_GROUPS = 10;

export const MULTI_VIEW_RESTORE_RENDER_PORT_ID = 'render';
export const MULTI_VIEW_RESTORE_REFERENCE_PORT_ID = 'reference';
export const MULTI_VIEW_RESTORE_RESULT_PORT_ID = 'result';

export const MULTI_VIEW_RESTORE_DISPLAY_NAME = '多视角修复';
export const MULTI_VIEW_RESTORE_ICON = 'MVR';
export const MULTI_VIEW_RESTORE_COLOR = '#7c3aed';
export const MULTI_VIEW_RESTORE_DESCRIPTION = '最多 10 组，每组 1 张渲染图 + 1 张原视角参考图，运行后每组产出 1 张图。';

export const MULTI_VIEW_RESTORE_DEFAULT_SIZE = {
  width: 320,
  height: 296,
} as const;

export const MULTI_VIEW_RESTORE_MIN_WIDTH = 320;
export const MULTI_VIEW_RESTORE_MIN_HEIGHT = 296;

export const MULTI_VIEW_RESTORE_DEFAULT_CONFIG: AIConfig = {
  denoise: 0.35,
  steps: 20,
};
