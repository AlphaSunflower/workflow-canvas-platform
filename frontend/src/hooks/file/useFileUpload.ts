// ==============================================
// 🔒 LOCKED: 文件上传 Hook
// @module hooks/file/useFileUpload
// 最后锁定时间：2026-03-25
// 说明：提供文件上传、分片上传、进度跟踪等功能
// 依赖层：types (import type), constants, utils
// ==============================================

import { useCallback, useMemo, useRef, useState } from 'react';
import type { FileInfo, FileUploadProgress, UUID } from '@/types';
import { 
  createModuleLogger,
  generateUUID,
  formatFileSize,
} from '@/utils';
import { fileService } from '@/services/file/file-service';

/** 模块日志器 */
const log = createModuleLogger('useFileUpload');

/** 默认分片大小：5MB */
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * 文件上传 Hook 配置选项
 * @description 配置上传行为和回调
 */
export interface UseFileUploadOptions {
  /** 分片大小 */
  chunkSize?: number;
  /** 上传开始回调 */
  onUploadStart?: (fileId: string, file: File) => void;
  /** 上传进度回调 */
  onUploadProgress?: (fileId: string, progress: FileUploadProgress) => void;
  /** 上传完成回调 */
  onUploadComplete?: (fileId: string, fileInfo: FileInfo) => void;
  /** 上传错误回调 */
  onUploadError?: (fileId: string, error: string) => void;
}

/**
 * 上传任务
 * @description 单个文件的上传任务状态
 */
export interface UploadTask {
  /** 任务ID */
  id: string;
  /** 文件对象 */
  file: File;
  /** 任务状态 */
  status: 'pending' | 'uploading' | 'completed' | 'error';
  /** 上传进度 */
  progress: FileUploadProgress;
  /** 文件信息（上传完成后） */
  fileInfo?: FileInfo;
}

/**
 * 文件上传 Hook 返回值
 * @description 提供上传状态和操作方法
 */
export interface UseFileUploadReturn {
  /** 所有上传任务 */
  tasks: Map<string, UploadTask>;
  /** 活跃的上传任务 */
  activeTasks: UploadTask[];
  /** 是否正在上传 */
  isUploading: boolean;
  /** 是否有活跃上传 */
  hasActiveUploads: boolean;
  /** 上传单个文件 */
  upload: (file: File) => string;
  /** 上传多个文件 */
  uploadMultiple: (files: File[]) => string[];
  /** 取消上传 */
  cancelUpload: (fileId: string) => void;
  /** 取消所有上传 */
  cancelAllUploads: () => void;
  /** 重试上传 */
  retryUpload: (fileId: string) => void;
  /** 获取任务 */
  getTask: (fileId: string) => UploadTask | undefined;
  /** 获取进度 */
  getProgress: (fileId: string) => FileUploadProgress | null;
  /** 获取总进度 */
  getTotalProgress: () => number;
  /** 清除已完成任务 */
  clearCompleted: () => void;
}

/**
 * 文件上传 Hook
 * @description 提供文件上传、分片上传、进度跟踪等功能
 * @param options - Hook 配置选项
 * @returns 上传状态和操作方法
 */
