import { imageImportSessionStore } from './image-import-session-store';
import { imageOriginalSourceRegistry } from './image-original-source-registry';
import { imageThumbnailRuntimeStore } from './image-thumbnail-runtime-store';
import { recordCanvasImagePreviewLifecycle } from '@/utils/performance';
import type {
  ImageImportPreviewBeginOptions,
  ImageImportPreviewFailOptions,
  ImageImportPreviewListener,
  ImageImportPreviewProcessingNodeIds,
  ImageImportPreviewResolveOptions,
  ImageImportPreviewSnapshot,
  ImageImportPreviewStatus,
} from './image-import-preview.types';

function mapRuntimeStatusToPreviewStatus(
  status: 'idle' | 'loading' | 'ready' | 'error' | undefined,
): ImageImportPreviewStatus {
  if (!status) {
    return 'cleared';
  }

  if (status === 'loading') {
    return 'processing';
  }

  if (status === 'ready' || status === 'error') {
    return status;
  }

  return 'cleared';
}

class ImageImportPreviewService {
  private readonly emptySnapshots = new Map<string, ImageImportPreviewSnapshot>();
  private readonly snapshots = new Map<string, ImageImportPreviewSnapshot>();
  private readonly processingNodeIds = new Set<string>();
  private readonly processingListeners = new Set<ImageImportPreviewListener>();
  private processingSnapshot: ImageImportPreviewProcessingNodeIds = Object.freeze([]);

  private updateProcessingNode(nodeId: string, isProcessing: boolean): void {
    const changed = isProcessing
      ? !this.processingNodeIds.has(nodeId)
      : this.processingNodeIds.delete(nodeId);
    if (!changed) {
      return;
    }

    if (isProcessing) {
      this.processingNodeIds.add(nodeId);
    }

    this.processingSnapshot = Object.freeze(Array.from(this.processingNodeIds).sort());
    this.processingListeners.forEach((listener) => listener());
  }

  begin(nodeId: string, options: ImageImportPreviewBeginOptions): ImageImportPreviewSnapshot {
    if (import.meta.env?.DEV) {
      recordCanvasImagePreviewLifecycle({
        nodeId,
        fileId: options.fileId,
        sessionId: options.sessionId,
        eventKind: 'preview-begin',
        placeholder: 'loading',
      });
    }

    if (options.sessionId) {
      imageImportSessionStore.bind(options.sessionId, nodeId, options.fileId);
    }

    if (options.file) {
      imageOriginalSourceRegistry.registerLocalFile(nodeId, options.fileId, options.file, {
        workflowId: options.workflowId,
      });
    }

    imageThumbnailRuntimeStore.upsert(nodeId, {
      sessionId: options.sessionId,
      status: 'loading',
      error: undefined,
      failureCode: undefined,
      failureMessage: undefined,
      retryable: undefined,
      failureDetail: undefined,
      lastFailureCode: undefined,
    });
    this.updateProcessingNode(nodeId, true);

    return this.getSnapshot(nodeId, {
      sessionId: options.sessionId,
      fileId: options.fileId,
    });
  }

  resolve(nodeId: string, options: ImageImportPreviewResolveOptions): ImageImportPreviewSnapshot {
    if (import.meta.env?.DEV) {
      recordCanvasImagePreviewLifecycle({
        nodeId,
        fileId: options.fileId,
        sessionId: options.sessionId,
        eventKind: 'preview-ready',
        placeholder: 'ready',
      });
    }

    if (options.sessionId && options.fileId) {
      imageImportSessionStore.bind(options.sessionId, nodeId, options.fileId);
    }

    imageThumbnailRuntimeStore.upsert(nodeId, {
      sessionId: options.sessionId,
      blob: options.blob,
      objectUrl: options.objectUrl,
      objectUrlOwner: 'thumbnail-store',
      width: options.width,
      height: options.height,
      mimeType: options.mimeType,
      status: 'ready',
      error: undefined,
      failureCode: undefined,
      failureMessage: undefined,
      retryable: undefined,
      failureDetail: undefined,
      lastFailureCode: undefined,
    });
    this.updateProcessingNode(nodeId, false);

    return this.getSnapshot(nodeId, {
      sessionId: options.sessionId,
      fileId: options.fileId,
    });
  }

