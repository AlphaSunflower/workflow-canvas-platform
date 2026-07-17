import React, { memo, useMemo } from 'react';
import { useViewport } from 'reactflow';
import { useWorkflowContext } from '../context/useWorkflowContext';
import './StatusBar.css';

function formatLastSavedAt(lastSavedAt: number | null): string {
  if (!lastSavedAt) {
    return '未保存';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(lastSavedAt);
}

const StatusBar: React.FC = () => {
  const { zoom } = useViewport();
  const { state } = useWorkflowContext();
  const zoomPercent = Math.round(zoom * 100);

  const saveStatus = useMemo(() => {
    if (state.isSaving) {
      return '保存中';
    }

    if (state.isDirty) {
      return '有未保存更改';
    }

    return `已保存 ${formatLastSavedAt(state.lastSavedAt)}`;
  }, [state.isDirty, state.isSaving, state.lastSavedAt]);

  return (
    <div className="status-bar">
      <div className="status-bar__item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        <span>{state.nodeCount} 节点</span>
      </div>

      <div className="status-bar__divider" />

      <div className="status-bar__item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        <span>{state.connectionCount} 连线</span>
      </div>

      <div className="status-bar__divider" />

      <div className="status-bar__item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
        <span>{zoomPercent}%</span>
      </div>

      <div className="status-bar__divider" />

      <div className="status-bar__item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>{saveStatus}</span>
      </div>
    </div>
  );
};

export default memo(StatusBar);
