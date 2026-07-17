/**
 * 文件校验器
 * @module utils/validators/file-validators
 * @description 提供文件格式、大小、批量导入的运行时校验函数
 * 
 * 本模块包含以下功能：
 * - 文件格式校验（isSupportedImageFormat, isSupportedVideoFormat, isSupportedFormat等）
 * - 文件大小校验（validateFileSize, validateFile）
 * - 批量导入校验（validateBatchImport, canImportMoreFiles）
 * - 文件信息校验（validateFileInfo, validateFileMetadata）
 * - 文件路径/哈希校验（validateFilePath, validateFileHash）
 * 
 * 所有校验函数均返回标准化的 ValidationResult 接口
 * 
 * @example
 * // 校验单个文件
 * const result = validateFile(file, 500 * 1024 * 1024);
 * if (!result.valid) {
 *   console.error(result.message);
 * }
 * 
 * // 批量导入校验
 * const batchResult = validateBatchImport(files, { maxFiles: 100 });
 */

import type { SupportedFormat, SupportedImageFormat, SupportedVideoFormat, SupportedModelFormat, FileInfo, FileMetadata } from '@/types/file.types';
import { 
  SUPPORTED_FORMATS, 
  BATCH_IMPORT_DEFAULTS,
} from '@/constants/file.constants';

/**
 * 校验结果接口
 * @description 所有校验函数的统一返回格式
 */
export interface ValidationResult {
  /** 校验是否通过 */
  valid: boolean;
  /** 校验失败时的错误消息 */
  message: string;
}

/**
 * 创建成功的校验结果
 * @returns 校验通过的结果对象
 */
export function createValidResult(): ValidationResult {
  return { valid: true, message: '' };
}

/**
 * 创建失败的校验结果
 * @param message - 错误消息
 * @returns 校验失败的结果对象
 */
export function createInvalidResult(message: string): ValidationResult {
  return { valid: false, message };
}

/**
 * 检查是否为支持的图片格式
 * @description 类型守卫函数，用于判断格式是否为有效的图片格式
 * @param format - 文件格式（不含点号）
 * @returns 如果是支持的图片格式则返回true
 */
export function isSupportedImageFormat(format: string): format is SupportedImageFormat {
  return SUPPORTED_FORMATS.image.includes(format as SupportedImageFormat);
}

/**
 * 检查是否为支持的视频格式
 * @description 类型守卫函数，用于判断格式是否为有效的视频格式
 * @param format - 文件格式（不含点号）
 * @returns 如果是支持的视频格式则返回true
 */
export function isSupportedVideoFormat(format: string): format is SupportedVideoFormat {
  return SUPPORTED_FORMATS.video.includes(format as SupportedVideoFormat);
}

/**
 * 检查是否为支持的模型格式
 * @description 类型守卫函数，用于判断格式是否为有效的3D模型格式
 * @param format - 文件格式（不含点号）
 * @returns 如果是支持的模型格式则返回true
 */
export function isSupportedModelFormat(format: string): format is SupportedModelFormat {
  return SUPPORTED_FORMATS.model3d.includes(format as SupportedModelFormat);
}

/**
 * 检查是否为支持的文件格式
 * @description 类型守卫函数，综合判断图片、视频、模型格式
 * @param format - 文件格式（不含点号）
 * @returns 如果是任意支持的格式则返回true
 */
export function isSupportedFormat(format: string): format is SupportedFormat {
  return isSupportedImageFormat(format) || 
         isSupportedVideoFormat(format) || 
         isSupportedModelFormat(format);
}

/**
 * 校验文件格式
 * @param format - 待校验的文件格式
 * @returns 校验结果
 * 
 * @example
 * const result = validateFileFormat('jpg');
 * // result.valid === true
 */
export function validateFileFormat(format: unknown): ValidationResult {
  if (typeof format !== 'string') {
    return createInvalidResult('文件格式必须是字符串');
  }
  
  const normalizedFormat = format.toLowerCase();
  
  if (!isSupportedFormat(normalizedFormat)) {
    const supportedList = [
      ...SUPPORTED_FORMATS.image,
      ...SUPPORTED_FORMATS.video,
      ...SUPPORTED_FORMATS.model3d
    ].join(', ');
    return createInvalidResult(`不支持的文件格式: ${format}。支持的格式: ${supportedList}`);
  }
  
  return createValidResult();
}

/**
 * 校验文件扩展名
 * @description 从文件名中提取扩展名并校验
 * @param fileName - 文件名（包含扩展名）
 * @returns 校验结果
 */
export function validateFileExtension(fileName: string): ValidationResult {
  if (typeof fileName !== 'string' || fileName.length === 0) {
    return createInvalidResult('文件名必须是非空字符串');
  }
  
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === fileName.length - 1) {
    return createInvalidResult('文件名必须包含有效的扩展名');
  }
  
  const extension = fileName.slice(lastDotIndex + 1).toLowerCase();
  return validateFileFormat(extension);
}

