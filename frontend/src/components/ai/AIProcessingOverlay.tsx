import React, { memo, useMemo } from 'react';
import { AITaskStatus } from './AITaskStatus';
import type { TaskStatus } from '../../types';

interface AIProcessingOverlayProps {
  taskId: string;
  status: TaskStatus;
  progress?: number;
  message?: string;
  onCancel?: () => void;
  className?: string;
}

const AIProcessingOverlayInner: React.FC<AIProcessingOverlayProps> = ({
  taskId,
  status,
  progress = 0,
  message,
  onCancel,
  className = '',
}) => {
  const isActive = status === 'queued' || status === 'processing';

  const overlayStyle = useMemo((): React.CSSProperties => ({
    opacity: isActive ? 1 : 0,
    pointerEvents: isActive ? 'auto' : 'none',
  }), [isActive]);

  const progressText = useMemo(() => {
    if (status === 'queued') return '排队中...';
    if (status === 'processing') {
      if (message) return message;
      return `处理中... ${progress}%`;
    }
    return '';
  }, [status, progress, message]);

  if (!isActive) {
    return null;
  }

  return (
    <div className={`ai-processing-overlay ${className}`} style={overlayStyle}>
      <div className="ai-processing-overlay__backdrop" />
      
      <div className="ai-processing-overlay__border" />
      
      <div className="ai-processing-overlay__content">
        <div className="ai-processing-overlay__spinner" />
        <div className="ai-processing-overlay__text">{progressText}</div>
        
        {onCancel && (
          <button
            className="ai-processing-overlay__cancel-btn"
            onClick={onCancel}
          >
            取消
          </button>
        )}
      </div>

      <AITaskStatus
        taskId={taskId}
        status={status}
        progress={progress}
        message={message}
        onCancel={onCancel}
        className="ai-processing-overlay__status"
      />
    </div>
  );
};

AIProcessingOverlayInner.displayName = 'AIProcessingOverlayInner';

export const AIProcessingOverlay = memo(AIProcessingOverlayInner);

AIProcessingOverlay.displayName = 'AIProcessingOverlay';
