// ==============================================
// 🔒 LOCKED: 文件工具统一导出
// @module utils/file
// 最后锁定时间：2026-03-25
// 说明：聚合导出所有文件相关工具
// 子模块：format, size
// ==============================================
// 文件格式工具
export { getFileExtension, getFileNameWithoutExtension, getFileTypeFromExtension, getFileTypeFromName, isImageFile, isVideoFile, isModelFile, isSupportedFile, getMimeType, isImageMimeType, isVideoMimeType, getExtensionFromMimeType, needsTranscoding, getFileIcon, getFileIconFromName, calculateThumbnailSize, getPreviewDimensions, filterSupportedFiles, } from './format';
// 文件大小工具
export { formatFileSize, parseFileSize, calculateTotalSize, calculateAverageSize, getFileSizeCategory, compareFileSize, } from './size';