/**
 * 校验文件大小
 * @param size - 文件大小（字节）
 * @param maxSize - 最大允许大小（字节），默认使用配置值
 * @returns 校验结果
 */
export function validateFileSize(size: number, maxSize: number = BATCH_IMPORT_DEFAULTS.maxFileSize): ValidationResult {
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    return createInvalidResult('文件大小必须是数值');
  }
  
  if (size < 0) {
    return createInvalidResult('文件大小不能为负数');
  }
  
  if (size > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
    const sizeMB = (size / (1024 * 1024)).toFixed(2);
    return createInvalidResult(`文件大小(${sizeMB}MB)超过最大限制(${maxSizeMB}MB)`);
  }
  
  return createValidResult();
}

/**
 * 校验MIME类型
 * @param mimeType - MIME类型字符串
 * @returns 校验结果
 */
export function validateFileMimeType(mimeType: unknown): ValidationResult {
  if (typeof mimeType !== 'string' || mimeType.length === 0) {
    return createInvalidResult('MIME类型必须是非空字符串');
  }
  
  const validPrefixes = ['image/', 'video/', 'model/', 'application/'];
  const hasValidPrefix = validPrefixes.some(prefix => mimeType.startsWith(prefix));
  
  if (!hasValidPrefix) {
    return createInvalidResult(`无效的MIME类型: ${mimeType}`);
  }
  
  return createValidResult();
}

/**
 * 校验File对象
 * @description 综合校验文件的扩展名和大小
 * @param file - File对象
 * @param maxSize - 最大允许大小（字节）
 * @returns 校验结果
 */
export function validateFile(file: File, maxSize: number = BATCH_IMPORT_DEFAULTS.maxFileSize): ValidationResult {
  if (!(file instanceof File)) {
    return createInvalidResult('参数必须是File对象');
  }
  
  const nameResult = validateFileExtension(file.name);
  if (!nameResult.valid) {
    return nameResult;
  }
  
  const sizeResult = validateFileSize(file.size, maxSize);
  if (!sizeResult.valid) {
    return sizeResult;
  }
  
  return createValidResult();
}

/**
 * 校验批量导入
 * @description 校验文件数组和每个文件的有效性
 * @param files - File对象数组
 * @param config - 配置选项
 * @param config.maxFiles - 最大文件数量
 * @param config.maxFileSize - 单个文件最大大小
 * @returns 校验结果
 */
export function validateBatchImport(files: File[], config: { maxFiles?: number; maxFileSize?: number } = {}): ValidationResult {
  const maxFiles = config.maxFiles ?? BATCH_IMPORT_DEFAULTS.maxFiles;
  const maxFileSize = config.maxFileSize ?? BATCH_IMPORT_DEFAULTS.maxFileSize;
  
  if (!Array.isArray(files)) {
    return createInvalidResult('文件列表必须是数组');
  }
  
  if (files.length === 0) {
    return createInvalidResult('文件列表不能为空');
  }
  
  if (files.length > maxFiles) {
    return createInvalidResult(`批量导入文件数量(${files.length})超过最大限制(${maxFiles})`);
  }
  
  for (let i = 0; i < files.length; i++) {
    const result = validateFile(files[i], maxFileSize);
    if (!result.valid) {
      return createInvalidResult(`第${i + 1}个文件校验失败: ${result.message}`);
    }
  }
  
  return createValidResult();
}

/**
 * 校验文件信息对象
 * @description 校验FileInfo结构的完整性
 * @param fileInfo - 文件信息对象
 * @returns 校验结果
 */
export function validateFileInfo(fileInfo: unknown): ValidationResult {
  if (typeof fileInfo !== 'object' || fileInfo === null) {
    return createInvalidResult('文件信息必须是一个对象');
  }
  
  const info = fileInfo as Partial<FileInfo>;
  
  if (typeof info.id !== 'string' || info.id.length === 0) {
    return createInvalidResult('文件ID必须是非空字符串');
  }
  
  if (typeof info.name !== 'string' || info.name.length === 0) {
    return createInvalidResult('文件名必须是非空字符串');
  }
  
  if (typeof info.size !== 'number' || info.size < 0) {
    return createInvalidResult('文件大小必须是非负数值');
  }
  
  const formatResult = validateFileFormat(info.format);
  if (!formatResult.valid) {
    return formatResult;
  }
  
  if (info.fileType !== 'image' && info.fileType !== 'video' && info.fileType !== 'model3d') {
    return createInvalidResult('文件类型必须是image、video或model3d');
  }
  
  return createValidResult();
}

/**
 * 校验文件元数据
 * @description 校验文件的宽高、时长、帧率等元数据
 * @param metadata - 文件元数据对象
 * @returns 校验结果
 */
