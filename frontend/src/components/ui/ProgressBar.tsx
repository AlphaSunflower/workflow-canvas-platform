import { memo } from 'react';

interface ProgressBarProps {
  value: number;
  max?: number;
  showLabel?: boolean;
  className?: string;
}

export const ProgressBar = memo<ProgressBarProps>(({
  value,
  max = 100,
  showLabel = false,
  className = '',
}) => {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={`progress-bar-wrapper ${className}`.trim()}>
      <div className="progress-bar">
        <div
          className="progress-bar__fill"
          style={{ width: `${percent}%` }}
        />
      </div>
      {showLabel && (
        <span className="progress-bar__label">{Math.round(percent)}%</span>
      )}
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';
