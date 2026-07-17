import type { ObjectStorageConfig } from "@newworkflow/backend-shared";
import { LocalStorageAdapter } from "./local-storage.adapter.ts";
import type { ObjectStorageAdapter } from "./object-storage.adapter.ts";
import { S3StorageAdapter } from "./s3-storage.adapter.ts";

export function createWorkerStorageAdapter(
  config: ObjectStorageConfig,
  rootDir: string,
): ObjectStorageAdapter {
  if (config.provider === "local") {
    return new LocalStorageAdapter(rootDir);
  }

  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error("S3_OBJECT_STORAGE_CONFIG_INCOMPLETE");
  }

  return new S3StorageAdapter({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    forcePathStyle: config.forcePathStyle,
  });
}
