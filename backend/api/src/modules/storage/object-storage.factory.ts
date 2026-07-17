import type { ObjectStorageConfig } from "@newworkflow/backend-shared";
import { LocalObjectStorageAdapter } from "./local-object-storage.adapter.ts";
import type { ObjectStorageAdapter } from "./object-storage.adapter.ts";
import { S3ObjectStorageAdapter } from "./s3-object-storage.adapter.ts";

export function createObjectStorageAdapter(
  config: ObjectStorageConfig,
  rootDir: string,
): ObjectStorageAdapter {
  if (config.provider === "local") {
    return new LocalObjectStorageAdapter(rootDir);
  }

  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error("S3_OBJECT_STORAGE_CONFIG_INCOMPLETE");
  }

  return new S3ObjectStorageAdapter({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    forcePathStyle: config.forcePathStyle,
  });
}
