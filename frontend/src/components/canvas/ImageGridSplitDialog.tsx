import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '@/components/ui/primitives';
import {
  IMAGE_GRID_SPLIT_MAX_SIZE,
  IMAGE_GRID_SPLIT_MIN_SIZE,
  validateImageGridSplitGrid,
  type ImageGridSplitGrid,
} from '@/services/image/image-grid-split';

interface ImageGridSplitDialogProps {
  isOpen: boolean;
  fileName?: string;
  isProcessing?: boolean;
  onClose: () => void;
  onConfirm: (grid: ImageGridSplitGrid) => void;
}

function parseGridValue(value: string): number {
  return Number(value);
}

export const ImageGridSplitDialog = memo<ImageGridSplitDialogProps>(({
  isOpen,
  fileName,
  isProcessing = false,
  onClose,
  onConfirm,
}) => {
  const [rows, setRows] = useState('2');
  const [cols, setCols] = useState('2');

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setRows('2');
    setCols('2');
  }, [isOpen]);

  const validationError = useMemo((): string | null => {
    try {
      validateImageGridSplitGrid({
        rows: parseGridValue(rows),
        cols: parseGridValue(cols),
      });
      return null;
    } catch {
      return `行数和列数必须是 ${IMAGE_GRID_SPLIT_MIN_SIZE}-${IMAGE_GRID_SPLIT_MAX_SIZE} 的整数`;
    }
  }, [cols, rows]);

  const handleConfirm = useCallback((): void => {
    const grid = validateImageGridSplitGrid({
      rows: parseGridValue(rows),
      cols: parseGridValue(cols),
    });
    onConfirm(grid);
  }, [cols, onConfirm, rows]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="自定义拆分"
      size="sm"
      footer={(
        <div className="image-grid-split-dialog__actions">
          <Button variant="secondary" size="sm" disabled={isProcessing} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={isProcessing}
            disabled={Boolean(validationError)}
            onClick={handleConfirm}
          >
            拆分
          </Button>
        </div>
      )}
    >
      <div className="image-grid-split-dialog">
        <div className="image-grid-split-dialog__target" title={fileName}>
          {fileName ?? '图片节点'}
        </div>
        <div className="image-grid-split-dialog__fields">
          <label className="image-grid-split-dialog__field">
            <span>行数</span>
            <input
              className="input"
              type="number"
              min={IMAGE_GRID_SPLIT_MIN_SIZE}
              max={IMAGE_GRID_SPLIT_MAX_SIZE}
              step={1}
              value={rows}
              disabled={isProcessing}
              onChange={(event) => setRows(event.currentTarget.value)}
            />
          </label>
          <label className="image-grid-split-dialog__field">
            <span>列数</span>
            <input
              className="input"
              type="number"
              min={IMAGE_GRID_SPLIT_MIN_SIZE}
              max={IMAGE_GRID_SPLIT_MAX_SIZE}
              step={1}
              value={cols}
              disabled={isProcessing}
              onChange={(event) => setCols(event.currentTarget.value)}
            />
          </label>
        </div>
        {validationError ? (
          <div className="image-grid-split-dialog__error" role="alert">
            {validationError}
          </div>
        ) : null}
      </div>
    </Modal>
  );
});

ImageGridSplitDialog.displayName = 'ImageGridSplitDialog';
