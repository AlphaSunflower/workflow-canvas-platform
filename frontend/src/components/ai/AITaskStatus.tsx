import React, { memo, useCallback } from 'react';
import { createModuleLogger } from '../../utils';
import type { TaskStatus } from '../../types';

const log = createModuleLogger('ai-task-status');

interface AITaskStatusProps {
  taskId: string;
  status: TaskStatus;
  progress?: number;
  message?: string;
  onCancel?: () => void;
  className?: string;
}

interface StatusConfig {
  icon: string;
  text: string;
  color: string;
  showProgress: boolean;
}

const AITaskStatusInner: React.FC<AITaskStatusProps> = ({ taskId, status, progress = 0, message, onCancel, className = '' }) => {
  const handleCancel = useCallback((): void => {
    onCancel?.();
    log.info('handleCancel', `Task cancelled: ${taskId}`);
  }, [taskId, onCancel]);

  const getStatusConfig = (): StatusConfig => {
    switch (status) {
      case 'queued':
        return { icon: '⏳', text: '排队中', color: '#F59E0B', showProgress: false };
      case 'processing':
        return { icon: '⚙️', text: '处理中', color: '#3B82F6', showProgress: true };
      case 'completed':
        return { icon: '✅', text: '已完成', color: '#10B981', showProgress: false };
      case 'failed':
        return { icon: '❌', text: '失败', color: '#EF4444', showProgress: false };
      case 'cancelled':
        return { icon: '🚫', text: '已取消', color: '#6B7280', showProgress: false };
      default:
        return { icon: '❔', text: '未知', color: '#6B7280', showProgress: false };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`ai-task-status ai-task-status--${status} ${className}`}>
      <div className="ai-task-status__header">
        <span className="ai-task-status__icon" style={{ color: config.color }}>{config.icon}</span>
        <span className="ai-task-status__status">{config.text}</span>
        {status === 'processing' && <span className="ai-task-status__progress">{progress}%</span>}
        {(status === 'queued' || status === 'processing') && onCancel && <button className="ai-task-status__cancel-btn" onClick={handleCancel} title="取消任务">取消</button>}
      </div>

      {config.showProgress && <div className="ai-task-status__progress-bar"><div className="ai-task-status__progress-fill" style={{ width: `${progress}%`, backgroundColor: config.color }} /></div>}
      {message && <div className="ai-task-status__message">{message}</div>}
    </div>
  );
};

AITaskStatusInner.displayName = 'AITaskStatusInner';
export const AITaskStatus = memo(AITaskStatusInner);
AITaskStatus.displayName = 'AITaskStatus';
