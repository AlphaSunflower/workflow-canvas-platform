import type { ImageThumbnailFailureDetail } from '@/services/file/image-thumbnail-diagnostics.types';

export type ImageThumbnailRuntimeStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ImageThumbnailObjectUrlOwner = 'thumbnail-store' | 'external';

export interface ImageThumbnailRuntimeEntry {
  nodeId: string;
  sessionId?: string;
  blob?: Blob;
  objectUrl?: string;
  objectUrlOwner?: ImageThumbnailObjectUrlOwner;
  width?: number;
  height?: number;
  mimeType?: string;
  status: ImageThumbnailRuntimeStatus;
  error?: string;
  failureCode?: ImageThumbnailFailureDetail['failureCode'];
  failureMessage?: string;
  retryable?: boolean;
  failureDetail?: ImageThumbnailFailureDetail;
  attemptCount?: number;
  lastFailureCode?: ImageThumbnailFailureDetail['failureCode'];
  updatedAt: number;
}

function revokeObjectUrl(url: string | undefined): void {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function shouldRevokeObjectUrl(entry: Pick<ImageThumbnailRuntimeEntry, 'objectUrl' | 'objectUrlOwner'> | undefined): boolean {
  return Boolean(entry?.objectUrl) && entry?.objectUrlOwner !== 'external';
}

class ImageThumbnailRuntimeStore {
  private readonly entries = new Map<string, ImageThumbnailRuntimeEntry>();
  private readonly sessionNodeIds = new Map<string, Set<string>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly globalListeners = new Set<(nodeId: string) => void>();

  private rebindSession(nodeId: string, previousSessionId: string | undefined, nextSessionId: string | undefined): void {
    if (previousSessionId && previousSessionId !== nextSessionId) {
      const previousSessionNodes = this.sessionNodeIds.get(previousSessionId);
      previousSessionNodes?.delete(nodeId);
      if (previousSessionNodes && previousSessionNodes.size === 0) {
        this.sessionNodeIds.delete(previousSessionId);
      }
    }

    if (!nextSessionId) {
      return;
    }

    const sessionNodes = this.sessionNodeIds.get(nextSessionId) ?? new Set<string>();
    sessionNodes.add(nodeId);
    this.sessionNodeIds.set(nextSessionId, sessionNodes);
  }

  upsert(nodeId: string, entry: Omit<ImageThumbnailRuntimeEntry, 'nodeId' | 'updatedAt'>): ImageThumbnailRuntimeEntry {
    const previous = this.entries.get(nodeId);
    const nextObjectUrl = entry.objectUrl ?? previous?.objectUrl;
    const nextObjectUrlOwner = entry.objectUrl
      ? (entry.objectUrlOwner ?? 'thumbnail-store')
      : previous?.objectUrlOwner;

    if (previous?.objectUrl && previous.objectUrl !== nextObjectUrl && shouldRevokeObjectUrl(previous)) {
      revokeObjectUrl(previous.objectUrl);
    }

    const nextEntry: ImageThumbnailRuntimeEntry = {
      nodeId,
      blob: entry.blob ?? previous?.blob,
      objectUrl: nextObjectUrl,
      objectUrlOwner: nextObjectUrlOwner,
      width: entry.width ?? previous?.width,
      height: entry.height ?? previous?.height,
      mimeType: entry.mimeType ?? previous?.mimeType,
      sessionId: entry.sessionId ?? previous?.sessionId,
      status: entry.status,
      error: entry.error,
      failureCode: entry.failureCode,
      failureMessage: entry.failureMessage,
      retryable: entry.retryable,
      failureDetail: entry.failureDetail,
      attemptCount: entry.attemptCount ?? previous?.attemptCount,
      lastFailureCode: entry.lastFailureCode,
      updatedAt: Date.now(),
    };

    this.entries.set(nodeId, nextEntry);
    this.rebindSession(nodeId, previous?.sessionId, nextEntry.sessionId);

    this.emit(nodeId);
    return nextEntry;
  }

  subscribe(nodeId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(nodeId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(nodeId, listeners);

    return (): void => {
      const currentListeners = this.listeners.get(nodeId);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);
      if (currentListeners.size === 0) {
        this.listeners.delete(nodeId);
      }
    };
  }

  subscribeAll(listener: (nodeId: string) => void): () => void {
    this.globalListeners.add(listener);

    return (): void => {
      this.globalListeners.delete(listener);
    };
  }

  get(nodeId: string): Readonly<ImageThumbnailRuntimeEntry> | null {
    return this.entries.get(nodeId) ?? null;
  }

  getUrl(nodeId: string): string | undefined {
    return this.get(nodeId)?.objectUrl;
  }

  clearNode(nodeId: string): void {
    const entry = this.entries.get(nodeId);
    if (!entry) {
      return;
    }

    if (shouldRevokeObjectUrl(entry)) {
      revokeObjectUrl(entry.objectUrl);
    }
    this.entries.delete(nodeId);

    if (entry.sessionId) {
      const sessionNodes = this.sessionNodeIds.get(entry.sessionId);
      sessionNodes?.delete(nodeId);
      if (sessionNodes && sessionNodes.size === 0) {
        this.sessionNodeIds.delete(entry.sessionId);
      }
    }

    this.emit(nodeId);
  }

  clearSession(sessionId: string): void {
    const nodeIds = this.sessionNodeIds.get(sessionId);
    if (!nodeIds) {
      return;
    }

    Array.from(nodeIds).forEach((nodeId) => this.clearNode(nodeId));
    this.sessionNodeIds.delete(sessionId);
  }

  clearAll(): void {
    Array.from(this.entries.keys()).forEach((nodeId) => this.clearNode(nodeId));
    this.sessionNodeIds.clear();
  }

  private emit(nodeId: string): void {
    this.listeners.get(nodeId)?.forEach((listener) => listener());
    this.globalListeners.forEach((listener) => listener(nodeId));
  }
}

export const imageThumbnailRuntimeStore = new ImageThumbnailRuntimeStore();
