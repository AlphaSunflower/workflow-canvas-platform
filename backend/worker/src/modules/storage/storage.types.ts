import type {
  FileSourceType,
  FileType,
} from "@newworkflow/backend-shared";

export interface StorageWriteInput {
  sourceType: FileSourceType;
  fileType?: FileType;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface StorageWriteBase64Input {
  sourceType: FileSourceType;
  fileType?: FileType;
  originalName: string;
  mimeType: string;
  contentBase64: string;
}

export interface StorageWriteResult {
  fileType: FileType;
  sourceType: FileSourceType;
  originalName: string;
  mimeType: string;
  sha256: string;
  size: number;
  extension: string | null;
  width: number | null;
  height: number | null;
  storageProvider: string;
  storageKey: string;
  absolutePath: string;
  createdAt: string;
}

export interface StorageReadResult {
  buffer: Buffer;
  storageKey: string;
  absolutePath: string;
  byteLength: number;
  lastModifiedAt: string;
}

export interface StorageStatResult {
  storageKey: string;
  absolutePath: string;
  byteLength: number;
  lastModifiedAt: string;
}

export interface StorageAdapter {
  saveBuffer(input: StorageWriteInput): Promise<StorageWriteResult>;
  saveBase64(input: StorageWriteBase64Input): Promise<StorageWriteResult>;
  read(storageKey: string): Promise<StorageReadResult>;
  stat(storageKey: string): Promise<StorageStatResult | null>;
}
