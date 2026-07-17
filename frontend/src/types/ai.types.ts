// ==============================================
// 🔒 LOCKED: AI类型定义
// @module types/ai.types
// 最后锁定时间：2026-03-25
// 说明：定义AI任务相关的类型，包括提供商、任务、模型、流式响应、Agent系统等
// 依赖层：base.types, node.types, file.types
// ==============================================

/**
 * AI类型定义
 * @module types/ai.types
 * @description 定义AI任务相关的类型，包括提供商、任务、模型、流式响应、Agent等
 */

import type { TaskStatus, Timestamp, UUID } from './base.types';
import type { AIConfig, AINodeData } from './node.types';
import type { FileInfo } from './file.types';

/**
 * AI提供商
 * @description 支持的AI服务提供商
 */
export type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'stability'
  | 'runway'
  | 'meshy'
  | 'pika'
  | 'tripo'
  | 'laozhang'
  | 'laozhang-veo';

/**
 * AI任务类型
 * @description 支持的AI任务类型
 * - chat: AI对话
 * - image-gen: AI生成图片
 * - video-gen: AI生成视频
 * - model-gen: AI生成3D模型
 * - image-to-ply: AI图片转PLY模型
 * - image-restore: AI图片修复
 */
export type AITaskType =
  | 'image-gen'
  | 'image-inpaint'
  | 'video-gen'
  | 'model-gen'
  | 'image-to-ply'
  | 'multi-view-restore'
  | 'model-render-transfer'
  | 'image-hd'
  | 'floorplan-colorize';

/**
 * AI模型类型
 * @description 支持的AI模型列表
 */
export type AIChatModelType =
  | 'gpt-4'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  | 'claude-3-opus'
  | 'claude-3-sonnet'
  | 'claude-3-haiku';

export type AILaozhangImageModelType =
  | 'gemini-3-pro-image-preview'
  | 'gpt-image-2'
  | 'gpt-image-2-vip'
  | 'gpt-image-2-official';

export type AIImageModelType =
  | 'stable-diffusion-xl'
  | 'stable-diffusion-3'
  | AILaozhangImageModelType
  | 'dall-e-3';

export type AIVideoModelType =
  | 'runway-gen2'
  | 'runway-gen3'
  | 'pika-labs';

export type AI3DModelType =
  | 'meshy-ai'
  | 'tripo';

export type AIModelType =
  | AIChatModelType
  | AIImageModelType
  | AIVideoModelType
  | AI3DModelType;

/**
 * AI任务
 * @description AI任务的完整数据结构
 */
export interface AITask {
  /** 任务唯一标识 */
  id: UUID;
  /** 任务类型 */
  type: AITaskType;
  /** AI提供商 */
  provider: AIProvider;
  /** 使用的模型 */
  model?: AIModelType;
  /** 任务状态 */
  status: TaskStatus;
  /** 关联的节点ID */
  nodeId: string;
  /** 所属项目ID */
  projectId: UUID;
  /** 发起用户ID */
  userId?: UUID;
  /** 任务输入 */
  input: AITaskInput;
  /** 任务输出（完成时） */
  output?: AITaskOutput;
  /** 进度百分比（0-100） */
  progress: number;
  /** 错误信息（失败时） */
  error?: AITaskError;
  /** 时间戳 */
  timestamp: Timestamp;
  /** 开始处理时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 已重试次数 */
  retryCount?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 任务优先级 */
  priority?: 'high' | 'normal' | 'low';
  /** 超时时间（毫秒） */
  timeout?: number;
}

export interface AITaskExecutionContext {
  /** 执行粒度：整个节点或节点分组 */
  scope: 'node' | 'group';
  /** 工作流 ID，用于幂等和审计 */
  workflowId?: UUID;
  /** 工作流版本号，便于后端做并发保护 */
  workflowVersion?: number;
  /** 节点类型，便于后端路由到具体执行器 */
  nodeType?: AINodeData['type'];
  /** 分组执行时的组 ID */
  groupId?: string;
  /** 分组执行时的组标签 */
  groupLabel?: string;
  /** 分组执行时的组顺序 */
  groupOrder?: number;
  /** 该任务输出写回前端时建议使用的 sourceHandle */
  outputHandle?: string;
  /** 请求幂等键，避免重复提交导致重复产物 */
  idempotencyKey?: string;
}

