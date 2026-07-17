export interface CanvasImportProgressState {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  status: 'running' | 'completed';
  message: string;
}

export function buildRunningImportProgressMessage(processed: number, total: number): string {
  return `正在导入 ${processed} / ${total}`;
}

export function buildCompletedImportProgress(
  current: CanvasImportProgressState,
  completed: number,
  failed: number,
): CanvasImportProgressState {
  return {
    ...current,
    completed,
    failed,
    status: 'completed',
    message: failed > 0
      ? `导入完成，成功 ${completed} 个，失败 ${failed} 个`
      : `导入完成，共导入 ${completed} 个文件`,
  };
}

export function getCanvasImportProgressProcessed(
  importProgress: CanvasImportProgressState | null,
): number {
  if (!importProgress) {
    return 0;
  }

  return importProgress.completed + importProgress.failed;
}

export function getCanvasImportProgressPercent(
  importProgress: CanvasImportProgressState | null,
): number {
  if (!importProgress) {
    return 0;
  }

  const processed = getCanvasImportProgressProcessed(importProgress);
  return Math.round((processed / Math.max(importProgress.total, 1)) * 100);
}
