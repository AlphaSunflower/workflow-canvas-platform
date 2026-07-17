import path from "node:path";

export function resolveApiBackendRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

export function resolveApiRootDir(rootDir?: string): string {
  return rootDir ? path.resolve(rootDir) : resolveApiBackendRoot();
}

export function requireAuthSecret(value: string | null, errorCode: string): string {
  if (!value) {
    throw new Error(errorCode);
  }

  return value;
}
