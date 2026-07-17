// ==============================================
// 🔒 LOCKED: AI流式响应 Hook
// @module hooks/ai/useAIStream
// 最后锁定时间：2026-03-25
// 说明：提供AI流式响应的处理、缓冲、解析等功能
// 依赖层：types (import type), constants, utils
// ==============================================

import { useCallback, useMemo, useRef, useState } from 'react';
import type { AIStreamChunk, UUID } from '@/types';
import { createModuleLogger } from '@/utils';

/** 模块日志器 */
const log = createModuleLogger('useAIStream');

/** 默认缓冲区大小 */
const DEFAULT_BUFFER_SIZE = 100;

/**
 * AI流式响应 Hook 配置选项
 * @description 配置流式响应行为和回调
 */
export interface UseAIStreamOptions {
  /** 缓冲区大小 */
  bufferSize?: number;
  /** 接收到块回调 */
  onChunk?: (chunk: AIStreamChunk) => void;
  /** 完成回调 */
  onComplete?: (fullContent: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

/**
 * 流状态
 * @description 流式响应的当前状态
 */
export interface StreamState {
  /** 任务ID */
  taskId: UUID | null;
  /** 是否活跃 */
  isActive: boolean;
  /** 已接收内容 */
  content: string;
  /** 已接收块列表 */
  chunks: AIStreamChunk[];
  /** 错误信息 */
  error: string | null;
}

/**
 * AI流式响应 Hook 返回值
 * @description 提供流状态和操作方法
 */
export interface UseAIStreamReturn {
  /** 流状态 */
  state: StreamState;
  /** 是否活跃 */
  isActive: boolean;
  /** 已接收内容 */
  content: string;
  /** 已接收块列表 */
  chunks: AIStreamChunk[];
  /** 错误信息 */
  error: string | null;
  /** 开始流 */
  startStream: (taskId: UUID) => void;
  /** 追加块 */
  appendChunk: (chunk: AIStreamChunk) => void;
  /** 追加内容 */
  appendContent: (content: string, taskId: UUID) => void;
  /** 完成流 */
  completeStream: () => void;
  /** 流失败 */
  failStream: (error: string) => void;
  /** 重置流 */
  resetStream: () => void;
  /** 获取完整内容 */
  getFullContent: () => string;
  /** 获取块数量 */
  getChunkCount: () => number;
}

/**
 * AI流式响应 Hook
 * @description 提供AI流式响应的处理、缓冲、解析等功能
 * @param options - Hook 配置选项
 * @returns 流状态和操作方法
 */
export function useAIStream(options: UseAIStreamOptions = {}): UseAIStreamReturn {
  // 解构配置选项
  const { 
    bufferSize = DEFAULT_BUFFER_SIZE,
    onChunk,
    onComplete,
    onError,
  } = options;

  /** 流状态 */
  const [state, setState] = useState<StreamState>({
    taskId: null,
    isActive: false,
    content: '',
    chunks: [],
    error: null,
  });

  /** 内容引用（用于同步访问） */
  const contentRef = useRef<string>('');

  /**
   * 开始流
   * @description 初始化新的流式响应
   * @param taskId - 任务ID
   */
  const startStream = useCallback((taskId: UUID) => {
    contentRef.current = '';
    setState({
      taskId,
      isActive: true,
      content: '',
      chunks: [],
      error: null,
    });
    log.debug('startStream', `Started stream for task: ${taskId}`);
  }, []);

  /**
   * 追加块
   * @description 向流中追加新的数据块
   * @param chunk - 数据块
   */
  const appendChunk = useCallback((chunk: AIStreamChunk) => {
    // 检查流是否活跃
    if (!state.isActive) {
      log.warn('appendChunk', 'Stream not active');
      return;
    }

    setState(prev => {
      /** 新块列表（限制缓冲区大小） */
      const newChunks = [...prev.chunks, chunk].slice(-bufferSize);
      /** 文本内容 */
      const textContent = typeof chunk.content === 'string' ? chunk.content : '';
      /** 累积内容 */
      const newContent = prev.content + textContent;
      contentRef.current = newContent;
      
      return {
        ...prev,
        chunks: newChunks,
        content: newContent,
      };
    });

    onChunk?.(chunk);
  }, [state.isActive, bufferSize, onChunk]);

  /**
   * 追加内容
   * @description 向流中追加文本内容
   * @param content - 文本内容
   * @param taskId - 任务ID
   */
  const appendContent = useCallback((content: string, taskId: UUID) => {
    // 检查流是否活跃
    if (!state.isActive) return;

    /** 创建数据块 */
    const chunk: AIStreamChunk = {
      taskId,
      type: 'text',
      content,
      timestamp: Date.now(),
    };

    appendChunk(chunk);
  }, [state.isActive, appendChunk]);

  /**
   * 完成流
   * @description 标记流为已完成
   */
  const completeStream = useCallback(() => {
    setState(prev => ({
      ...prev,
      isActive: false,
    }));
    
    onComplete?.(contentRef.current);
    log.debug('completeStream', `Stream completed for task: ${state.taskId}`);
  }, [state.taskId, onComplete]);

  /**
   * 流失败
   * @description 标记流为失败
   * @param error - 错误信息
   */
  const failStream = useCallback((error: string) => {
    setState(prev => ({
      ...prev,
      isActive: false,
      error,
    }));
    
    onError?.(error);
    log.error('failStream', `Stream failed for task: ${state.taskId}`, undefined, { error });
  }, [state.taskId, onError]);

  /**
   * 重置流
   * @description 重置流状态
   */
  const resetStream = useCallback(() => {
    contentRef.current = '';
    setState({
      taskId: null,
      isActive: false,
      content: '',
      chunks: [],
      error: null,
    });
    log.debug('resetStream', 'Stream reset');
  }, []);

  /**
   * 获取完整内容
   * @description 获取流的完整内容
   * @returns 完整内容字符串
   */
  const getFullContent = useCallback((): string => {
    return contentRef.current;
  }, []);

  /**
   * 获取块数量
   * @description 获取已接收的块数量
   * @returns 块数量
   */
  const getChunkCount = useCallback((): number => {
    return state.chunks.length;
  }, [state.chunks.length]);

  // 返回所有状态和方法
  return useMemo(() => ({
    state,
    isActive: state.isActive,
    content: state.content,
    chunks: state.chunks,
    error: state.error,
    startStream,
    appendChunk,
    appendContent,
    completeStream,
    failStream,
    resetStream,
    getFullContent,
    getChunkCount,
  }), [
    state,
    startStream,
    appendChunk,
    appendContent,
    completeStream,
    failStream,
    resetStream,
    getFullContent,
    getChunkCount,
  ]);
}
