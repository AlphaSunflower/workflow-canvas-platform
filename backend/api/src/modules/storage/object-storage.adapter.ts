export interface ObjectStorageReadResult {
  buffer: Buffer;
  byteLength: number;
  storageKey: string;
  lastModifiedAt: string;
}

export interface ObjectStorageAdapter {
  readonly provider: string;
  write(storageKey: string, buffer: Buffer | Uint8Array): Promise<void>;
  writeIfMissing(storageKey: string, buffer: Buffer | Uint8Array): Promise<void>;
  copyIfMissing(sourceStorageKey: string, targetStorageKey: string): Promise<void>;
  read(storageKey: string): Promise<ObjectStorageReadResult>;
  exists(storageKey: string): Promise<boolean>;
  deleteIfExists(storageKey: string): Promise<void>;
}
