import { memo, useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import {
  getExecutionDetailLines,
  getExecutionErrorMessage,
  getExecutionStatusLabel,
} from '@/constants';
import type { ExecutionRuntimeNodeState } from '@/execution-runtime/execution-runtime.types';

export interface NodeExecutionStatusProps {
  execution: ExecutionRuntimeNodeState | null;
  className?: string;
  compact?: boolean;
  showProgress?: boolean;
}

function getBadgeVariant(status: ExecutionRuntimeNodeState['status']): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'queued':
      return 'warning';
    case 'processing':
      return 'primary';
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'cancelled':
    default:
      return 'default';
  }
}

const NodeExecutionStatusInner = ({
  execution,
  className = '',
  compact = false,
  showProgress = true,
}: NodeExecutionStatusProps): JSX.Element | null => {
  const detailLines = useMemo(
    () => (execution ? getExecutionDetailLines(execution) : []),
    [execution],
  );
  const errorMessage = useMemo(
    () => (execution ? getExecutionErrorMessage(execution) : null),
    [execution],
  );

  if (!execution?.status) {
    return null;
  }

  const title = getExecutionStatusLabel(execution.status) ?? execution.status;
  const rootClassName = [
    'execution-status',
    'execution-status--node',
    compact ? 'execution-status--compact' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClassName}>
      <div className="execution-status__header">
        <Badge variant={getBadgeVariant(execution.status)} className="execution-status__badge">
          {title}
        </Badge>
        <span className="execution-status__progress-value">{Math.round(execution.progress)}%</span>
      </div>

      {showProgress && (execution.status === 'processing' || execution.status === 'queued') && (
        <ProgressBar value={execution.progress} className="execution-status__progress" />
      )}

      {!compact && execution.message && (
        <div className="execution-status__message">{execution.message}</div>
      )}

      {!compact && detailLines.length > 0 && (
        <div className="execution-status__details">
          {detailLines.map((line, index) => (
            <div key={`${line}-${index}`} className="execution-status__detail-line">{line}</div>
          ))}
        </div>
      )}

      {!compact && errorMessage && (
        <div className="execution-status__error">{errorMessage}</div>
      )}
    </div>
  );
};

NodeExecutionStatusInner.displayName = 'NodeExecutionStatus';

export const NodeExecutionStatus = memo(NodeExecutionStatusInner);
