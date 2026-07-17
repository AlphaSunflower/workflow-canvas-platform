import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import type { ObjectStorageAdapter } from "./object-storage.adapter.ts";
import type {
  StorageReadResult,
  StorageStatResult,
  StorageWriteBase64Input,
  StorageWriteInput,
  StorageWriteResult,
} from "./storage.types.ts";

function getExtension(originalName: string): string | null {
  const ext = path.extname(originalName).trim().replace(".", "").toLowerCase();
  return ext || null;
}

function getSourceFolder(sourceType: StorageWriteInput["sourceType"]): string {
  switch (sourceType) {
    case "input":
      return "inputs";
    case "intermediate":
      return "intermediates";
    case "output":
      return "outputs";
  }
}

function buildStorageKey(input: StorageWriteInput): {
  storageKey: string;
  extension: string | null;
} {
  const extension = getExtension(input.originalName);
  const sourceFolder = getSourceFolder(input.sourceType);
  const objectId = randomUUID();
  const fileName = extension ? `${objectId}.${extension}` : objectId;

  return {
    extension,
    storageKey: path.join(sourceFolder, fileName).replaceAll("\\", "/"),
  };
}

export class StorageService {
  private readonly adapter: ObjectStorageAdapter;

  constructor(adapter: ObjectStorageAdapter) {
    this.adapter = adapter;
  }

  async saveBuffer(input: StorageWriteInput): Promise<StorageWriteResult> {
    const sha256 = createHash("sha256").update(input.buffer).digest("hex");
    const { storageKey, extension } = buildStorageKey(input);

    await this.adapter.write({
      storageKey,
      buffer: input.buffer,
    });

    return {
      fileType: input.fileType ?? "image",
      sourceType: input.sourceType,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sha256,
      size: input.buffer.length,
      extension,
      width: null,
      height: null,
      storageProvider: this.adapter.provider,
      storageKey,
      absolutePath: (await this.adapter.stat(storageKey))?.absolutePath ?? "",
      createdAt: new Date().toISOString(),
    };
  }

  async saveBase64(input: StorageWriteBase64Input): Promise<StorageWriteResult> {
    const buffer = Buffer.from(input.contentBase64, "base64");
    return this.saveBuffer({
      sourceType: input.sourceType,
      fileType: input.fileType,
      originalName: input.originalName,
      mimeType: input.mimeType,
      buffer,
    });
  }

  async read(storageKey: string): Promise<StorageReadResult> {
    return this.adapter.read(storageKey);
  }

  async stat(storageKey: string): Promise<StorageStatResult | null> {
    return this.adapter.stat(storageKey);
  }
}
