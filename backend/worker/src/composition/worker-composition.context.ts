import type { ServiceEnv } from "@newworkflow/backend-shared";
import type {
  CreateWorkerDependenciesInput,
  WorkerDependencyOverrides,
} from "./worker-dependencies.types.ts";

export interface WorkerCompositionContext {
  env: ServiceEnv;
  rootDir: string;
  snapshotDir: string;
  resolve<K extends keyof WorkerDependencyOverrides>(
    key: K,
    factory: () => NonNullable<WorkerDependencyOverrides[K]>,
  ): NonNullable<WorkerDependencyOverrides[K]>;
}

export function createWorkerCompositionContext(
  input: CreateWorkerDependenciesInput,
  rootDir: string,
  snapshotDir: string,
): WorkerCompositionContext {
  const overrides = input.overrides ?? {};

  return {
    env: input.env,
    rootDir,
    snapshotDir,
    resolve(key, factory) {
      return (overrides[key] ?? factory()) as NonNullable<WorkerDependencyOverrides[typeof key]>;
    },
  };
}

