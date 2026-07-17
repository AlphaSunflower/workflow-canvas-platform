import {
  AI_VIDEO_GEN_NODE_TYPE,
  AI_VIDEO_GEN_PROVIDER,
  AI_IMAGE_TO_PLY_NODE_TYPE,
  AI_IMAGE_TO_PLY_PROVIDER,
  AI_MULTI_VIEW_RESTORE_NODE_TYPE,
  AI_MULTI_VIEW_RESTORE_PROVIDER,
} from "@newworkflow/backend-shared";
import type { ExecutionTaskRecord } from "../../../../api/src/modules/executions/executions.repository.ts";
import type {
  ProviderConcurrencyConfig,
  ProviderConcurrencyHealthSnapshot,
  ProviderConcurrencyServiceLike,
  ProviderConcurrencySlot,
} from "./provider-concurrency.types.ts";

export class ProviderConcurrencyService implements ProviderConcurrencyServiceLike {
  private readonly maxConcurrencyByProvider: ReadonlyMap<string, number | null>;
  private readonly activeProviderCounts = new Map<string, number>();

  constructor(config?: ProviderConcurrencyConfig) {
    this.maxConcurrencyByProvider = new Map(Object.entries(config?.maxConcurrencyByProvider ?? {}));
  }

  canDispatch(task: ExecutionTaskRecord): boolean {
    const providerKey = this.getProviderKey(task);
    const maxConcurrency = this.maxConcurrencyByProvider.get(providerKey);

    if (typeof maxConcurrency !== "number") {
      return true;
    }

    return (this.activeProviderCounts.get(providerKey) ?? 0) < maxConcurrency;
  }

  acquire(task: ExecutionTaskRecord): ProviderConcurrencySlot | null {
    const providerKey = this.getProviderKey(task);
    const maxConcurrency = this.maxConcurrencyByProvider.get(providerKey);
    const current = this.activeProviderCounts.get(providerKey) ?? 0;

    if (typeof maxConcurrency === "number" && current >= maxConcurrency) {
      return null;
    }

    this.activeProviderCounts.set(providerKey, current + 1);

    return {
      providerKey,
    };
  }

  release(slot: ProviderConcurrencySlot): void {
    const current = this.activeProviderCounts.get(slot.providerKey) ?? 0;

    if (current <= 1) {
      this.activeProviderCounts.delete(slot.providerKey);
      return;
    }

    this.activeProviderCounts.set(slot.providerKey, current - 1);
  }

  getProviderKey(task: ExecutionTaskRecord): string {
    if (typeof task.provider === "string" && task.provider.trim().length > 0) {
      return task.provider.trim();
    }

    if (task.nodeType === AI_IMAGE_TO_PLY_NODE_TYPE) {
      return AI_IMAGE_TO_PLY_PROVIDER;
    }

    if (task.nodeType === AI_MULTI_VIEW_RESTORE_NODE_TYPE) {
      return AI_MULTI_VIEW_RESTORE_PROVIDER;
    }

    if (task.nodeType === AI_VIDEO_GEN_NODE_TYPE) {
      return AI_VIDEO_GEN_PROVIDER;
    }

    return task.taskType || "default";
  }

  getHealth(): ProviderConcurrencyHealthSnapshot {
    const providerKeys = new Set<string>([
      ...this.maxConcurrencyByProvider.keys(),
      ...this.activeProviderCounts.keys(),
    ]);
    const providers: Record<string, { active: number; max: number | null; available: number | null }> = {};

    for (const providerKey of providerKeys) {
      const active = this.activeProviderCounts.get(providerKey) ?? 0;
      const max = this.maxConcurrencyByProvider.get(providerKey) ?? null;

      providers[providerKey] = {
        active,
        max,
        available: typeof max === "number" ? Math.max(0, max - active) : null,
      };
    }

    return {
      providers,
    };
  }
}
