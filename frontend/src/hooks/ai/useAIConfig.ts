// ==============================================
// 🔒 LOCKED: AI配置管理 Hook
// @module hooks/ai/useAIConfig
// 最后锁定时间：2026-03-25
// 说明：提供AI服务配置、模型选择等功能
// 依赖层：types (import type), constants, utils
// ==============================================

import { useCallback, useMemo, useState } from 'react';
import type { 
  AIProvider, 
  AIModelType,} from '@/types';
import type { ValidationResult } from '@/utils';
import { 
  createModuleLogger,
  validateAIConfig,
  getModelsForProvider,
} from '@/utils';
import { AI_PROVIDER_MODELS } from '@/constants';

/** 模块日志器 */
const log = createModuleLogger('useAIConfig');

/** 默认提供商 */
const DEFAULT_PROVIDER: AIProvider = 'openai';
/** 默认模型 */
const DEFAULT_MODEL: AIModelType = 'gpt-4';

/**
 * AI配置管理 Hook 配置选项
 * @description 配置AI服务行为和回调
 */
export interface UseAIConfigOptions {
  /** 初始提供商 */
  initialProvider?: AIProvider;
  /** 初始模型 */
  initialModel?: AIModelType;
  /** 提供商变更回调 */
  onProviderChange?: (provider: AIProvider) => void;
  /** 模型变更回调 */
  onModelChange?: (model: AIModelType) => void;
}

/**
 * AI配置管理 Hook 返回值
 * @description 提供配置状态和操作方法
 */
export interface UseAIConfigReturn {
  /** 当前提供商 */
  provider: AIProvider;
  /** 当前模型 */
  model: AIModelType;
  /** 可用模型列表 */
  availableModels: AIModelType[];
  /** 提供商列表 */
  providers: AIProvider[];
  /** 设置提供商 */
  setProvider: (provider: AIProvider) => void;
  /** 设置模型 */
  setModel: (model: AIModelType) => void;
  /** 验证配置 */
  validateConfig: (config: Record<string, unknown>) => ValidationResult;
  /** 是否已配置 */
  isConfigured: boolean;
  /** 获取提供商的模型列表 */
  getModelsForProvider: (provider: AIProvider) => AIModelType[];
  /** 重置配置 */
  reset: () => void;
}

/**
 * AI配置管理 Hook
 * @description 提供AI服务配置、模型选择等功能
 * @param options - Hook 配置选项
 * @returns 配置状态和操作方法
 */
export function useAIConfig(options: UseAIConfigOptions = {}): UseAIConfigReturn {
  // 解构配置选项
  const {
    initialProvider = DEFAULT_PROVIDER,
    initialModel = DEFAULT_MODEL,
    onProviderChange,
    onModelChange,
  } = options;

  /** 当前提供商 */
  const [provider, setProviderState] = useState<AIProvider>(initialProvider);
  /** 当前模型 */
  const [model, setModelState] = useState<AIModelType>(initialModel);

  /** 提供商列表 */
  const providers = useMemo(() => {
    return Object.keys(AI_PROVIDER_MODELS).filter(
      (key): key is AIProvider => AI_PROVIDER_MODELS[key as AIProvider] !== undefined
    );
  }, []);

  /** 当前提供商的可用模型 */
  const availableModels = useMemo(() => {
    return getModelsForProvider(provider);
  }, [provider]);

  /**
   * 设置提供商
   * @description 切换AI提供商
   * @param newProvider - 新提供商
   */
  const setProvider = useCallback((newProvider: AIProvider) => {
    setProviderState(newProvider);
    
    // 获取新提供商的模型列表
    const models = getModelsForProvider(newProvider);
    if (models.length > 0) {
      // 检查当前模型是否在新提供商的模型列表中
      const modelExists = models.includes(model);
      if (!modelExists) {
        // 如果不存在，切换到默认模型
        const defaultModel = models[0];
        setModelState(defaultModel);
        onModelChange?.(defaultModel);
      }
    }
    
    onProviderChange?.(newProvider);
    log.debug('setProvider', `Provider set to: ${newProvider}`);
  }, [model, onProviderChange, onModelChange]);

  /**
   * 设置模型
   * @description 切换AI模型
   * @param newModel - 新模型
   */
  const setModel = useCallback((newModel: AIModelType) => {
    setModelState(newModel);
    onModelChange?.(newModel);
    log.debug('setModel', `Model set to: ${newModel}`);
  }, [onModelChange]);

  /**
   * 验证配置
   * @description 验证AI配置是否有效
   * @param config - 配置对象
   * @returns 验证结果
   */
  const validateConfigResult = useCallback((config: Record<string, unknown>): ValidationResult => {
    return validateAIConfig(config);
  }, []);

  /**
   * 重置配置
   * @description 重置为默认配置
   */
  const reset = useCallback(() => {
    setProviderState(DEFAULT_PROVIDER);
    setModelState(DEFAULT_MODEL);
    log.debug('reset', 'AI config reset');
  }, []);

  /** 是否已正确配置 */
  const isConfigured = useMemo(() => {
    return availableModels.length > 0 && availableModels.includes(model);
  }, [availableModels, model]);

  // 返回所有状态和方法
  return useMemo(() => ({
    provider,
    model,
    availableModels,
    providers,
    setProvider,
    setModel,
    validateConfig: validateConfigResult,
    isConfigured,
    getModelsForProvider,
    reset,
  }), [
    provider,
    model,
    availableModels,
    providers,
    setProvider,
    setModel,
    validateConfigResult,
    isConfigured,
    reset,
  ]);
}
