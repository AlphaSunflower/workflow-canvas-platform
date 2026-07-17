import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useViewport } from 'reactflow';

import type { AnyNodeData, Workflow } from '../../types';
import { pickTextFile } from '../../services/browser-file';
import { createModuleLogger } from '../../utils';
import { useWorkflowActions } from '../context/useWorkflowActions';
import { useWorkflowContext } from '../context/useWorkflowContext';
import { WorkflowManagerModal } from './WorkflowManagerModal';
import { runToolbarSave, shouldTriggerToolbarSaveShortcut } from './toolbar-save';
import './Toolbar.css';

const log = createModuleLogger('toolbar');

const DEFAULT_TOOLBAR_POSITION = { x: 0, y: 0 };
const DRAG_THRESHOLD = 4;

function formatLastSavedAt(lastSavedAt: number | null): string {
  if (!lastSavedAt) {
    return '\u672a\u4fdd\u5b58';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(lastSavedAt);
}

const Toolbar: React.FC = () => {
  const { zoom } = useViewport();
  const actions = useWorkflowActions();
  const { state, runtime } = useWorkflowContext();
  const { zoomIn, zoomOut, fitView } = useReactFlow<AnyNodeData>();
  const dragMovedRef = useRef(false);
  const suppressCollapsedClickRef = useRef(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState(DEFAULT_TOOLBAR_POSITION);
  const [isWorkflowManagerOpen, setIsWorkflowManagerOpen] = useState(false);

  const saveButtonTitle = state.canSave
    ? '\u4fdd\u5b58\u5230\u540e\u7aef (Ctrl+S)'
    : state.saveBlockedReason ?? '\u5f53\u524d\u4e0d\u53ef\u4fdd\u5b58';

  const zoomPercent = Math.round(zoom * 100);
  const saveStatus = useMemo(() => {
    if (!state.canSave && state.saveBlockedReason) {
      return state.saveBlockedReason;
    }

    if (state.isSaving) {
      return '\u4fdd\u5b58\u4e2d';
    }

    if (state.isDirty) {
      return '\u6709\u672a\u4fdd\u5b58\u66f4\u6539';
    }

    return `\u5df2\u4fdd\u5b58 ${formatLastSavedAt(state.lastSavedAt)}`;
  }, [state.canSave, state.isDirty, state.isSaving, state.lastSavedAt, state.saveBlockedReason]);

  const handleZoomIn = useCallback(() => {
    zoomIn({ duration: 150 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    zoomOut({ duration: 150 });
  }, [zoomOut]);

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.16, duration: 200 });
  }, [fitView]);

  const handleSave = useCallback(async () => {
    await runToolbarSave(actions, {
      canSave: state.canSave,
      saveBlockedReason: state.saveBlockedReason,
    }, runtime.notification);
  }, [actions, runtime.notification, state.canSave, state.saveBlockedReason]);

  useEffect(() => {
    const handleGlobalSaveShortcut = (event: KeyboardEvent): void => {
      if (!shouldTriggerToolbarSaveShortcut(event)) {
        return;
      }

      event.preventDefault();
      void handleSave();
    };

    document.addEventListener('keydown', handleGlobalSaveShortcut);
    return (): void => {
      document.removeEventListener('keydown', handleGlobalSaveShortcut);
    };
  }, [handleSave]);

  const handleSwitchBeforeOpen = useCallback(async (request: {
    targetKind: 'workflow' | 'new-blank';
    targetLabel: string;
  }): Promise<boolean> => {
    return actions.confirmBeforeWorkflowSwitch({
      ...request,
      canSave: state.canSave,
      saveBlockedReason: state.saveBlockedReason,
      hasMeaningfulChanges: state.nodeCount > 0 || state.connectionCount > 0,
      isDraftWithoutMaterialization: !state.hasMaterializedCanvas,
    });
  }, [
    actions,
    state.canSave,
    state.hasMaterializedCanvas,
    state.connectionCount,
    state.nodeCount,
    state.saveBlockedReason,
  ]);

  const handleImportLocal = useCallback(async () => {
    try {
      const pickedFile = await pickTextFile('.json,application/json');
      if (!pickedFile.success) {
        throw pickedFile.error;
      }

      if (!pickedFile.data) {
        return;
      }

      await actions.importLocalArchive(pickedFile.data.content);
      runtime.notification.showSuccess('\u5bfc\u5165\u6210\u529f', `\u5df2\u5bfc\u5165\u672c\u5730\u5b58\u6863\uff1a${pickedFile.data.file.name}`);
      log.info('handleImportLocal', `Workflow imported from local archive: ${pickedFile.data.file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '\u5bfc\u5165\u672c\u5730\u5b58\u6863\u5931\u8d25';
      runtime.notification.showError('\u5bfc\u5165\u5931\u8d25', message);
      log.error('handleImportLocal', 'Failed to import local archive', error instanceof Error ? error : undefined);
    }
  }, [actions, runtime.notification]);

  const handleExportLocal = useCallback(async () => {
    try {
      await actions.exportLocalArchive();
      runtime.notification.showSuccess('\u5bfc\u51fa\u6210\u529f', '\u5f53\u524d\u753b\u5e03\u5df2\u5bfc\u51fa\u4e3a\u672c\u5730 JSON \u5b58\u6863\u3002');
      log.info('handleExportLocal', 'Workflow exported to local archive');
    } catch (error) {
      const message = error instanceof Error ? error.message : '\u5bfc\u51fa\u672c\u5730\u5b58\u6863\u5931\u8d25';
      runtime.notification.showError('\u5bfc\u51fa\u5931\u8d25', message);
      log.error('handleExportLocal', 'Failed to export local archive', error instanceof Error ? error : undefined);
    }
  }, [actions, runtime.notification]);

  const handleOpenWorkflowManager = useCallback(() => {
    setIsWorkflowManagerOpen(true);
  }, []);

  const handleCloseWorkflowManager = useCallback(() => {
    setIsWorkflowManagerOpen(false);
  }, []);

  const handleCreateManagedBlank = useCallback(() => {
    actions.createWorkflow(runtime.projectId);
  }, [actions, runtime.projectId]);

  const handleOpenManagedWorkflow = useCallback((workflow: Workflow) => {
    actions.loadWorkflow(workflow);
  }, [actions]);

  const handlePatchCurrentWorkflow = useCallback((workflow: Workflow) => {
    actions.patchCurrentWorkflow((currentWorkflow) => ({
      ...currentWorkflow,
      persistedWorkflowId: workflow.persistedWorkflowId,
      name: workflow.name,
      version: workflow.version,
      ownerUserId: workflow.ownerUserId,
      groupId: workflow.groupId ?? null,
      workflowGroupId: workflow.workflowGroupId ?? workflow.groupId ?? null,
      containerKey: workflow.containerKey,
      isAutoNamed: workflow.isAutoNamed,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      timestamp: {
        ...currentWorkflow.timestamp,
        updated: workflow.timestamp.updated,
      },
    }));
  }, [actions]);

  const handleDeleteCurrentWorkflow = useCallback(() => {
    actions.createWorkflow(runtime.projectId);
    runtime.notification.showInfo('\u5f53\u524d\u753b\u5e03\u5df2\u5220\u9664', '\u5df2\u8fd4\u56de\u65b0\u7684\u7a7a\u767d\u753b\u5e03\u3002');
  }, [actions, runtime.notification, runtime.projectId]);

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed((current) => !current);
  }, []);

  const handleCollapsedClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressCollapsedClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressCollapsedClickRef.current = false;
      return;
    }

    handleToggleCollapse();
  }, [handleToggleCollapse]);

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const startPointer = { x: event.clientX, y: event.clientY };
    const startPosition = { ...toolbarPosition };
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    dragMovedRef.current = false;
    setIsDragging(true);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startPointer.x;
      const deltaY = moveEvent.clientY - startPointer.y;

      if (!dragMovedRef.current && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
        dragMovedRef.current = true;
      }

      setToolbarPosition({
        x: startPosition.x + deltaX,
        y: startPosition.y + deltaY,
      });
    };

    const handlePointerUp = (): void => {
      setIsDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      target.releasePointerCapture?.(pointerId);

      if (dragMovedRef.current) {
        suppressCollapsedClickRef.current = true;
      }

      window.setTimeout(() => {
        dragMovedRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    target.setPointerCapture?.(pointerId);
  }, [toolbarPosition]);

  const toolbarContent = isCollapsed ? (
    <button
      className={[
        'toolbar',
        'toolbar--collapsed',
        isDragging ? 'toolbar--dragging' : '',
      ].filter(Boolean).join(' ')}
      type="button"
      style={{
        transform: `translate(calc(-50% + ${toolbarPosition.x}px), ${toolbarPosition.y}px)`,
      }}
      onClick={handleCollapsedClick}
      onPointerDown={handleDragStart}
      title={'\u5c55\u5f00\u5de5\u5177\u680f'}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  ) : (
    <div
      className={[
        'toolbar',
        isDragging ? 'toolbar--dragging' : '',
      ].filter(Boolean).join(' ')}
      style={{
        transform: `translate(calc(-50% + ${toolbarPosition.x}px), ${toolbarPosition.y}px)`,
      }}
    >
      <div
        className="toolbar__handle"
        title={'\u62d6\u62fd\u5de5\u5177\u680f'}
        onPointerDown={handleDragStart}
      >
        <span className="toolbar__handle-dot" />
        <span className="toolbar__handle-dot" />
        <span className="toolbar__handle-dot" />
        <span className="toolbar__handle-dot" />
        <span className="toolbar__handle-dot" />
        <span className="toolbar__handle-dot" />
      </div>

      <div className="toolbar__divider" />

      <div className="toolbar__main">
        <div className="toolbar__group">
          <button className="icon-btn" disabled title={'\u64a4\u9500\u6682\u672a\u5b9e\u73b0'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button className="icon-btn" disabled title={'\u91cd\u505a\u6682\u672a\u5b9e\u73b0'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </button>
        </div>

        <div className="toolbar__divider" />

        <div className="toolbar__group">
          <button className="icon-btn" onClick={handleZoomOut} title={'\u7f29\u5c0f (-)'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <button className="icon-btn" onClick={handleFitView} title={'\u9002\u5e94\u89c6\u56fe (Ctrl+1)'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
          </button>
          <button className="icon-btn" onClick={handleZoomIn} title={'\u653e\u5927 (+)'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
        </div>

        <div className="toolbar__divider" />

        <div className="toolbar__group">
          <button
            className="btn btn--secondary btn--sm"
            onClick={handleOpenWorkflowManager}
            title={'\u6253\u5f00\u753b\u5e03\u7ba1\u7406\u754c\u9762'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {'\u753b\u5e03'}
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={handleSave}
            title={saveButtonTitle}
            disabled={!state.canSave}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            {state.isSaving ? '\u4fdd\u5b58\u4e2d' : !state.canSave ? '\u4e0d\u53ef\u4fdd\u5b58' : '\u4fdd\u5b58'}
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={handleImportLocal}
            title={'\u8f85\u52a9\u5bfc\u5165\u672c\u5730\u5b58\u6863\uff0c\u4e0d\u4f5c\u4e3a\u9ed8\u8ba4\u4fdd\u5b58\u8def\u5f84'}
          >
            {'\u8f85\u52a9\u5bfc\u5165'}
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={handleExportLocal}
            title={'\u8f85\u52a9\u5bfc\u51fa\u672c\u5730\u5b58\u6863\uff0c\u4e0d\u4f5c\u4e3a\u9ed8\u8ba4\u4fdd\u5b58\u8def\u5f84'}
          >
            {'\u8f85\u52a9\u5bfc\u51fa'}
          </button>
        </div>
      </div>

      <div className="toolbar__divider" />

      <div className="toolbar__status-slot" aria-label="toolbar-status-slot">
        <div className="toolbar__status-group">
          <span className="toolbar__status-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            <span>{`${state.nodeCount} \u8282\u70b9`}</span>
          </span>
          <span className="toolbar__status-divider" />
          <span className="toolbar__status-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            <span>{`${state.connectionCount} \u8fde\u7ebf`}</span>
          </span>
          <span className="toolbar__status-divider" />
          <span className="toolbar__status-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            <span>{`${zoomPercent}%`}</span>
          </span>
          <span className="toolbar__status-divider" />
          <span className="toolbar__status-item toolbar__status-item--save">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>{saveStatus}</span>
          </span>
        </div>
      </div>

      <div className="toolbar__divider" />

      <button
        className="icon-btn toolbar__collapse-button"
        type="button"
        onClick={handleToggleCollapse}
        title={'\u6298\u53e0\u5de5\u5177\u680f'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    </div>
  );

  return (
    <>
      {toolbarContent}
      <WorkflowManagerModal
        isOpen={isWorkflowManagerOpen}
        currentWorkflowId={state.persistedWorkflowId}
        currentWorkflowName={state.workflow?.name ?? null}
        onClose={handleCloseWorkflowManager}
        onCreateBlank={handleCreateManagedBlank}
        onOpenWorkflow={handleOpenManagedWorkflow}
        onCurrentWorkflowPatched={handlePatchCurrentWorkflow}
        onCurrentWorkflowDeleted={handleDeleteCurrentWorkflow}
        onBeforeSwitch={handleSwitchBeforeOpen}
        onNotifySuccess={runtime.notification.showSuccess}
        onNotifyError={runtime.notification.showError}
      />
    </>
  );
};

export default memo(Toolbar);
