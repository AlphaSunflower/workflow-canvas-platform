// ==============================================
// 🔒 LOCKED: 错误处理统一导出
// @module utils/error
// 最后锁定时间：2026-03-25
// 说明：聚合导出所有错误处理相关工具
// 子模块：create, handle, check, format
// ==============================================

// 错误创建
export { 
  createError, 
  isError, 
  getErrorInfo,
} from './create';

// 错误处理
export { 
  handleError, 
  tryCatch, 
  tryCatchAsync,
} from './handle';

// 错误检查
export { 
  isRecoverable,
  isRetryableError,
  isNetworkError, 
  isValidationError, 
  isAuthError,
  isFileError,
  isAITaskError,
} from './check';

// 错误格式化
export { 
  getErrorMessage, 
  formatErrorForDisplay,
  formatErrorForLog,
  formatErrorForAPI,
} from './format';