export function useFileUpload(options: UseFileUploadOptions = {}): UseFileUploadReturn {
  // 解构配置选项
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    onUploadStart,
    onUploadProgress,
    onUploadComplete,
    onUploadError,
  } = options;

  /** 上传任务Map */
  const [tasks, setTasks] = useState<Map<string, UploadTask>>(new Map());
  /** AbortController引用（用于取消上传） */
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  /** 重试文件引用 */
  const retryFilesRef = useRef<Map<string, File>>(new Map());

  /**
   * 创建上传任务
   * @description 初始化一个新的上传任务
   * @param file - 文件对象
   * @returns 上传任务
   */
  const createTask = useCallback((file: File): UploadTask => {
    /** 任务ID */
    const id = generateUUID();
    return {
      id,
      file,
      status: 'pending',
      progress: {
        fileId: id,
        fileName: file.name,
        progress: 0,
        uploadedBytes: 0,
        totalBytes: file.size,
        speed: 0,
        status: 'pending',
      },
    };
  }, []);

  /**
   * 更新任务状态
   * @description 更新指定任务的属性
   * @param fileId - 文件ID
   * @param updates - 要更新的属性
   */
  const updateTask = useCallback((fileId: string, updates: Partial<UploadTask>) => {
    setTasks(prev => {
      const newMap = new Map(prev);
      const task = newMap.get(fileId);
      if (task) {
        newMap.set(fileId, { ...task, ...updates });
      }
      return newMap;
    });
  }, []);

  /**
   * 模拟上传过程
   * @description 模拟分片上传，实际项目中替换为真实API调用
   * @param task - 上传任务
   * @param controller - AbortController
   * @returns 文件信息
   */
  const simulateUpload = useCallback(async (
    task: UploadTask,
    controller: AbortController
  ): Promise<FileInfo> => {
    const file = task.file;
    /** 开始时间 */
    const startTime = Date.now();
    /** 总分片数 */
    const totalChunks = Math.ceil(file.size / chunkSize);

    // 更新状态为上传中
    updateTask(task.id, { 
      status: 'uploading', 
      progress: { ...task.progress, status: 'uploading' },
    });

    // 模拟分片上传
    for (let i = 0; i < totalChunks; i++) {
      // 检查是否已取消
      if (controller.signal.aborted) {
        throw new Error('Upload cancelled');
      }

      // 模拟网络延迟
      await new Promise(resolve => setTimeout(resolve, 50));

      /** 已上传字节数 */
      const uploadedBytes = Math.min((i + 1) * chunkSize, file.size);
      /** 已用时间（秒） */
      const elapsed = (Date.now() - startTime) / 1000;
      /** 上传速度 */
      const speed = elapsed > 0 ? uploadedBytes / elapsed : 0;
      
      /** 进度信息 */
      const progress: FileUploadProgress = {
        fileId: task.id,
        fileName: file.name,
        progress: Math.round((uploadedBytes / file.size) * 100),
        uploadedBytes,
        totalBytes: file.size,
        speed,
        status: 'uploading',
      };

      updateTask(task.id, { progress });
      onUploadProgress?.(task.id, progress);
    }

    // 构建文件信息
    const fileInfo: FileInfo = {
      id: task.id as UUID,
      name: file.name,
      originalName: file.name,
      size: file.size,
      mimeType: file.type,
      format: file.name.split('.').pop() as FileInfo['format'],
      fileType: 'image',
      status: 'ready',
      hash: generateUUID().replace(/-/g, ''),
      path: `/uploads/${task.id}`,
      metadata: {},
      source: fileService.createLocalImportFileSource({
        sourceDisplayName: file.name,
        localSource: {
          status: 'runtime-only',
        },
      }),
      timestamp: { created: Date.now(), updated: Date.now() },
    };

    return fileInfo;
  }, [chunkSize, updateTask, onUploadProgress]);

  /**
   * 上传单个文件
   * @description 开始上传一个文件
   * @param file - 文件对象
   * @returns 任务ID
   */
  const upload = useCallback((file: File): string => {
    /** 创建任务 */
    const task = createTask(file);
    
    setTasks(prev => new Map(prev).set(task.id, task));
    onUploadStart?.(task.id, file);
    
    log.debug('upload', `Starting upload: ${file.name} (${formatFileSize(file.size)})`);

    /** 创建AbortController */
    const controller = new AbortController();
    abortControllersRef.current.set(task.id, controller);
    retryFilesRef.current.set(task.id, file);

    // 执行上传
    simulateUpload(task, controller)
      .then(fileInfo => {
        /** 最终进度 */
        const finalProgress: FileUploadProgress = {
          ...task.progress,
          progress: 100,
          status: 'completed',
        };

        updateTask(task.id, { 
          status: 'completed', 
          fileInfo,
          progress: finalProgress,
        });
        
        onUploadComplete?.(task.id, fileInfo);
        log.info('upload', `Upload completed: ${file.name}`);
      })
      .catch(error => {
        /** 错误消息 */
        const errorMsg = error instanceof Error ? error.message : 'Upload failed';
        updateTask(task.id, { 
          status: 'error',
          progress: { ...task.progress, status: 'error', error: errorMsg },
        });
        onUploadError?.(task.id, errorMsg);
        log.error('upload', `Upload failed: ${file.name}`, error instanceof Error ? error : undefined);
      })
      .finally(() => {
        abortControllersRef.current.delete(task.id);
      });

    return task.id;
  }, [createTask, updateTask, simulateUpload, onUploadStart, onUploadComplete, onUploadError]);

  /**
   * 上传多个文件
   * @description 批量上传文件
   * @param files - 文件列表
   * @returns 任务ID列表
   */
  const uploadMultiple = useCallback((files: File[]): string[] => {
    return files.map(file => upload(file));
  }, [upload]);

  /**
   * 取消上传
   * @description 取消指定文件的上传
   * @param fileId - 文件ID
   */
  const cancelUpload = useCallback((fileId: string) => {
    const controller = abortControllersRef.current.get(fileId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(fileId);
    }

    updateTask(fileId, { 
      status: 'error',
      progress: { 
        fileId, 
        fileName: '', 
        progress: 0, 
        uploadedBytes: 0, 
        totalBytes: 0, 
        speed: 0, 
        status: 'error',
        error: 'Cancelled',
      },
    });
    
    log.debug('cancelUpload', `Cancelled upload: ${fileId}`);
  }, [updateTask]);

  /**
   * 取消所有上传
   * @description 取消所有正在进行的上传
   */
  const cancelAllUploads = useCallback(() => {
    abortControllersRef.current.forEach((controller, fileId) => {
      controller.abort();
      updateTask(fileId, { status: 'error' });
    });
    abortControllersRef.current.clear();
    log.debug('cancelAllUploads', 'All uploads cancelled');
  }, [updateTask]);

  /**
   * 重试上传
   * @description 重新上传失败的文件
   * @param fileId - 文件ID
   */
  const retryUpload = useCallback((fileId: string) => {
    const file = retryFilesRef.current.get(fileId);
    if (file) {
      setTasks(prev => {
        const newMap = new Map(prev);
        newMap.delete(fileId);
        return newMap;
      });
      upload(file);
    }
  }, [upload]);

  /**
   * 获取任务
   * @description 获取指定ID的上传任务
   * @param fileId - 文件ID
   * @returns 上传任务
   */
  const getTask = useCallback((fileId: string): UploadTask | undefined => {
    return tasks.get(fileId);
  }, [tasks]);

  /**
   * 获取进度
   * @description 获取指定文件的上传进度
   * @param fileId - 文件ID
   * @returns 上传进度
   */
  const getProgress = useCallback((fileId: string): FileUploadProgress | null => {
    return tasks.get(fileId)?.progress ?? null;
  }, [tasks]);

  /**
   * 获取总进度
   * @description 计算所有任务的平均进度
   * @returns 总进度百分比
   */
  const getTotalProgress = useCallback((): number => {
    const taskList = Array.from(tasks.values());
    if (taskList.length === 0) return 0;
    
    const totalProgress = taskList.reduce((sum, task) => sum + task.progress.progress, 0);
    return Math.round(totalProgress / taskList.length);
  }, [tasks]);

  /**
   * 清除已完成任务
   * @description 移除所有已完成的任务
   */
  const clearCompleted = useCallback(() => {
    setTasks(prev => {
      const newMap = new Map(prev);
      Array.from(newMap.entries())
        .filter(([, task]) => task.status === 'completed')
        .forEach(([id]) => newMap.delete(id));
      return newMap;
    });
    log.debug('clearCompleted', 'Completed uploads cleared');
  }, []);

  /** 活跃任务列表 */
  const activeTasks = useMemo(() => {
    return Array.from(tasks.values()).filter(
      task => task.status === 'uploading' || task.status === 'pending'
    );
  }, [tasks]);

  // 返回所有状态和方法
  return useMemo(() => ({
    tasks,
    activeTasks,
    isUploading: activeTasks.length > 0,
    hasActiveUploads: activeTasks.length > 0,
    upload,
    uploadMultiple,
    cancelUpload,
    cancelAllUploads,
    retryUpload,
    getTask,
    getProgress,
    getTotalProgress,
    clearCompleted,
  }), [
    tasks,
    activeTasks,
    upload,
    uploadMultiple,
    cancelUpload,
    cancelAllUploads,
    retryUpload,
    getTask,
    getProgress,
    getTotalProgress,
    clearCompleted,
  ]);
}