export function validateFileMetadata(metadata: unknown): ValidationResult {
  if (typeof metadata !== 'object' || metadata === null) {
    return createInvalidResult('文件元数据必须是一个对象');
  }
  
  const meta = metadata as Partial<FileMetadata>;
  
  if (meta.width !== undefined) {
    if (typeof meta.width !== 'number' || meta.width <= 0 || !Number.isFinite(meta.width)) {
      return createInvalidResult('宽度必须是正数');
    }
  }
  
  if (meta.height !== undefined) {
    if (typeof meta.height !== 'number' || meta.height <= 0 || !Number.isFinite(meta.height)) {
      return createInvalidResult('高度必须是正数');
    }
  }
  
  if (meta.duration !== undefined) {
    if (typeof meta.duration !== 'number' || meta.duration < 0 || !Number.isFinite(meta.duration)) {
      return createInvalidResult('时长必须是非负数值');
    }
  }
  
  if (meta.frameRate !== undefined) {
    if (typeof meta.frameRate !== 'number' || meta.frameRate <= 0 || !Number.isFinite(meta.frameRate)) {
      return createInvalidResult('帧率必须是正数');
    }
  }
  
  if (meta.bitrate !== undefined) {
    if (typeof meta.bitrate !== 'number' || meta.bitrate < 0 || !Number.isFinite(meta.bitrate)) {
      return createInvalidResult('比特率必须是非负数值');
    }
  }
  
  return createValidResult();
}

/**
 * 校验图片尺寸
 * @param width - 宽度（像素）
 * @param height - 高度（像素）
 * @returns 校验结果
 */
export function validateImageDimensions(width: number, height: number): ValidationResult {
  if (typeof width !== 'number' || typeof height !== 'number') {
    return createInvalidResult('宽度和高度必须是数值');
  }
  
  if (width <= 0 || height <= 0) {
    return createInvalidResult('宽度和高度必须是正数');
  }
  
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return createInvalidResult('宽度和高度必须是有限数值');
  }
  
  return createValidResult();
}

/**
 * 校验视频时长
 * @param duration - 时长（秒）
 * @returns 校验结果
 */
export function validateVideoDuration(duration: number): ValidationResult {
  if (typeof duration !== 'number') {
    return createInvalidResult('视频时长必须是数值');
  }
  
  if (duration < 0) {
    return createInvalidResult('视频时长不能为负数');
  }
  
  if (!Number.isFinite(duration)) {
    return createInvalidResult('视频时长必须是有限数值');
  }
  
  return createValidResult();
}

/**
 * 根据格式获取文件类型
 * @param format - 文件格式
 * @returns 文件类型（image/video/model3d），不支持则返回null
 */
export function getFileType(format: string): 'image' | 'video' | 'model3d' | null {
  const normalizedFormat = format.toLowerCase();
  
  if (isSupportedImageFormat(normalizedFormat)) {
    return 'image';
  }
  if (isSupportedVideoFormat(normalizedFormat)) {
    return 'video';
  }
  if (isSupportedModelFormat(normalizedFormat)) {
    return 'model3d';
  }
  
  return null;
}

/**
 * 校验文件哈希值
 * @param hash - 文件哈希值（十六进制字符串）
 * @returns 校验结果
 */
export function validateFileHash(hash: unknown): ValidationResult {
  if (typeof hash !== 'string' || hash.length === 0) {
    return createInvalidResult('文件哈希值必须是非空字符串');
  }
  
  const hexPattern = /^[a-fA-F0-9]+$/;
  if (!hexPattern.test(hash)) {
    return createInvalidResult('文件哈希值必须是有效的十六进制字符串');
  }
  
  return createValidResult();
}

/**
 * 校验文件路径
 * @description 检查路径是否包含非法字符（如相对路径引用）
 * @param path - 文件路径
 * @returns 校验结果
 */
export function validateFilePath(path: unknown): ValidationResult {
  if (typeof path !== 'string' || path.length === 0) {
    return createInvalidResult('文件路径必须是非空字符串');
  }
  
  if (path.includes('..')) {
    return createInvalidResult('文件路径不能包含相对路径引用');
  }
  
  return createValidResult();
}

/**
 * 检查是否可以继续导入文件
 * @param currentCount - 当前已导入的文件数量
 * @param maxFiles - 最大允许数量
 * @returns 校验结果
 */
export function canImportMoreFiles(currentCount: number, maxFiles: number = BATCH_IMPORT_DEFAULTS.maxFiles): ValidationResult {
  if (currentCount >= maxFiles) {
    return createInvalidResult(`已达到最大文件导入数量限制(${maxFiles})`);
  }
  return createValidResult();
}

/**
 * 获取剩余可导入的文件槽位数量
 * @param currentCount - 当前已导入的文件数量
 * @param maxFiles - 最大允许数量
 * @returns 剩余可导入数量
 */
export function getRemainingImportSlots(currentCount: number, maxFiles: number = BATCH_IMPORT_DEFAULTS.maxFiles): number {
  return Math.max(0, maxFiles - currentCount);
}
