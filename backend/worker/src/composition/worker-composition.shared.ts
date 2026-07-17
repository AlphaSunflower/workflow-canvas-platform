import path from "node:path";

import type { ServiceEnv } from "@newworkflow/backend-shared";

export function resolveWorkerBackendRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

export function resolveWorkerRootDir(rootDir?: string): string {
  return rootDir ? path.resolve(rootDir) : resolveWorkerBackendRoot();
}

export function resolveSnapshotDir(env: ServiceEnv, rootDir: string): string {
  return path.resolve(rootDir, env.providerSnapshotDir);
}
