import { memo, useMemo, useState } from 'react';

import { CanvasTaskHistoryCard } from './CanvasTaskHistoryCard';
import { canvasTaskHistoryStore } from './canvas-task-history.store';
import { TaskHistoryDetailModal } from './TaskHistoryDetailModal';
import type { TaskHistoryListItem } from './task-history.types';

interface CanvasTaskHistoryPanelProps {
  workflowId: string | null;
  items: TaskHistoryListItem[];
  topOffset: number;
  isCollapsed: boolean;
  onToggle?: () => void;
  showToggle?: boolean;
  defaultSelectedTaskId?: string | null;
}

export const CanvasTaskHistoryPanel = memo(({
  workflowId,
  items,
  topOffset,
  isCollapsed,
  onToggle,
  showToggle = true,
  defaultSelectedTaskId = null,
}: CanvasTaskHistoryPanelProps) => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(defaultSelectedTaskId);
  const hasItems = items.length > 0;

  const selectedItem = useMemo(
    () => items.find((item) => item.taskId === selectedTaskId) ?? null,
    [items, selectedTaskId],
  );
  const selectedDetail = useMemo(
    () => (selectedTaskId ? canvasTaskHistoryStore.getTaskDetail(workflowId, selectedTaskId) : undefined),
    [selectedTaskId, workflowId],
  );

  return (
    <>
      <aside
        className={[
          'canvas-task-history-panel',
          isCollapsed ? 'canvas-task-history-panel--collapsed' : '',
        ].filter(Boolean).join(' ')}
        style={{ top: topOffset }}
        aria-label="任务历史"
      >
        {showToggle && onToggle && (
          <button
            type="button"
            className="canvas-task-history-panel__toggle"
            onClick={onToggle}
            aria-label={isCollapsed ? '展开任务历史面板' : '折叠任务历史面板'}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? '展开任务历史' : '折叠任务历史'}
          >
            <span className="canvas-task-history-panel__toggle-icon" aria-hidden="true">
              {isCollapsed ? '<' : '>'}
            </span>
          </button>
        )}

        <div className="canvas-task-history-panel__surface">
          <header className="canvas-task-history-panel__header">
            <div className="canvas-task-history-panel__title-block">
              <h2 className="canvas-task-history-panel__title">任务历史</h2>
              <p className="canvas-task-history-panel__subtitle">
                {hasItems ? `共 ${items.length} 条任务记录` : '当前画布暂无任务记录'}
              </p>
            </div>
            {hasItems && (
              <span className="canvas-task-history-panel__count" aria-label={`任务数量 ${items.length}`}>
                {items.length}
              </span>
            )}
          </header>

          <div className="canvas-task-history-panel__body">
            {hasItems ? (
              <div className="canvas-task-history-panel__card-list">
                {items.map((item) => (
                  <CanvasTaskHistoryCard
                    key={item.taskId}
                    item={item}
                    onOpenDetail={(nextItem) => {
                      setSelectedTaskId(nextItem.taskId);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="canvas-task-history-panel__empty">
                <div className="canvas-task-history-panel__empty-title">暂无任务历史</div>
                <div className="canvas-task-history-panel__empty-text">
                  当画布中的任务节点发起后端执行后，记录会按最新优先显示在这里。
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <TaskHistoryDetailModal
        isOpen={selectedItem !== null}
        workflowId={workflowId}
        item={selectedItem}
        cachedDetail={selectedDetail}
        onClose={() => {
          setSelectedTaskId(null);
        }}
      />
    </>
  );
});

CanvasTaskHistoryPanel.displayName = 'CanvasTaskHistoryPanel';
