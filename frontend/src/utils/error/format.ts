// ==============================================
// 🔒 LOCKED: 错误格式化
// @module utils/error/format
// 最后锁定时间：2026-03-25
// 说明：提供错误消息格式化功能
// 依赖层：types, common-utils
// ==============================================

import type { AppError } from '@/types';
import { safeStringify } from '../common';

/**
 * 获取错误消息
 * @description 格式化错误为简短消息
 * @param error - 应用错误
 * @returns 格式化的错误消息
 * 
 * @example
 * const message = getErrorMessage(error);
 * // "[module-name] operation-name: Error message"
 */
export function getErrorMessage(error: AppError): string {
  return `[${error.module}] ${error.operation}: ${error.message}`;
}

/**
 * 格式化错误用于显示
 * @description 格式化错误为用户友好的显示文本
 * @param error - 应用错误
 * @returns 格式化的显示文本
 * 
 * @example
 * const displayText = formatErrorForDisplay(error);
 * // "Error message\nInput: {...}\nCode: VALIDATION_ERROR"
 */
export function formatErrorForDisplay(error: AppError): string {
  const parts = [error.message];
  
  if (error.context?.input) {
    parts.push(`Input: ${safeStringify(error.context.input)}`);
  }
  
  if (error.code) {
    parts.push(`Code: ${error.code}`);
  }
  
  return parts.join('\n');
}

/**
 * 格式化错误用于日志
 * @description 格式化错误为详细的日志文本
 * @param error - 应用错误
 * @returns 格式化的日志文本
 */
export function formatErrorForLog(error: AppError): string {
  const lines = [
    `[${error.timestamp}] ${error.code}`,
    `Module: ${error.module}`,
    `Operation: ${error.operation}`,
    `Message: ${error.message}`,
  ];

  if (error.stack) {
    lines.push(`Stack: ${error.stack}`);
  }

  if (error.context) {
    lines.push(`Context: ${safeStringify(error.context)}`);
  }

  return lines.join('\n');
}

/**
 * 格式化错误用于API响应
 * @description 格式化错误为API响应格式
 * @param error - 应用错误
 * @returns API响应格式的错误对象
 */
export function formatErrorForAPI(error: AppError): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  return {
    code: error.code,
    message: error.message,
    details: error.context,
  };
}
