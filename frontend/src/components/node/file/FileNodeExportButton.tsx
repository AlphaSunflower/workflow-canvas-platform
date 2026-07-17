import React from 'react';

export interface FileNodeExportButtonProps {
  isExporting: boolean;
  onExport: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function stopContextMenuEvent(event: React.MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export const FileNodeExportButton: React.FC<FileNodeExportButtonProps> = ({ isExporting, onExport }) => (
  <button
    className="file-node__save-button node-control-btn node-control-btn--save nodrag nopan"
    onMouseDown={stopPointerEvent}
    onClick={onExport}
    onContextMenu={stopContextMenuEvent}
    title={isExporting ? '保存中' : '保存'}
    disabled={isExporting}
    type="button"
  >
    {isExporting ? '…' : '↓'}
  </button>
);

FileNodeExportButton.displayName = 'FileNodeExportButton';
