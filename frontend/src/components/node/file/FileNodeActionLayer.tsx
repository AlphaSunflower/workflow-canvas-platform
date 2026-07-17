import React, { memo } from 'react';

import { FileNodeExportButton } from './FileNodeExportButton';

interface FileNodeActionLayerProps {
  mounted: boolean;
  isExporting: boolean;
  onRebind?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onRotateStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onExport: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDelete: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function stopContextMenuEvent(event: React.MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export const FileNodeActionLayer = memo<FileNodeActionLayerProps>(({
  mounted,
  isExporting,
  onRebind,
  onRotateStart,
  onExport,
  onDelete,
  onResizeStart,
}) => {
  if (!mounted) {
    return null;
  }

  return (
    <>
      <button
        className="file-node__rotate-handle node-control-btn node-control-btn--rotate nodrag nopan"
        onMouseDown={stopPointerEvent}
        onPointerDown={onRotateStart}
        onContextMenu={stopContextMenuEvent}
        title="旋转"
        type="button"
      >
        {'↻'}
      </button>
      <FileNodeExportButton
        isExporting={isExporting}
        onExport={onExport}
      />
      {onRebind ? (
        <button
          className="file-node__rebind-button node-control-btn node-control-btn--save nodrag nopan"
          onMouseDown={stopPointerEvent}
          onClick={onRebind}
          onContextMenu={stopContextMenuEvent}
          title="重新关联本地文件"
          type="button"
        >
          {'↺'}
        </button>
      ) : null}
      <button
        className="file-node__delete-button node-control-btn node-control-btn--delete nodrag nopan"
        onMouseDown={stopPointerEvent}
        onClick={onDelete}
        onContextMenu={stopContextMenuEvent}
        title="删除"
        type="button"
      >
        {'×'}
      </button>
      <button
        className="file-node__resize-handle node-resize-handle nodrag nopan"
        onMouseDown={stopPointerEvent}
        onPointerDown={onResizeStart}
        onContextMenu={stopContextMenuEvent}
        title="缩放"
        type="button"
      />
    </>
  );
});

FileNodeActionLayer.displayName = 'FileNodeActionLayer';
