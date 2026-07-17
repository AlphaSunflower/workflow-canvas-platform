import { memo } from 'react';

import type { TaskHistoryListItem } from './task-history.types';
import { TaskHistoryArtifactPreview } from './TaskHistoryArtifactPreview';

interface CanvasTaskHistoryCardProps {
  item: TaskHistoryListItem;
  onOpenDetail?: (item: TaskHistoryListItem) => void;
}

function formatDateTime(value: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export const CanvasTaskHistoryCard = memo(({
  item,
  onOpenDetail,
}: CanvasTaskHistoryCardProps) => {
  const timeLabel = formatDateTime(item.createdAt);
  const title = item.nodeType || item.taskType || 'Task';
  const taskLabel = item.taskNo || item.taskId;

  return (
    <article
      className="canvas-task-history-card canvas-task-history-card--interactive"
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail?.(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetail?.(item);
        }
      }}
    >
      <header className="canvas-task-history-card__header">
        <div className="canvas-task-history-card__title-block">
          <div className="canvas-task-history-card__title-row">
            <h3 className="canvas-task-history-card__title" title={title}>
              {title}
            </h3>
          </div>
          <div className="canvas-task-history-card__meta-line">
            <span>{taskLabel}</span>
            {timeLabel && <span>{timeLabel}</span>}
          </div>
        </div>
      </header>

      <TaskHistoryArtifactPreview item={item} />
    </article>
  );
});

CanvasTaskHistoryCard.displayName = 'CanvasTaskHistoryCard';
