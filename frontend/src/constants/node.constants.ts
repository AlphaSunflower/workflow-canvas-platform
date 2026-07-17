import type { NodeTypeInfo, RepulsionConfig } from '@/types/node.types';
import type { NodeType } from '@/types/base.types';

export const NODE_TYPE_INFO: Record<NodeType, NodeTypeInfo> = {
  image: { type: 'image', displayName: '图片', icon: 'IMG', color: '#3b82f6', category: 'file' },
  video: { type: 'video', displayName: '视频', icon: 'VID', color: '#8b5cf6', category: 'file' },
  ply: { type: 'ply', displayName: 'PLY 模型', icon: 'PLY', color: '#10b981', category: 'file' },
  aiImageGen: { type: 'aiImageGen', displayName: 'AI 生图', icon: 'IMG+', color: '#ec4899', category: 'ai' },
  aiImageInpaint: { type: 'aiImageInpaint', displayName: '图片局部重绘', icon: 'INP', color: '#ef4444', category: 'ai' },
  aiVideoGen: { type: 'aiVideoGen', displayName: 'AI 生成视频', icon: 'VID+', color: '#06b6d4', category: 'ai' },
  aiImageToPly: { type: 'aiImageToPly', displayName: 'AI 图转模型', icon: '3D', color: '#14b8a6', category: 'ai' },
  aiStoryboard: { type: 'aiStoryboard', displayName: 'AI 分镜表', icon: 'STB', color: '#f59e0b', category: 'ai' },
  aiMultiViewRestore: { type: 'aiMultiViewRestore', displayName: '多视角修复', icon: 'MVR', color: '#7c3aed', category: 'ai' },
  aiModelRenderTransfer: { type: 'aiModelRenderTransfer', displayName: '白模图迁移渲染', icon: 'WMR', color: '#f59e0b', category: 'ai' },
  aiImageHd: { type: 'aiImageHd', displayName: '图片高清化', icon: 'HD', color: '#0ea5e9', category: 'ai' },
  aiFloorplanColorize: { type: 'aiFloorplanColorize', displayName: '平面图转彩平', icon: 'CLR', color: '#f97316', category: 'ai' },
} as const;

export const REPULSION_DEFAULTS: RepulsionConfig = {
  enabled: true,
  minDistance: 5,
  animationDuration: 200,
} as const;

export const CONNECTION_DEFAULTS = {
  type: 'smoothstep',
  animated: true,
  style: {
    stroke: '#3b82f6',
    strokeWidth: 2,
  },
} as const;

export const NODE_DEFAULTS = {
  width: 140,
  height: 160,
  minWidth: 100,
  minHeight: 100,
} as const;
