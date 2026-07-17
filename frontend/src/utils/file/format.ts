// ==============================================
// 🔒 LOCKED: 文件格式工具
// @module utils/file/format
// 最后锁定时间：2026-03-25
// 说明：提供文件格式判断、扩展名提取、MIME类型映射等功能
// 依赖层：types, constants
// ==============================================

import type { SupportedImageFormat, SupportedVideoFormat, SupportedModelFormat } from '@/types/file.types';
import { SUPPORTED_FORMATS, FILE_TYPE_MAP } from '@/constants/file.constants';

/** 文件类型 */
export type FileType = 'image' | 'video' | 'model3d';

/**
 * 获取文件扩展名
 * @description 从文件名提取扩展名（不含点号）
 * @param fileName - 文件名
 * @returns 扩展名（小写）
 * 
 * @example
 * getFileExtension('image.jpg');
 * // "jpg"
 */
export function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === fileName.length - 1) {
    return '';
  }
  return fileName.slice(lastDotIndex + 1).toLowerCase();
}

/**
 * 获取不含扩展名的文件名
 * @description 从文件名移除扩展名
 * @param fileName - 文件名
 * @returns 不含扩展名的文件名
 */
export function getFileNameWithoutExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return fileName;
  }
  return fileName.slice(0, lastDotIndex);
}

/**
 * 根据扩展名获取文件类型
 * @description 从扩展名判断文件类型
 * @param extension - 扩展名
 * @returns 文件类型或null
 */
export function getFileTypeFromExtension(extension: string): FileType | null {
  const normalizedExt = extension.toLowerCase();
  const type = FILE_TYPE_MAP[normalizedExt as keyof typeof FILE_TYPE_MAP];
  return type ?? null;
}

/**
 * 根据文件名获取文件类型
 * @description 从文件名判断文件类型
 * @param fileName - 文件名
 * @returns 文件类型或null
 */
export function getFileTypeFromName(fileName: string): FileType | null {
  const extension = getFileExtension(fileName);
  return getFileTypeFromExtension(extension);
}

/**
 * 判断是否为图片文件
 * @description 检查文件名是否为支持的图片格式
 * @param fileName - 文件名
 * @returns 是否为图片
 */
export function isImageFile(fileName: string): boolean {
  const extension = getFileExtension(fileName);
  return SUPPORTED_FORMATS.image.includes(extension as SupportedImageFormat);
}

/**
 * 判断是否为视频文件
 * @description 检查文件名是否为支持的视频格式
 * @param fileName - 文件名
 * @returns 是否为视频
 */
export function isVideoFile(fileName: string): boolean {
  const extension = getFileExtension(fileName);
  return SUPPORTED_FORMATS.video.includes(extension as SupportedVideoFormat);
}

/**
 * 判断是否为3D模型文件
 * @description 检查文件名是否为支持的模型格式
 * @param fileName - 文件名
 * @returns 是否为模型
 */
export function isModelFile(fileName: string): boolean {
  const extension = getFileExtension(fileName);
  return SUPPORTED_FORMATS.model3d.includes(extension as SupportedModelFormat);
}

/**
 * 判断是否为支持的文件
 * @description 检查文件名是否为支持的格式
 * @param fileName - 文件名
 * @returns 是否支持
 */
export function isSupportedFile(fileName: string): boolean {
  const extension = getFileExtension(fileName);
  return Object.prototype.hasOwnProperty.call(FILE_TYPE_MAP, extension);
}

/**
 * 获取MIME类型
 * @description 根据文件扩展名获取MIME类型
 * @param fileName - 文件名
 * @returns MIME类型
 */
export function getMimeType(fileName: string): string {
  const extension = getFileExtension(fileName);
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    ply: 'application/octet-stream',
  };
  return mimeTypes[extension] ?? 'application/octet-stream';
}

/**
 * 判断是否为图片MIME类型
 * @param mimeType - MIME类型
 * @returns 是否为图片
 */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * 判断是否为视频MIME类型
 * @param mimeType - MIME类型
 * @returns 是否为视频
 */
export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/**
 * 根据MIME类型获取扩展名
 * @param mimeType - MIME类型
 * @returns 扩展名
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
  };
  return mimeToExt[mimeType] ?? '';
}

/**
 * 判断是否需要转码
 * @description 检查MIME类型是否需要转码处理
 * @param mimeType - MIME类型
 * @returns 是否需要转码
 */
export function needsTranscoding(mimeType: string): boolean {
  const supportedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
    'video/mp4', 'video/webm',
  ];
  return !supportedMimeTypes.includes(mimeType);
}

/**
 * 获取文件图标
 * @description 根据文件类型获取对应的emoji图标
 * @param fileType - 文件类型
 * @returns 图标emoji
 */
export function getFileIcon(fileType: FileType): string {
  const icons: Record<FileType, string> = {
    image: '🖼️',
    video: '🎬',
    model3d: '🎲',
  };
  return icons[fileType] ?? '📄';
}

/**
 * 根据文件名获取图标
 * @description 从文件名判断类型并获取图标
 * @param fileName - 文件名
 * @returns 图标emoji
 */
export function getFileIconFromName(fileName: string): string {
  const fileType = getFileTypeFromName(fileName);
  if (!fileType) {
    return '📄';
  }
  return getFileIcon(fileType);
}

import type { FileMetadata, FilePreviewSize } from '@/types/file.types';
import { PREVIEW_SIZE_1080P } from '@/constants/file.constants';

/**
 * 计算缩略图尺寸
 * @description 根据原始尺寸和最大尺寸计算缩略图尺寸
 * @param originalWidth - 原始宽度
 * @param originalHeight - 原始高度
 * @param maxSize - 最大尺寸
 * @returns 缩略图尺寸
 */
export function calculateThumbnailSize(
  originalWidth: number,
  originalHeight: number,
  maxSize: number = 100
): { width: number; height: number } {
  const aspectRatio = originalWidth / originalHeight;
  
  if (originalWidth > originalHeight) {
    return {
      width: maxSize,
      height: Math.round(maxSize / aspectRatio),
    };
  }
  
  return {
    width: Math.round(maxSize * aspectRatio),
    height: maxSize,
  };
}

/**
 * 获取预览尺寸
 * @description 根据文件元数据计算预览尺寸
 * @param metadata - 文件元数据
 * @param baseWidth - 基础宽度
 * @returns 预览尺寸
 */
export function getPreviewDimensions(
  metadata: FileMetadata,
  baseWidth: number = PREVIEW_SIZE_1080P.width
): FilePreviewSize {
  if (metadata.width && metadata.height) {
    const aspectRatio = metadata.width / metadata.height;
    const width = baseWidth;
    const height = Math.round(width / aspectRatio);
    return { width, height, scale: 1 };
  }
  return { width: baseWidth, height: PREVIEW_SIZE_1080P.height, scale: 1 };
}

/**
 * 过滤支持的文件
 * @description 从文件列表中筛选出支持的文件类型
 * @param files - 文件列表
 * @returns 支持的文件列表
 */
export function filterSupportedFiles(files: File[]): File[] {
  return files.filter(file => isSupportedFile(file.name));
}
