// ==============================================
// 🔒 LOCKED: 基础类型定义
// @module types/base.types
// 最后锁定时间：2026-03-25
// 说明：定义项目中所有基础类型，包括通用返回类型、错误结构、枚举类型和几何类型
// 依赖层：reactflow (外部库)
// ==============================================

/**
 * 基础类型定义
 * @module types/base.types
 * @description 定义项目中所有基础类型，包括通用返回类型、错误结构、枚举类型和几何类型
 */

import type { Node, Edge, Viewport as RFViewport } from 'reactflow';

/**
 * 统一返回类型
 * @template T - 成功时返回的数据类型
 * @template E - 失败时返回的错误类型，默认为 AppError
 * @description 用于统一处理函数返回值，支持成功和失败两种状态
 */
export type Result<T, E = AppError> = 
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: E };

/**
 * 应用错误结构
 * @description 标准化的错误信息结构，包含错误码、消息、模块、操作等信息
 */
export interface AppError {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 发生错误的模块名 */
  module: string;
  /** 发生错误的操作名 */
  operation: string;
  /** 错误发生时间戳 */
  timestamp: number;
  /** 错误堆栈信息 */
  stack?: string;
  /** 错误上下文数据 */
  context?: Record<string, unknown>;
}

/** UUID 类型别名 */
export type UUID = string;

/** 节点ID字符串类型别名 */
export type NodeIdString = string;

/** 文件ID字符串类型别名 */
export type FileIdString = string;

/** 任务ID字符串类型别名 */
export type TaskIdString = string;

/**
 * 节点类型枚举
 * @description 定义所有支持的节点类型
 * - image: 图片节点，用于展示图片文件
 * - video: 视频节点，用于展示视频文件
 * - ply: PLY模型节点，用于展示3D模型文件
 * - aiChat: AI对话节点，用于AI文本对话
 * - aiImageGen: AI生图节点，用于AI生成图片
 * - aiVideoGen: AI生视频节点，用于AI生成视频
 * - aiImageToPly: AI图转模型节点，用于图片生成3D模型
 * - aiStoryboard: AI分镜表节点，用于分镜整理和镜头工作台
 * - aiImageRestore: AI图修复节点，用于图片修复/融合
 * - group: 组图框节点，用于组合多个节点
 */
export type NodeType = 
  | 'image'
  | 'video'
  | 'ply'
  | 'aiImageGen'
  | 'aiImageInpaint'
  | 'aiVideoGen'
  | 'aiImageToPly'
  | 'aiStoryboard'
  | 'aiMultiViewRestore'
  | 'aiModelRenderTransfer'
  | 'aiImageHd'
  | 'aiFloorplanColorize';

/**
 * 节点状态枚举
 * @description 节点的运行状态
 * - idle: 空闲状态
 * - pending: 等待处理
 * - processing: 处理中
 * - completed: 已完成
 * - error: 错误状态
 */
export type NodeStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'error';

/**
 * 文件状态枚举
 * @description 文件的处理状态
 * - uploading: 上传中
 * - processing: 处理中
 * - ready: 就绪可用
 * - error: 错误状态
 */
export type FileStatus = 'uploading' | 'processing' | 'ready' | 'error';

/**
 * 任务状态枚举
 * @description AI任务的处理状态
 * - queued: 排队等待中
 * - processing: 处理中
 * - completed: 已完成
 * - failed: 失败
 * - cancelled: 已取消
 */
export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * 连接类型枚举
 * @description 节点间连接的类型
 * - file-reference: 文件引用连接
 * - output-link: 输出链接连接
 */
export type ConnectionType = 'file-reference' | 'output-link';

/**
 * 账户角色枚举
 * @description MVP 账户系统角色
 * - admin: 系统管理员
 * - member: 普通成员
 */
export type AccountRole = 'admin' | 'member';

export type AccountStatus = 'enabled' | 'disabled';

/** 兼容旧命名，逐步迁移到 AccountRole。 */
export type UserRole = AccountRole;

/**
 * 项目角色枚举
 * @description 项目级用户角色
 * - owner: 项目所有者
 * - editor: 编辑者
 * - viewer: 查看者
 */
export type ProjectRole = 'owner' | 'editor' | 'viewer';

/**
 * 坐标位置
 * @description 二维坐标系中的点
 */
export interface Position {
  /** X坐标 */
  x: number;
  /** Y坐标 */
  y: number;
}

/**
 * 尺寸
 * @description 宽度和高度
 */
export interface Dimensions {
  /** 宽度（像素） */
  width: number;
  /** 高度（像素） */
  height: number;
}

export interface ImageSourceInfo extends Dimensions {
  fileId: string;
}

/**
 * 边界框
 * @description 包含位置和尺寸的矩形区域
 */
export interface BoundingBox extends Position, Dimensions {}

/**
 * 节点ID结构
 * @description 节点的唯一标识，包含实际值和显示格式
 */
export interface NodeId {
  /** 实际ID值，如 "1" */
  value: string;
  /** 显示格式，如 "#00001" */
  display: string;
}

/**
 * 时间戳结构
 * @description 记录创建和更新时间
 */
export interface Timestamp {
  /** 创建时间戳（毫秒） */
  created: number;
  /** 更新时间戳（毫秒） */
  updated: number;
}

/**
 * 画布配置
 * @description 定义画布的基本参数
 */
export interface CanvasConfig {
  /** 画布宽度（像素），默认 20000 */
  width: number;
  /** 画布高度（像素），默认 20000 */
  height: number;
  /** 最小缩放比例，默认 0.05 (5%) */
  minZoom: number;
  /** 最大缩放比例，默认 5 (500%) */
  maxZoom: number;
  /** 简化阈值 */
  simplifyThreshold: number;
}

/**
 * 选择框坐标
 * @description 框选操作的选择区域
 */
export interface SelectionBox {
  /** 起始X坐标 */
  startX: number;
  /** 起始Y坐标 */
  startY: number;
  /** 结束X坐标 */
  endX: number;
  /** 结束Y坐标 */
  endY: number;
}

/**
 * ReactFlow 节点类型别名
 * @description 泛型节点类型，默认类型为 unknown
 */
export type RFNode<T = unknown> = Node<T>;

/**
 * ReactFlow 边类型别名
 */
export type RFEdge = Edge;

/**
 * ReactFlow 视口类型别名
 */
export type RFViewportType = RFViewport;
