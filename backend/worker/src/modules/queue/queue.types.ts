import type { ExecutionTaskRecord } from "../../../../api/src/modules/executions/executions.repository.ts";
import type { ProviderConcurrencyHealthSnapshot, ProviderConcurrencySlot } from "./provider-concurrency.types.ts";

export interface QueueClaimedTask {
  runId: string;
  task: ExecutionTaskRecord;
  providerSlot: ProviderConcurrencySlot;
}

export interface QueueBackpressureSnapshot {
  taskId: string;
  taskNo: string;
  provider: string;
  providerCode: string | null;
  errorCode: string;
  errorMessage: string;
  occurredAt: string;
}

export interface QueueHealthSnapshot {
  activeTaskCount: number;
  maxConcurrency: number | null;
  queuedTaskCount: number;
  queuedTaskCountByProvider: Record<string, number>;
  lastScanLimit: number;
  lastCandidateCount: number;
  lastProviderSkippedCount: number;
  lastClaimedCount: number;
  lastProviderSlotSkippedTaskId: string | null;
  lastProviderSlotSkippedTaskNo: string | null;
  lastProviderSlotSkippedProvider: string | null;
  lastProviderSlotSkippedAt: string | null;
  lastDispatchKickScheduledAt: string | null;
  lastProviderBackpressure: QueueBackpressureSnapshot | null;
  providerConcurrency: ProviderConcurrencyHealthSnapshot;
}

export interface QueuePollResult {
  claimedTasks: QueueClaimedTask[];
  claimedCount: number;
}

export type QueueTaskExecutionOutcome = "completed" | "failed" | "backpressure";
