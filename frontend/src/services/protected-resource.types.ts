import type { ProtectedResourcePersistentMetadata } from './protected-resource-persistent-store';

export interface ProtectedResourceOptions {
  signal?: AbortSignal;
  persistentEnabled?: boolean;
  persistentVersion?: string;
}

export interface ProtectedResourceFetchResult {
  blob: Blob;
  metadata?: ProtectedResourcePersistentMetadata;
}

export interface ProtectedResourceHandle {
  url: string;
  release: () => void;
  protected: boolean;
  blob?: Blob;
}

export interface ProtectedResourceBlobHandle {
  blob: Blob;
  protected: boolean;
  release: () => void;
}
