import React, { memo, useCallback, useState, useRef } from 'react';
import { useNotification } from '../../hooks/ui';
import { FILE_TYPE_MAP, BATCH_IMPORT_DEFAULTS } from '../../constants';
import { createModuleLogger } from '../../utils';
import type { Position } from '../../types';

const log = createModuleLogger('file-drop-zone');

interface DroppedFile {
  file: File;
  type: 'image' | 'video' | 'model3d' | 'unsupported';
  isValid: boolean;
  error?: string;
}

interface FileDropZoneProps {
  children: React.ReactNode;
  onFilesDropped?: (files: File[], position: Position) => void;
  className?: string;
}

const FileDropZoneInner: React.FC<FileDropZoneProps> = ({
  children,
  onFilesDropped,
  className = '',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [invalidFiles, setInvalidFiles] = useState<DroppedFile[]>([]);
  const dropRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  const { showError, showWarning } = useNotification();

  const getFileType = useCallback((filename: string): 'image' | 'video' | 'model3d' | 'unsupported' => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return FILE_TYPE_MAP[ext as keyof typeof FILE_TYPE_MAP] || 'unsupported';
  }, []);

  const validateFiles = useCallback((fileList: FileList | File[]): DroppedFile[] => {
    const files = Array.from(fileList);

    return files.map((file) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const fileType = getFileType(file.name);

      if (fileType === 'unsupported') {
        return {
          file,
          type: fileType,
          isValid: false,
          error: `不支持的文件格式: .${ext}`,
        };
      }

      if (file.size > BATCH_IMPORT_DEFAULTS.maxFileSize) {
        return {
          file,
          type: fileType,
          isValid: false,
          error: `文件大小超出限制: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
        };
      }

      return {
        file,
        type: fileType,
        isValid: true,
      };
    });
  }, [getFileType]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const { files } = e.dataTransfer;
    if (!files || files.length === 0) return;

    const dropPosition = { x: e.clientX, y: e.clientY };
    const validatedFiles = validateFiles(files);
    const validFiles = validatedFiles.filter((f) => f.isValid);
    const invalidFilesList = validatedFiles.filter((f) => !f.isValid);

    if (invalidFilesList.length > 0) {
      setInvalidFiles(invalidFilesList);
      showError('导入失败', `${invalidFilesList.length} 个文件不符合条件`);
      log.warn('handleDrop', `Invalid files: ${invalidFilesList.length}`);
    }

    if (validFiles.length > 0) {
      const fileList = validFiles.map((f) => f.file);
      log.info('handleDrop', `Dropping ${fileList.length} valid files`);

      if (validFiles.length > BATCH_IMPORT_DEFAULTS.maxFiles) {
        showWarning('文件数量限制', `最多导入 ${BATCH_IMPORT_DEFAULTS.maxFiles} 个文件`);
        onFilesDropped?.(fileList.slice(0, BATCH_IMPORT_DEFAULTS.maxFiles), dropPosition);
      } else {
        onFilesDropped?.(fileList, dropPosition);
      }
    }
  }, [validateFiles, onFilesDropped, showError, showWarning]);

  const handleCloseErrorList = useCallback(() => {
    setInvalidFiles([]);
  }, []);

  return (
    <div
      ref={dropRef}
      className={`file-drop-zone ${isDragging ? 'file-drop-zone--dragging' : ''} ${className}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {isDragging && (
        <div className="file-drop-zone__overlay">
          <div className="file-drop-zone__indicator">
            <div className="file-drop-zone__icon">📁</div>
            <div className="file-drop-zone__text">释放以导入文件</div>
          </div>
        </div>
      )}

      {invalidFiles.length > 0 && (
        <div className="file-drop-zone__error-modal">
          <div className="file-drop-zone__error-header">
            <span>导入失败</span>
            <button onClick={handleCloseErrorList}>×</button>
          </div>
          <div className="file-drop-zone__error-list">
            {invalidFiles.map((f, index) => (
              <div key={index} className="file-drop-zone__error-item">
                <span className="file-drop-zone__error-filename">{f.file.name}</span>
                <span className="file-drop-zone__error-message">{f.error}</span>
              </div>
            ))}
          </div>
          <div className="file-drop-zone__error-footer">
            <button onClick={handleCloseErrorList}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
};

FileDropZoneInner.displayName = 'FileDropZoneInner';

export const FileDropZone = memo(FileDropZoneInner);

FileDropZone.displayName = 'FileDropZone';
