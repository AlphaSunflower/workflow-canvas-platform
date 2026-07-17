export interface ImageImportSessionEntry {
  sessionId: string;
  nodeId: string;
  fileId: string;
  cancelled: boolean;
  createdAt: number;
}

class ImageImportSessionStore {
  private readonly sessions = new Map<string, Map<string, ImageImportSessionEntry>>();

  bind(sessionId: string, nodeId: string, fileId: string): ImageImportSessionEntry {
    Array.from(this.sessions.entries()).forEach(([existingSessionId, sessionEntries]) => {
      if (existingSessionId === sessionId || !sessionEntries.has(nodeId)) {
        return;
      }

      sessionEntries.delete(nodeId);
      if (sessionEntries.size === 0) {
        this.sessions.delete(existingSessionId);
      }
    });

    const sessionEntries = this.sessions.get(sessionId) ?? new Map<string, ImageImportSessionEntry>();
    const previous = sessionEntries.get(nodeId);
    const entry: ImageImportSessionEntry = {
      sessionId,
      nodeId,
      fileId,
      cancelled: previous?.cancelled ?? false,
      createdAt: previous?.createdAt ?? Date.now(),
    };
    sessionEntries.set(nodeId, entry);
    this.sessions.set(sessionId, sessionEntries);
    return entry;
  }

  get(sessionId: string, nodeId: string): Readonly<ImageImportSessionEntry> | null {
    return this.sessions.get(sessionId)?.get(nodeId) ?? null;
  }

  isCancelled(sessionId: string, nodeId: string): boolean {
    return this.get(sessionId, nodeId)?.cancelled ?? false;
  }

  cancelSession(sessionId: string): void {
    const sessionEntries = this.sessions.get(sessionId);
    if (!sessionEntries) {
      return;
    }

    sessionEntries.forEach((entry, nodeId) => {
      sessionEntries.set(nodeId, {
        ...entry,
        cancelled: true,
      });
    });
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clearNode(nodeId: string): void {
    Array.from(this.sessions.entries()).forEach(([sessionId, sessionEntries]) => {
      sessionEntries.delete(nodeId);
      if (sessionEntries.size === 0) {
        this.sessions.delete(sessionId);
      }
    });
  }

  clearAll(): void {
    this.sessions.clear();
  }
}

export const imageImportSessionStore = new ImageImportSessionStore();
