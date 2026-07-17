import type { ExecutionTaskRecord } from "../../../../api/src/modules/executions/executions.repository.ts";

export interface ProviderConcurrencyConfig {
  maxConcurrencyByProvider?: Record<string, number | null>;
}

export interface ProviderConcurrencySlot {
  providerKey: string;
  leaseId?: string;
}

export interface ProviderConcurrencyDebugEntry {
  active: number;
  max: number | null;
  available: number | null;
}

export interface ProviderConcurrencyHealthSnapshot {
  providers: Record<string, ProviderConcurrencyDebugEntry>;
}

export interface ProviderConcurrencyServiceLike {
  canDispatch(task: ExecutionTaskRecord): boolean | Promise<boolean>;
  acquire(task: ExecutionTaskRecord): ProviderConcurrencySlot | null | Promise<ProviderConcurrencySlot | null>;
  release(slot: ProviderConcurrencySlot): void | Promise<void>;
  getProviderKey(task: ExecutionTaskRecord): string;
  getHealth(): ProviderConcurrencyHealthSnapshot;
}
