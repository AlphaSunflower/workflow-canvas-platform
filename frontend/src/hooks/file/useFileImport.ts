// ==============================================
// 🔒 LOCKED: 文件导入 Hook
// @module hooks/file/useFileImport
// 最后锁定时间：2026-03-25
// 说明：提供文件拖拽导入、批量导入、格式验证等功能
// 依赖层：types (import type), constants, utils
// ==============================================

import { useCallback, useMemo, useState } from 'react';
import type { 
  FileImportResult, 
  FileValidationError, 
  BatchImportConfig,
  FileInfo,
  SupportedFormat,
} from '@/types';
import { 
  createModuleLogger,
  filterSupportedFiles,
  getFileTypeFromName,
  getFileExtension,
  formatFileSize,
  generateUUID,
  calculateTotalSize,
  validateBatchImport,
} from '@/utils';
import { 
  SUPPORTED_FORMATS, 
  BATCH_IMPORT_DEFAULTS,
} from '@/constants';
import { fileService } from '@/services/file/file-service';

/** 模块日志器 */
const log = createModuleLogger('useFileImport');

/**
 * 文件导入 Hook 配置选项
 * @description 配置导入行为和回调
 */
export interface UseFileImportOptions {
  /** 批量导入配置 */
  config?: Partial<BatchImportConfig>;
  /** 导入开始回调 */
  onImportStart?: (files: File[]) => void;
  /** 导入完成回调 */
  onImportComplete?: (result: FileImportResult) => void;
  /** 导入错误回调 */
  onImportError?: (errors: FileValidationError[]) => void;
  /** 文件验证通过回调 */
  onFileValid?: (file: File) => void;
  /** 文件验证失败回调 */
  onFileInvalid?: (file: File, error: FileValidationError) => void;
}

/**
 * 文件导入 Hook 返回值
 * @description 提供导入状态和操作方法
 */
export interface UseFileImportReturn {
  /** 是否正在导入 */
  isImporting: boolean;
  /** 导入进度 */
  progress: number;
  /** 导入配置 */
  config: BatchImportConfig;
  /** 上次导入结果 */
  lastImportResult: FileImportResult | null;
  /** 导入文件 */
  importFiles: (files: File[]) => Promise<FileImportResult>;
  /** 从DataTransfer导入 */
  importFromDataTransfer: (dataTransfer: DataTransfer) => Promise<FileImportResult>;
  /** 验证单个文件 */
  validateFile: (file: File) => FileValidationError | null;
  /** 验证多个文件 */
  validateFiles: (files: File[]) => FileValidationError[];
  /** 检查是否可导入 */
  canImport: (files: File[]) => boolean;
  /** 获取导入摘要 */
  getImportSummary: (files: File[]) => { total: number; valid: number; invalid: number; totalSize: number };
  /** 设置配置 */
  setConfig: (config: Partial<BatchImportConfig>) => void;
  /** 重置状态 */
  reset: () => void;
}

/**
 * 文件导入 Hook
 * @description 提供文件拖拽导入、批量导入、格式验证等功能
 * @param options - Hook 配置选项
 * @returns 导入状态和操作方法
 */
