import React from 'react';
import type { StoryboardShotData } from '@/types';
import type { StoryboardMediaStatusKind } from './shot-card.shared';

export interface StoryboardStatusBadgeProps {
  kind: StoryboardMediaStatusKind;
  status: StoryboardShotData['imageGenStatus'];
  text?: string;
  compact?: boolean;
}

export const StoryboardStatusBadge: React.FC<StoryboardStatusBadgeProps> = ({
  kind,
  status,
  text,
  compact = false,
}) => {
  const fallbackText = kind === 'image'
    ? status === 'idle' ? '图片待生成' : `图片 ${status}`
    : status === 'idle' ? '视频待生成' : `视频 ${status}`;

  return (
    <span
      className={[
        'ai-storyboard-status-badge',
        `ai-storyboard-status-badge--${kind}`,
        `ai-storyboard-status-badge--${status}`,
        compact ? 'ai-storyboard-status-badge--compact' : '',
      ].filter(Boolean).join(' ')}
      title={text ?? fallbackText}
    >
      <span className="ai-storyboard-status-badge__text">
        {text ?? fallbackText}
      </span>
    </span>
  );
};