export interface AITaskInputFileBinding {
  /** 文件 ID */
  fileId: UUID;
  /** 来源节点 ID */
  nodeId?: string;
  /** 输入句柄 */
  handle?: string;
  /** 所属分组 ID */
  groupId?: string;
  /** 所属端口 ID */
  portId?: string;
  /** 在同一组内的顺序 */
  order?: number;
  /** 输入角色 */
  role?: 'input' | 'reference';
}

/**
 * AI任务输入
 * @description AI任务的输入数据
 */
export interface AITaskInput {
  /** 输入文件ID列表 */
  files: UUID[];
  /** AI配置参数 */
  config: AIConfig;
  /** 引用文件ID列表 */
  references: UUID[];
  /** 提示词 */
  prompt?: string;
  /** 负向提示词 */
  negativePrompt?: string;
  /** 可选的输入绑定信息，用于后端还原端口、分组和顺序 */
  fileBindings?: AITaskInputFileBinding[];
  /** 可选的执行上下文，用于真实任务回传时映射到节点/分组输出 */
  execution?: AITaskExecutionContext;
}

export interface AITaskOutputItem {
  /** 输出文件 ID */
  fileId: UUID;
  /** 输出文件详情，推荐在 completed 时直接回传，减少额外查表 */
  fileInfo?: FileInfo;
  /** 输出应写回到的 sourceHandle */
  sourceHandle?: string;
  /** 输出所属分组 ID */
  groupId?: string;
  /** 输出顺序 */
  order?: number;
  /** 单个输出项的附加元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * AI任务输出
 * @description AI任务的输出结果
 */
export interface AITaskOutput {
  /** 输出文件ID列表 */
  files: UUID[];
  /** 输出文件详细信息 */
  fileInfos?: FileInfo[];
  /** 有序输出项，真实后端建议优先返回该字段 */
  items?: AITaskOutputItem[];
  /** 输出元数据 */
  metadata: Record<string, unknown>;
  /** Token使用量统计 */
  usage?: AIUsage;
}

/**
 * AI使用量统计
 * @description Token使用量和成本统计
 */
export interface AIUsage {
  /** 提示词Token数 */
  promptTokens: number;
  /** 完成Token数 */
  completionTokens: number;
  /** 总Token数 */
  totalTokens: number;
  /** 成本（美元） */
  cost: number;
}

/**
 * AI任务错误
 * @description AI任务失败时的错误信息
 */
export interface AITaskError {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 错误详情 */
  details?: Record<string, unknown>;
}

/**
 * AI流式响应块
 * @description AI流式输出时的单个响应块
 */
export interface AIStreamChunk {
  /** 关联任务ID */
  taskId: UUID;
  /** 块类型 */
  type: 'text' | 'progress' | 'file' | 'error' | 'done' | 'metadata' | 'status';
  /** 内容（文本/进度/元数据） */
  content: string | number | Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
  /** 序号（用于排序） */
  index?: number;
  /** 关联节点 ID */
  nodeId?: string;
  /** 所属项目 ID */
  projectId?: UUID;
  /** 关联分组 ID */
  groupId?: string;
  /** 回写建议使用的输出句柄 */
  sourceHandle?: string;
  /** 显式状态，优先级高于按 type 推导 */
  status?: TaskStatus;
  /** 显式进度，优先级高于按 content 推导 */
  progress?: number;
  /** 流式阶段直接携带的文件详情 */
  fileInfo?: FileInfo;
  /** 流式阶段直接携带的任务输出快照 */
  output?: AITaskOutput;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * AI提供商配置
 * @description 单个AI提供商的配置信息
 */
export interface AIProviderConfig {
  /** 提供商标识 */
  provider: AIProvider;
  /** 该提供商支持的模型列表 */
  models: AIModelConfig[];
  /** 默认模型 */
  defaultModel: AIModelType;
  /** 速率限制（请求/分钟） */
  rateLimit: number;
  /** 是否启用 */
  enabled: boolean;
  /** 自定义API端点 */
  endpoint?: string;
}

/**
 * AI模型配置
 * @description 单个AI模型的配置信息
 */
export interface AIModelConfig {
  /** 模型标识 */
  model: AIModelType;
  /** 显示名称 */
  displayName: string;
  /** 最大Token数 */
  maxTokens: number;
  /** 是否支持流式输出 */
  supportsStreaming: boolean;
  /** 是否支持图片输入 */
  supportsImages: boolean;
  /** 是否支持视频输入 */
  supportsVideo: boolean;
  /** 每Token成本 */
  costPerToken: number;
}

/**
 * AI工具
 * @description 可在AI节点中使用的工具定义
 */
export interface AITool {
  /** 工具唯一标识 */
  id: string;
  /** 工具名称 */
  name: string;
  /** 任务类型 */
  type: AITaskType;
  /** 工具描述 */
  description: string;
  /** 工具图标 */
  icon: string;
  /** 配置字段模式 */
  configSchema: AIConfigSchema;
  /** 默认配置 */
  defaultConfig: AIConfig;
  /** 工具分类 */
  category: string;
}

/**
 * AI配置模式
 * @description AI工具的配置字段定义
 */
export interface AIConfigSchema {
  /** 配置字段列表 */
  fields: AIConfigField[];
}

/**
 * AI配置字段
 * @description 单个配置字段的定义
 */
export interface AIConfigField {
  /** 字段键名 */
  key: string;
  /** 字段标签 */
  label: string;
  /** 字段类型 */
  type: 'text' | 'number' | 'select' | 'slider' | 'boolean';
  /** 是否必填 */
  required: boolean;
  /** 默认值 */
  defaultValue: unknown;
  /** 选项列表（select类型） */
  options?: Array<{ label: string; value: string | number }>;
  /** 最小值（number/slider类型） */
  min?: number;
  /** 最大值（number/slider类型） */
  max?: number;
  /** 步长（number/slider类型） */
  step?: number;
  /** 字段描述 */
  description?: string;
}

/**
 * AI工具注册表项
 * @description 工具注册信息，包含处理函数
 */
export interface AIToolRegistryEntry {
  /** 工具定义 */
  tool: AITool;
  /** 任务处理函数 */
  handler: (task: AITask) => Promise<void>;
}

/**
 * AI Agent
 * @description 可自定义的AI智能体
 */
export interface AIAgent {
  /** Agent唯一标识 */
  id: UUID;
  /** Agent名称 */
  name: string;
  /** Agent类型 */
  type: 'assistant' | 'custom';
  /** Agent描述 */
  description: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 可用工具列表 */
  tools: string[];
  /** 使用的模型 */
  model: AIModelType;
  /** 温度参数 */
  temperature: number;
  /** 最大Token数 */
  maxTokens: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * AI Agent 会话
 * @description Agent的对话会话
 */
export interface AIAgentSession {
  /** 会话唯一标识 */
  id: UUID;
  /** Agent ID */
  agentId: UUID;
  /** 关联节点ID */
  nodeId: string;
  /** 消息列表 */
  messages: AIMessage[];
  /** 会话上下文 */
  context: Record<string, unknown>;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * AI消息
 * @description 对话中的单条消息
 */
export interface AIMessage {
  /** 消息唯一标识 */
  id: UUID;
  /** 角色：用户、助手或系统 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 关联文件ID列表 */
  files?: UUID[];
  /** 时间戳 */
  timestamp: number;
  /** 消息元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * AI任务队列
 * @description 任务队列的状态快照
 */
export interface AITaskQueue {
  /** 等待中的任务 */
  pending: AITask[];
  /** 处理中的任务 */
  processing: AITask[];
  /** 已完成的任务 */
  completed: AITask[];
  /** 失败的任务 */
  failed: AITask[];
}

/**
 * AI任务进度
 * @description 任务进度的详细信息
 */
export interface AITaskProgress {
  /** 任务ID */
  taskId: UUID;
  /** 任务状态 */
  status: TaskStatus;
  /** 进度百分比 */
  progress: number;
  /** 进度消息 */
  message?: string;
  /** 当前步骤名称 */
  currentStep?: string;
  /** 总步骤数 */
  totalSteps?: number;
  /** 当前步骤索引 */
  currentStepIndex?: number;
  /** 分组执行时的组 ID */
  groupId?: string;
}

/**
 * AI提供商状态
 * @description 提供商的实时状态信息
 */
export interface AIProviderStatus {
  /** 提供商标识 */
  provider: AIProvider;
  /** 是否可用 */
  available: boolean;
  /** 响应延迟（毫秒） */
  latency: number;
  /** 当前负载 */
  currentLoad: number;
  /** 最大负载 */
  maxLoad: number;
  /** 上次检查时间 */
  lastChecked: number;
}
