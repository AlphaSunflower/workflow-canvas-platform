import {
  AI_IMAGE_TO_PLY_NODE_TYPE,
  AI_IMAGE_TO_PLY_PROVIDER,
  AI_MULTI_VIEW_RESTORE_NODE_TYPE,
  AI_MULTI_VIEW_RESTORE_PROVIDER,
  AI_VIDEO_GEN_NODE_TYPE,
  AI_VIDEO_GEN_PROVIDER,
  type DatabaseConfig,
  type DatabasePool,
  queryPostgres,
  withTransaction,
} from "@newworkflow/backend-shared";
import type { ExecutionTaskRecord } from "../../../../api/src/modules/executions/executions.repository.ts";
import type {
  ProviderConcurrencyConfig,
  ProviderConcurrencyHealthSnapshot,
  ProviderConcurrencyServiceLike,
  ProviderConcurrencySlot,
} from "./provider-concurrency.types.ts";

type DbRow = Record<string, unknown>;

export interface DbProviderConcurrencyServiceOptions extends ProviderConcurrencyConfig {
  pool?: DatabasePool;
  workerId: string;
  leaseMs?: number;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.trunc(value);
}

function calculateLeaseUntil(leaseMs: number): string {
  return new Date(Date.now() + leaseMs).toISOString();
}

export class DbProviderConcurrencyService implements ProviderConcurrencyServiceLike {
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;
  private readonly maxConcurrencyByProvider: ReadonlyMap<string, number | null>;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly localActiveProviderCounts = new Map<string, number>();

  constructor(
    databaseConfig: DatabaseConfig,
    options: DbProviderConcurrencyServiceOptions,
  ) {
    this.databaseConfig = databaseConfig;
    this.pool = options.pool ?? null;
    this.maxConcurrencyByProvider = new Map(Object.entries(options.maxConcurrencyByProvider ?? {}));
    this.workerId = options.workerId;
    this.leaseMs = normalizePositiveInteger(options.leaseMs, 120_000);
  }

  canDispatch(task: ExecutionTaskRecord): boolean {
    const providerKey = this.getProviderKey(task);
    const maxConcurrency = this.maxConcurrencyByProvider.get(providerKey);

    if (typeof maxConcurrency !== "number") {
      return true;
    }

    const localActive = this.localActiveProviderCounts.get(providerKey) ?? 0;
    return localActive < maxConcurrency;
  }

  async acquire(task: ExecutionTaskRecord): Promise<ProviderConcurrencySlot | null> {
    const providerKey = this.getProviderKey(task);
    const maxConcurrency = this.maxConcurrencyByProvider.get(providerKey);

    if (typeof maxConcurrency !== "number") {
      this.incrementLocal(providerKey);
      return {
        providerKey,
      };
    }

    const leaseId = await this.acquireLease(task, providerKey, maxConcurrency);

    if (!leaseId) {
      return null;
    }

    this.incrementLocal(providerKey);
    return {
      providerKey,
      leaseId,
    };
  }

  async release(slot: ProviderConcurrencySlot): Promise<void> {
    this.decrementLocal(slot.providerKey);

    if (!slot.leaseId) {
      return;
    }

    await this.query(
      "delete from provider_concurrency_leases where id = $1",
      [slot.leaseId],
    ).catch(() => undefined);
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
      ...this.localActiveProviderCounts.keys(),
    ]);
    const providers: ProviderConcurrencyHealthSnapshot["providers"] = {};

    for (const providerKey of providerKeys) {
      const active = this.localActiveProviderCounts.get(providerKey) ?? 0;
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

  private async acquireLease(
    task: ExecutionTaskRecord,
    providerKey: string,
    maxConcurrency: number,
  ): Promise<string | null> {
    return withTransaction(this.pool ?? this.databaseConfig, async (client) => {
      await client.query("lock table provider_concurrency_leases in share row exclusive mode");
      await client.query(
        "delete from provider_concurrency_leases where lease_until < now()",
      );
      const countResult = await client.query<{ total: string | number }>(
        `
          select count(*) as total
          from provider_concurrency_leases
          where provider_key = $1
            and lease_until >= now()
        `,
        [providerKey],
      );
      const active = Number(countResult.rows[0]?.total ?? 0);

      if (active >= maxConcurrency) {
        return null;
      }

      const insertResult = await client.query<{ id: string }>(
        `
          insert into provider_concurrency_leases (
            provider_key,
            task_id,
            worker_id,
            lease_until,
            metadata
          )
          values ($1, $2, $3, $4, $5::jsonb)
          on conflict (task_id) do update set
            provider_key = excluded.provider_key,
            worker_id = excluded.worker_id,
            lease_until = excluded.lease_until,
            heartbeat_at = now(),
            metadata = excluded.metadata
          returning id::text
        `,
        [
          providerKey,
          task.id,
          this.workerId,
          calculateLeaseUntil(this.leaseMs),
          JSON.stringify({
            taskNo: task.taskNo,
            runId: task.runId,
          }),
        ],
      );

      return insertResult.rows[0]?.id ?? null;
    });
  }

  private async query<T extends DbRow = DbRow>(
    text: string,
    values?: readonly unknown[],
  ) {
    if (this.pool) {
      return this.pool.query<T>(text, values);
    }

    return queryPostgres<T>(this.databaseConfig, text, values);
  }

  private incrementLocal(providerKey: string): void {
    this.localActiveProviderCounts.set(
      providerKey,
      (this.localActiveProviderCounts.get(providerKey) ?? 0) + 1,
    );
  }

  private decrementLocal(providerKey: string): void {
    const current = this.localActiveProviderCounts.get(providerKey) ?? 0;

    if (current <= 1) {
      this.localActiveProviderCounts.delete(providerKey);
      return;
    }

    this.localActiveProviderCounts.set(providerKey, current - 1);
  }
}
