// ==============================================
// 🔒 LOCKED: 错误类型定义
// @module types/error.types
// 最后锁定时间：2026-03-25
// 说明：定义错误相关的类型，包括错误码、错误信息、错误上下文、错误分类等
// 依赖层：无
// ==============================================

/**
 * 错误类型定义
 * @module types/error.types
 * @description 定义错误相关的类型，包括错误码、错误信息、错误上下文、错误分类等
 */

/**
 * 错误码枚举
 * @description 定义所有可能的错误码
 * - UNKNOWN_ERROR: 未知错误
 * - NETWORK_ERROR: 网络错误
 * - TIMEOUT_ERROR: 超时错误
 * - VALIDATION_ERROR: 验证错误
 * - AUTH_ERROR: 认证错误
 * - TOKEN_EXPIRED: Token过期
 * - TOKEN_INVALID: Token无效
 * - PERMISSION_ERROR: 权限错误
 * - NOT_FOUND_ERROR: 资源未找到
 * - CONFLICT_ERROR: 冲突错误
 * - RATE_LIMIT_ERROR: 速率限制
 * - FILE_TYPE_ERROR: 文件类型错误
 * - FILE_SIZE_ERROR: 文件大小错误
 * - FILE_CORRUPTED: 文件损坏
 * - UPLOAD_ERROR: 上传错误
 * - DOWNLOAD_ERROR: 下载错误
 * - NODE_ERROR: 节点错误
 * - NODE_NOT_FOUND: 节点未找到
 * - NODE_LOCKED: 节点已锁定
 * - WORKFLOW_ERROR: 工作流错误
 * - WORKFLOW_NOT_FOUND: 工作流未找到
 * - WORKFLOW_VERSION_CONFLICT: 工作流版本冲突
 * - AI_TASK_ERROR: AI任务错误
 * - AI_TASK_TIMEOUT: AI任务超时
 * - AI_TASK_CANCELLED: AI任务已取消
 * - AI_PROVIDER_ERROR: AI提供商错误
 * - AI_RATE_LIMIT: AI速率限制
 * - RENDER_ERROR: 渲染错误
 * - WEBSOCKET_ERROR: WebSocket错误
 * - WEBSOCKET_DISCONNECTED: WebSocket断开
 * - STORAGE_ERROR: 存储错误
 * - STORAGE_QUOTA_EXCEEDED: 存储配额超限
 */
export type ErrorCode = 
  | 'UNKNOWN_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'VALIDATION_ERROR'
  | 'AUTH_ERROR'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'PERMISSION_ERROR'
  | 'NOT_FOUND_ERROR'
  | 'CONFLICT_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'FILE_TYPE_ERROR'
  | 'FILE_SIZE_ERROR'
  | 'FILE_REGISTER_FAILED'
  | 'FILE_CORRUPTED'
  | 'UPLOAD_ERROR'
  | 'DOWNLOAD_ERROR'
  | 'NODE_ERROR'
  | 'NODE_NOT_FOUND'
  | 'NODE_LOCKED'
  | 'WORKFLOW_ERROR'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_VERSION_CONFLICT'
  | 'AI_TASK_ERROR'
  | 'AI_TASK_TIMEOUT'
  | 'AI_TASK_CANCELLED'
  | 'AI_PROVIDER_ERROR'
  | 'AI_RATE_LIMIT'
  | 'RENDER_ERROR'
  | 'WEBSOCKET_ERROR'
  | 'WEBSOCKET_DISCONNECTED'
  | 'STORAGE_ERROR'
  | 'STORAGE_QUOTA_EXCEEDED';

/**
 * 错误严重程度
 * @description 定义错误的严重级别
 * - low: 低严重性，不影响主要功能
 * - medium: 中等严重性，影响部分功能
 * - high: 高严重性，影响核心功能
 * - critical: 严重错误，系统无法正常运行
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * 错误分类
 * @description 定义错误的分类，便于错误处理和统计
 * - network: 网络相关错误
 * - validation: 数据验证错误
 * - auth: 认证授权错误
 * - permission: 权限相关错误
 * - resource: 资源相关错误
 * - file: 文件相关错误
 * - workflow: 工作流相关错误
 * - ai: AI任务相关错误
 * - system: 系统级错误
 */
export type ErrorCategory = 
  | 'network' 
  | 'validation' 
  | 'auth' 
  | 'permission' 
  | 'resource' 
  | 'file' 
  | 'workflow' 
  | 'ai' 
  | 'system';

/**
 * 错误上下文
 * @description 记录错误发生时的上下文信息，用于调试和错误追踪
 */
export interface ErrorContext {
  /** 发生错误的模块名 */
  module: string;
  /** 发生错误的操作名 */
  operation: string;
  /** 错误发生时间戳 */
  timestamp: number;
  /** 错误输入数据（可选） */
  input?: unknown;
  /** 错误堆栈信息（可选） */
  stack?: string;
  /** 原始错误对象（可选） */
  cause?: Error;
  /** 额外的上下文数据（可选） */
  context?: Record<string, unknown>;
}

/**
 * 错误信息
 * @description 完整的错误信息结构，包含错误码、消息、严重程度、分类等
 */
export interface ErrorInfo {
  /** 错误码 */
  code: ErrorCode;
  /** 技术错误消息 */
  message: string;
  /** 错误严重程度 */
  severity: ErrorSeverity;
  /** 错误分类 */
  category: ErrorCategory;
  /** 是否可恢复 */
  recoverable: boolean;
  /** 是否可重试 */
  retryable: boolean;
  /** 用户友好的错误消息 */
  userMessage: string;
  /** 相关文档链接（可选） */
  documentation?: string;
}