  fail(nodeId: string, options: ImageImportPreviewFailOptions): ImageImportPreviewSnapshot {
    if (import.meta.env?.DEV) {
      recordCanvasImagePreviewLifecycle({
        nodeId,
        fileName: options.fileName,
        fileId: options.fileId,
        sessionId: options.sessionId,
        eventKind: 'preview-failed',
        error: options.error,
        placeholder: 'unavailable',
        detail: {
          failureCode: options.failureCode ?? options.detail?.failureCode,
          failureStage: options.detail?.failureStage,
          retryable: options.retryable ?? options.detail?.retryable,
          message: options.message ?? options.detail?.message,
          durationMs: options.detail?.durationMs,
          queueWaitMs: options.detail?.queueWaitMs,
          executeMs: options.detail?.executeMs,
          timeoutMs: options.detail?.timeoutMs,
          fileName: options.fileName,
          fileSize: options.fileSize,
          source: options.source,
        },
      });
    }

    if (options.sessionId && options.fileId) {
      imageImportSessionStore.bind(options.sessionId, nodeId, options.fileId);
    }

    imageThumbnailRuntimeStore.upsert(nodeId, {
      sessionId: options.sessionId,
      status: 'error',
      error: options.error,
      failureCode: options.failureCode ?? options.detail?.failureCode,
      failureMessage: options.message ?? options.detail?.message,
      retryable: options.retryable ?? options.detail?.retryable,
      failureDetail: options.detail,
      attemptCount: options.attemptCount,
      lastFailureCode: options.failureCode ?? options.detail?.failureCode,
    });
    this.updateProcessingNode(nodeId, false);

    return this.getSnapshot(nodeId, {
      sessionId: options.sessionId,
      fileId: options.fileId,
    });
  }

  clear(nodeId: string): void {
    if (import.meta.env?.DEV) {
      recordCanvasImagePreviewLifecycle({
        nodeId,
        eventKind: 'preview-cleared',
      });
    }

    imageThumbnailRuntimeStore.clearNode(nodeId);
    imageImportSessionStore.clearNode(nodeId);
    this.updateProcessingNode(nodeId, false);
    this.snapshots.delete(nodeId);
    this.emptySnapshots.delete(nodeId);
  }

  clearAll(): void {
    imageThumbnailRuntimeStore.clearAll();
    imageImportSessionStore.clearAll();
    this.snapshots.clear();
    this.emptySnapshots.clear();

    if (this.processingNodeIds.size > 0) {
      this.processingNodeIds.clear();
      this.processingSnapshot = Object.freeze([]);
      this.processingListeners.forEach((listener) => listener());
    }
  }

  subscribe(nodeId: string, listener: () => void): () => void {
    return imageThumbnailRuntimeStore.subscribe(nodeId, listener);
  }

  subscribeProcessingNodeIds(listener: ImageImportPreviewListener): () => void {
    this.processingListeners.add(listener);

    return (): void => {
      this.processingListeners.delete(listener);
    };
  }

  getProcessingNodeIds(): ImageImportPreviewProcessingNodeIds {
    return this.processingSnapshot;
  }

  getSnapshot(
    nodeId: string,
    options: {
      sessionId?: string;
      fileId?: string;
    } = {},
  ): ImageImportPreviewSnapshot {
    const runtimeEntry = imageThumbnailRuntimeStore.get(nodeId);

    if (!runtimeEntry && !options.sessionId && !options.fileId) {
      const cached = this.emptySnapshots.get(nodeId);
      if (cached) {
        return cached;
      }

      const emptySnapshot: ImageImportPreviewSnapshot = {
        nodeId,
        sessionId: undefined,
        fileId: undefined,
        status: 'cleared',
        runtimeEntry: null,
      };
      this.emptySnapshots.set(nodeId, emptySnapshot);
      return emptySnapshot;
    }

    const nextSnapshot: ImageImportPreviewSnapshot = {
      nodeId,
      sessionId: options.sessionId ?? runtimeEntry?.sessionId,
      fileId: options.fileId,
      status: mapRuntimeStatusToPreviewStatus(runtimeEntry?.status),
      runtimeEntry,
    };
    const previousSnapshot = this.snapshots.get(nodeId);
    if (
      previousSnapshot &&
      previousSnapshot.sessionId === nextSnapshot.sessionId &&
      previousSnapshot.fileId === nextSnapshot.fileId &&
      previousSnapshot.status === nextSnapshot.status &&
      previousSnapshot.runtimeEntry === nextSnapshot.runtimeEntry
    ) {
      return previousSnapshot;
    }

    this.snapshots.set(nodeId, nextSnapshot);
    return nextSnapshot;
  }
}

export const imageImportPreviewService = new ImageImportPreviewService();
