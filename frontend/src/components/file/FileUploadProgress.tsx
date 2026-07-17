import React, { memo, useCallback } from 'react';
import { createModuleLogger } from '../../utils';
import type { FileIdString } from '../../types';

const log = createModuleLogger('file-upload-progress');

interface FileUploadProgressProps {
  fileId: FileIdString;
  filename: string;
  progress: number;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
  onCancel?: () => void;
  className?: string;
}

const FileUploadProgressInner: React.FC<FileUploadProgressProps> = ({ fileId, filename, progress, status, error, onCancel, className = '' }) => {
  const handleCancel = useCallback((): void => {
    onCancel?.();
    log.info('handleCancel', `Upload cancelled: ${fileId}`);
  }, [fileId, onCancel]);

  const getStatusIcon = (): string => {
    switch (status) {
      case 'uploading':
        return '⏳';
      case 'processing':
        return '⚙️';
      case 'completed':
        return '✅';
      case 'error':
        return '❌';
      default:
        return '📄';
    }
  };

  const getStatusText = (): string => {
    switch (status) {
      case 'uploading':
        return '上传中...';
      case 'processing':
        return '处理中...';
      case 'completed':
        return '完成';
      case 'error':
        return '失败';
      default:
        return '';
    }
  };

  const getProgressColor = (): string => {
    switch (status) {
      case 'uploading':
        return '#3B82F6';
      case 'processing':
        return '#8B5CF6';
      case 'completed':
        return '#10B981';
      case 'error':
        return '#EF4444';
      default:
        return '#6B7280';
    }
  };

  return (
    <div className={`file-upload-progress file-upload-progress--${status} ${className}`}>
      <div className="file-upload-progress__header">
        <span className="file-upload-progress__icon">{getStatusIcon()}</span>
        <span className="file-upload-progress__filename">{filename}</span>
        <span className="file-upload-progress__status">{getStatusText()}</span>
        {status === 'uploading' && onCancel && <button className="file-upload-progress__cancel" onClick={handleCancel} title="取消上传">×</button>}
      </div>
      {status !== 'completed' && status !== 'error' && <div className="file-upload-progress__bar-container"><div className="file-upload-progress__bar" style={{ width: `${progress}%`, backgroundColor: getProgressColor() }} /></div>}
      {status !== 'completed' && status !== 'error' && <div className="file-upload-progress__percentage">{progress}%</div>}
      {error && <div className="file-upload-progress__error">{error}</div>}
    </div>
  );
};

FileUploadProgressInner.displayName = 'FileUploadProgressInner';
export const FileUploadProgress = memo(FileUploadProgressInner);
FileUploadProgress.displayName = 'FileUploadProgress';
