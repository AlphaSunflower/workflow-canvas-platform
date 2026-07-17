import type {
  StorageReadResult,
  StorageStatResult,
} from "./storage.types.ts";

export interface ObjectStorageWriteInput {
  storageKey: string;
  buffer: Buffer | Uint8Array;
}

export interface ObjectStorageAdapter {
  readonly provider: string;
  write(input: ObjectStorageWriteInput): Promise<void>;
  read(storageKey: string): Promise<StorageReadResult>;
  stat(storageKey: string): Promise<StorageStatResult | null>;
}