export function useFileImport(options: UseFileImportOptions = {}): UseFileImportReturn {
  // 解构配置选项
  const { 
    config: customConfig,
    onImportStart,
    onImportComplete,
    onImportError,
    onFileValid,
    onFileInvalid,
  } = options;

  /** 合并默认配置 */
  const [config, setConfigState] = useState<BatchImportConfig>(() => ({
    ...BATCH_IMPORT_DEFAULTS,
    ...customConfig,
  }));

  /** 是否正在导入 */
  const [isImporting, setIsImporting] = useState(false);
  /** 导入进度 */
  const [progress, setProgress] = useState(0);
  /** 上次导入结果 */
  const [lastImportResult, setLastImportResult] = useState<FileImportResult | null>(null);

  /**
   * 验证单个文件
   * @description 检查文件格式和大小
   * @param file - 要验证的文件
   * @returns 验证错误，无错误返回null
   */
  const validateFile = useCallback((file: File): FileValidationError | null => {
    /** 文件扩展名 */
    const extension = getFileExtension(file.name);
    
    // 检查文件格式
    if (!extension || !Object.values(SUPPORTED_FORMATS).flat().includes(extension as SupportedFormat)) {
      return {
        fileName: file.name,
        code: 'FILE_TYPE_ERROR',
        message: `不支持的文件格式: ${extension || '未知'}`,
      };
    }

    // 检查文件大小
    if (file.size > config.maxFileSize) {
      return {
        fileName: file.name,
        code: 'FILE_SIZE_ERROR',
        message: `文件大小超出限制: ${formatFileSize(file.size)} > ${formatFileSize(config.maxFileSize)}`,
      };
    }

    return null;
  }, [config.maxFileSize]);

  /**
   * 验证多个文件
   * @description 批量验证文件
   * @param files - 文件列表
   * @returns 验证错误列表
   */
  const validateFiles = useCallback((files: File[]): FileValidationError[] => {
    /** 错误列表 */
    const errors: FileValidationError[] = [];

    // 检查文件数量
    if (files.length > config.maxFiles) {
      errors.push({
        fileName: '',
        code: 'FILE_COUNT_ERROR',
        message: `文件数量超出限制: ${files.length} > ${config.maxFiles}`,
      });
    }

    // 逐个验证文件
    for (const file of files) {
      const error = validateFile(file);
      if (error) {
        errors.push(error);
        onFileInvalid?.(file, error);
      } else {
        onFileValid?.(file);
      }
    }

    return errors;
  }, [config.maxFiles, validateFile, onFileValid, onFileInvalid]);

  /**
   * 检查是否可导入
   * @description 判断文件是否可以导入
   * @param files - 文件列表
   * @returns 是否可导入
   */
  const canImport = useCallback((files: File[]): boolean => {
    const result = validateBatchImport(files, config);
    return result.valid;
  }, [config]);

  /**
   * 获取导入摘要
   * @description 获取文件的导入统计信息
   * @param files - 文件列表
   * @returns 导入摘要
   */
  const getImportSummary = useCallback((files: File[]) => {
    /** 支持的文件 */
    const supported = filterSupportedFiles(files);
    /** 验证错误 */
    const errors = validateFiles(files);
    
    return {
      total: files.length,
      valid: supported.length,
      invalid: errors.length,
      totalSize: calculateTotalSize(files),
    };
  }, [validateFiles]);

  /**
   * 导入文件
   * @description 执行文件导入流程
   * @param files - 要导入的文件
   * @returns 导入结果
   */
  const importFiles = useCallback(async (files: File[]): Promise<FileImportResult> => {
    setIsImporting(true);
    setProgress(0);
    onImportStart?.(files);

    /** 验证错误 */
    const errors = validateFiles(files);
    /** 有效文件 */
    const validFiles = files.filter(file => {
      const error = validateFile(file);
      return error === null;
    });

    /** 导入结果 */
    const result: FileImportResult = {
      success: errors.length === 0,
      files: [],
      errors,
      duplicates: [],
    };

    /** 总文件数 */
    const totalFiles = validFiles.length;
    /** 已处理文件数 */
    let processedFiles = 0;

    // 处理每个文件
    for (const file of validFiles) {
      try {
        /** 文件类型 */
        const fileType = getFileTypeFromName(file.name);
        const now = Date.now();
        
        /** 文件信息 */
        const fileInfo: FileInfo = {
          id: generateUUID(),
          name: file.name,
          originalName: file.name,
          size: file.size,
          mimeType: file.type,
          format: getFileExtension(file.name) as SupportedFormat,
          fileType: fileType ?? 'image',
          status: 'uploading',
          hash: generateUUID().replace(/-/g, ''),
          path: file.name,
          metadata: {},
          source: fileService.createLocalImportFileSource({
            sourceDisplayName: file.name,
            localSource: {
              status: 'runtime-only',
            },
            importedAt: now,
          }),
          timestamp: {
            created: now,
            updated: now,
          },
        };

        result.files.push(fileInfo);
        
        processedFiles++;
        setProgress(Math.round((processedFiles / totalFiles) * 100));
      } catch (error) {
        /** 错误消息 */
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({
          fileName: file.name,
          code: 'UPLOAD_ERROR',
          message: errorMsg,
        });
      }
    }

    setLastImportResult(result);
    setIsImporting(false);
    setProgress(100);

    if (result.errors.length > 0) {
      onImportError?.(result.errors);
    }
    
    onImportComplete?.(result);
    log.info('importFiles', `Imported ${result.files.length} files with ${result.errors.length} errors`);

    return result;
  }, [validateFiles, validateFile, onImportStart, onImportComplete, onImportError]);

  /**
   * 从DataTransfer导入
   * @description 处理拖拽导入
   * @param dataTransfer - DataTransfer对象
   * @returns 导入结果
   */
  const importFromDataTransfer = useCallback(async (dataTransfer: DataTransfer): Promise<FileImportResult> => {
    /** DataTransfer items */
    const items = dataTransfer.items;
    /** 文件列表 */
    const files: File[] = [];

    // 使用items API（现代浏览器）
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
        if (file) {
            files.push(file);
          }
        }
      }
    } else {
      // 回退到files API
      for (let i = 0; i < dataTransfer.files.length; i++) {
        files.push(dataTransfer.files[i]);
      }
    }

    log.debug('importFromDataTransfer', `Found ${files.length} files in data transfer`);
    return importFiles(files);
  }, [importFiles]);

  /**
   * 设置配置
   * @description 更新导入配置
   * @param newConfig - 新配置
   */
  const setConfig = useCallback((newConfig: Partial<BatchImportConfig>) => {
    setConfigState(prev => ({ ...prev, ...newConfig }));
    log.debug('setConfig', 'Import config updated');
  }, []);

  /**
   * 重置状态
   * @description 清空导入状态
   */
  const reset = useCallback(() => {
    setIsImporting(false);
    setProgress(0);
    setLastImportResult(null);
    log.debug('reset', 'Import state reset');
  }, []);

  // 返回所有状态和方法
  return useMemo(() => ({
    isImporting,
    progress,
    config,
    lastImportResult,
    importFiles,
    importFromDataTransfer,
    validateFile,
    validateFiles,
    canImport,
    getImportSummary,
    setConfig,
    reset,
  }), [
    isImporting,
    progress,
    config,
    lastImportResult,
    importFiles,
    importFromDataTransfer,
    validateFile,
    validateFiles,
    canImport,
    getImportSummary,
    setConfig,
    reset,
  ]);
}
