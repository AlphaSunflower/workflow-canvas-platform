import type { ServiceEnv } from "@newworkflow/backend-shared";
import type { ApiDependencyOverrides } from "./api-dependencies.types.ts";

export interface ApiCompositionContext {
  env?: ServiceEnv;
  rootDir: string;
  requireEnv(): ServiceEnv;
  resolve<K extends keyof ApiDependencyOverrides>(
    key: K,
    factory: () => NonNullable<ApiDependencyOverrides[K]>,
  ): NonNullable<ApiDependencyOverrides[K]>;
}

